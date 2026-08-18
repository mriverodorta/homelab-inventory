import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { coreSchema, inventorySubtypeTables } from './index.ts'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function createMigratedDatabase(migrationCount = CORE_MIGRATIONS.length) {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-core-schema-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDir = resolve(import.meta.dir, '../migrations/generated')
  const migrations = await Promise.all(CORE_MIGRATIONS.slice(0, migrationCount).map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  })))
  await applyCommittedMigrations(handle, migrations)
  return handle
}

describe('core SQLite foundation schema', () => {
  test('exports the typed foundation tables', () => {
    expect(Object.keys(coreSchema)).toEqual(expect.arrayContaining([
      'applicationMetadata',
      'projects',
      'workspaces',
      'inventoryItems',
      'inventoryIdentityAliases',
      'cpuSocketTypes',
      'systemsSavedViews',
      'systemAttentionSummaries',
      'optionalModuleResourceGroups',
      'compatibilityAuditDirtyHosts',
    ]))
    expect(CORE_MIGRATIONS).toHaveLength(22)
    expect(CORE_MIGRATIONS.at(-1)?.id).toBe('0022_canonical_compatibility_audit')
  })

  test('maps every active inventory category to a shared-primary-key subtype table', () => {
    expect(Object.keys(inventorySubtypeTables).sort()).toEqual([
      'case',
      'cpu',
      'cpuCooler',
      'gpu',
      'monitor',
      'motherboard',
      'nas',
      'network',
      'patchPanel',
      'pcBuild',
      'powerAdapter',
      'powerStrip',
      'powerSupply',
      'ram',
      'server',
      'soundCard',
      'storage',
      'switch',
      'ups',
    ])
  })

  test('migrates network and wireless records into one relational adapter model', async () => {
    const networkMigrationIndex = CORE_MIGRATIONS.findIndex((migration) => migration.id === '0018_network_adapter_v11')
    const handle = await createMigratedDatabase(networkMigrationIndex)
    try {
      const networkType = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'network'").get() as { id: number }
      const wirelessType = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'wireless'").get() as { id: number }
      const networkItem = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (?, 'global', NULL, 'Legacy Ethernet', 1, 1, 1)
        RETURNING id
      `).get(networkType.id) as { id: number }
      const wirelessItem = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (?, 'global', NULL, 'Legacy Wi-Fi', 1, 1, 1)
        RETURNING id
      `).get(wirelessType.id) as { id: number }
      handle.database.query(`
        INSERT INTO network_cards (id, port_count, max_speed_bps, interface, form_factor)
        VALUES (?, 2, 10000000000, 'PCIe 3.0 x8', 'low-profile')
      `).run(networkItem.id)
      handle.database.query(`
        INSERT INTO wireless_cards (id, interface, wifi_generation, bluetooth)
        VALUES (?, 'M.2 2230 A/E', 'Wi-Fi 6E', 1)
      `).run(wirelessItem.id)
      handle.database.query(`
        INSERT INTO inventory_identity_aliases (item_id, legacy_type_key, legacy_id, created_at_ms)
        VALUES (?, 'wireless', 7, 1)
      `).run(wirelessItem.id)
      const source = handle.database.query(`
        INSERT INTO registry_sources (kind, display_name, endpoint, enabled, created_at_ms)
        VALUES ('official-connected', 'Registry', 'https://registry.example.test', 1, 1)
        RETURNING id
      `).get() as { id: number }
      handle.database.query(`
        INSERT INTO registry_links (
          item_id, source_id, template_key, imported_revision, imported_content_hash,
          imported_fingerprint_version, state, linked_at_ms, updated_at_ms
        ) VALUES (?, ?, 'network-intel-legacy', 1, ?, 9, 'linked', 1, 1)
      `).run(wirelessItem.id, source.id, 'a'.repeat(64))

      const migrationsDir = resolve(import.meta.dir, '../migrations/generated')
      const migrations = await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
        id: migration.id,
        sha256: migration.sha256,
        sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
      })))
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 5, currentVersion: 22 })

      expect(handle.database.query(`
        SELECT id, network_technology, form_factor, max_speed_bps
        FROM network_adapters ORDER BY id
      `).all()).toEqual([
        { id: networkItem.id, network_technology: 'ethernet', form_factor: 'low-profile', max_speed_bps: 10_000_000_000 },
        { id: wirelessItem.id, network_technology: 'wifi', form_factor: 'm2-2230', max_speed_bps: null },
      ])
      expect(handle.database.query(`
        SELECT family, key, module_size
        FROM network_adapter_host_interfaces WHERE adapter_id = ?
      `).get(wirelessItem.id)).toEqual({ family: 'm2-ae', key: 'A+E', module_size: '2230' })
      expect(handle.database.query(`
        SELECT inventory_item_types.key AS type_key, inventory_identity_aliases.legacy_type_key,
          registry_links.item_id AS linked_item_id
        FROM inventory_items
        JOIN inventory_item_types ON inventory_item_types.id = inventory_items.type_id
        JOIN inventory_identity_aliases ON inventory_identity_aliases.item_id = inventory_items.id
        JOIN registry_links ON registry_links.item_id = inventory_items.id
        WHERE inventory_items.id = ?
      `).get(wirelessItem.id)).toEqual({
        type_key: 'network',
        legacy_type_key: 'network',
        linked_item_id: wirelessItem.id,
      })
      expect(handle.database.query(`
        SELECT legacy_type_key, legacy_id FROM inventory_compatibility_aliases WHERE item_id = ?
      `).get(wirelessItem.id)).toEqual({ legacy_type_key: 'wireless', legacy_id: 7 })
      expect(handle.database.query(`
        SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('network_cards', 'wireless_cards')
      `).all()).toEqual([])
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 0, currentVersion: 22 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('repairs unambiguous missing M.2 metadata without overwriting or guessing', async () => {
    const repairMigrationIndex = CORE_MIGRATIONS.findIndex((migration) => migration.id === '0019_m2_metadata_repair')
    const handle = await createMigratedDatabase(repairMigrationIndex)
    try {
      const networkType = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'network'").get() as { id: number }
      const serverType = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'server'").get() as { id: number }
      const insertItem = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (?, 'global', NULL, ?, 1, 1, 1)
        RETURNING id
      `)
      const insertAdapter = handle.database.query(`
        INSERT INTO network_adapters (id, network_technology, form_factor)
        VALUES (?, 'ethernet', ?)
      `)
      const insertInterface = handle.database.query(`
        INSERT INTO network_adapter_host_interfaces (adapter_id, family, key, module_size)
        VALUES (?, ?, ?, ?)
      `)
      const insertLegacyInterface = handle.database.query(`
        INSERT INTO network_adapter_extension_values (adapter_id, field_path, value_type, text_value)
        VALUES (?, 'legacy.interface', 'text', ?)
      `)

      const i210 = insertItem.get(networkType.id, 'Intel I210AT 1G NIC') as { id: number }
      insertAdapter.run(i210.id, 'M.2 2230 A+E')
      insertInterface.run(i210.id, 'm2-ae', null, null)
      insertLegacyInterface.run(i210.id, 'M.2 A+E')

      const bmAdapter = insertItem.get(networkType.id, 'M.2 B+M adapter') as { id: number }
      insertAdapter.run(bmAdapter.id, 'M.2 2280 B/M')
      insertInterface.run(bmAdapter.id, 'm2-bm', null, null)

      const ambiguousAdapter = insertItem.get(networkType.id, 'Ambiguous M.2 adapter') as { id: number }
      insertAdapter.run(ambiguousAdapter.id, 'M.2 2230 or 2280 A+E')
      insertInterface.run(ambiguousAdapter.id, 'm2-ae', null, null)

      const populatedAdapter = insertItem.get(networkType.id, 'Curated M.2 adapter') as { id: number }
      insertAdapter.run(populatedAdapter.id, 'M.2 2230 A+E')
      insertInterface.run(populatedAdapter.id, 'm2-ae', 'curated-key', '2242')

      const host = insertItem.get(serverType.id, 'Lenovo ThinkCentre M720q') as { id: number }
      handle.database.query('INSERT INTO servers (id) VALUES (?)').run(host.id)
      const resource = handle.database.query(`
        INSERT INTO inventory_resources (item_id, created_at_ms) VALUES (?, 1) RETURNING id
      `).get(host.id) as { id: number }
      const group = handle.database.query(`
        INSERT INTO host_resource_groups (
          resource_identity_id, host_item_id, resource_type, semantic_key, label, slot_count, created_at_ms
        ) VALUES (?, ?, 'expansion', 'm2-ae-slot', 'M.2 2230 A/E network slot', 1, 1)
        RETURNING id
      `).get(resource.id, host.id) as { id: number }
      handle.database.query(`
        INSERT INTO expansion_resource_groups (id, interface_family)
        VALUES (?, 'm2-ae')
      `).run(group.id)

      const migrationsDir = resolve(import.meta.dir, '../migrations/generated')
      const migrations = await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
        id: migration.id,
        sha256: migration.sha256,
        sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
      })))
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 4, currentVersion: 22 })

      expect(handle.database.query(`
        SELECT family, key, module_size FROM network_adapter_host_interfaces WHERE adapter_id = ?
      `).get(i210.id)).toEqual({ family: 'm2-ae', key: 'A+E', module_size: '2230' })
      expect(handle.database.query(`
        SELECT family, key, module_size FROM network_adapter_host_interfaces WHERE adapter_id = ?
      `).get(bmAdapter.id)).toEqual({ family: 'm2-bm', key: 'B+M', module_size: '2280' })
      expect(handle.database.query(`
        SELECT key, module_size FROM network_adapter_host_interfaces WHERE adapter_id = ?
      `).get(ambiguousAdapter.id)).toEqual({ key: 'A+E', module_size: null })
      expect(handle.database.query(`
        SELECT key, module_size FROM network_adapter_host_interfaces WHERE adapter_id = ?
      `).get(populatedAdapter.id)).toEqual({ key: 'curated-key', module_size: '2242' })
      expect(handle.database.query(`
        SELECT keying, module_size FROM expansion_resource_groups WHERE id = ?
      `).get(group.id)).toEqual({ keying: 'A+E', module_size: '2230' })
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 0, currentVersion: 22 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('migrates v10 NAS topology without changing existing relational identities', async () => {
    const nasMigrationIndex = CORE_MIGRATIONS.findIndex((migration) => migration.id === '0015_nas_contract_v10')
    const handle = await createMigratedDatabase(nasMigrationIndex)
    try {
      const type = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'nas'").get() as { id: number }
      const item = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (?, 'global', NULL, 'Legacy NAS', 1, 1, 1)
        RETURNING id
      `).get(type.id) as { id: number }
      handle.database.query(`
        INSERT INTO nas_systems (id, power_configuration)
        VALUES (?, 'external-adapter')
      `).run(item.id)
      const profile = handle.database.query(`
        INSERT INTO host_compatibility_profiles (host_item_id, created_at_ms, updated_at_ms)
        VALUES (?, 1, 1)
        RETURNING id
      `).get(item.id) as { id: number }
      handle.database.query(`
        INSERT INTO host_power_profiles (host_profile_id, configuration, connector)
        VALUES (?, 'external-adapter', 'OEM')
      `).run(profile.id)

      const migrationsDir = resolve(import.meta.dir, '../migrations/generated')
      const migrations = await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
        id: migration.id,
        sha256: migration.sha256,
        sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
      })))
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 8, currentVersion: 22 })
      expect(handle.database.query(`
        SELECT adapter_disposition FROM host_power_profiles WHERE host_profile_id = ?
      `).get(profile.id)).toEqual({ adapter_disposition: 'replaceable' })
      expect(handle.database.query('SELECT id, power_configuration FROM nas_systems WHERE id = ?').get(item.id)).toEqual({
        id: item.id,
        power_configuration: 'external-adapter',
      })
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 0, currentVersion: 22 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces fixed-component ownership and numeric catalog identities', async () => {
    const handle = await createMigratedDatabase()
    try {
      const type = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'nas'").get() as { id: number }
      const item = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (?, 'global', NULL, 'NAS', 1, 1, 1)
        RETURNING id
      `).get(type.id) as { id: number }
      handle.database.query("INSERT INTO nas_systems (id, power_configuration) VALUES (?, 'internal-psu')").run(item.id)

      expect(() => handle.database.query(`
        INSERT INTO host_fixed_components (
          host_item_id, catalog_component_id, component_type, disposition, label,
          item_json, extensions_json, created_at_ms, updated_at_ms
        ) VALUES (?, 1, 'cpu', 'soldered', 'CPU', '{"type":"cpu","name":"CPU"}', '{}', 1, 1)
      `).run(item.id)).not.toThrow()
      expect(() => handle.database.query(`
        INSERT INTO host_fixed_components (
          host_item_id, catalog_component_id, component_type, disposition, label,
          item_json, extensions_json, created_at_ms, updated_at_ms
        ) VALUES (?, 1, 'cpu', 'fixed', 'Duplicate', '{"type":"cpu","name":"CPU"}', '{}', 1, 1)
      `).run(item.id)).toThrow()
      expect(() => handle.database.query(`
        INSERT INTO host_fixed_components (
          host_item_id, catalog_component_id, component_type, disposition, label,
          item_json, extensions_json, created_at_ms, updated_at_ms
        ) VALUES (?, 2, 'cpu', 'removable', 'Invalid', '{}', '{}', 1, 1)
      `).run(item.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces subtype identity and canonical measurement constraints', async () => {
    const handle = await createMigratedDatabase()
    try {
      const cpuItem = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (9, 'global', NULL, 'CPU', 1, 1, 1)
        RETURNING id
      `).get() as { id: number }
      const memoryItem = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (10, 'global', NULL, 'Memory', 1, 1, 1)
        RETURNING id
      `).get() as { id: number }

      expect(() => handle.database.query(`
        INSERT INTO cpus (id, core_count, base_clock_mhz) VALUES (?, 6, 2300)
      `).run(cpuItem.id)).not.toThrow()
      expect(() => handle.database.query(`
        INSERT INTO cpus (id, core_count) VALUES (?, 8)
      `).run(memoryItem.id)).toThrow(/CPU subtype/iu)
      expect(() => handle.database.query(`
        INSERT INTO memory_modules (id, capacity_mib) VALUES (?, -1)
      `).run(memoryItem.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('creates only strict application tables', async () => {
    const handle = await createMigratedDatabase()
    try {
      const applicationTables = handle.database.query(`
        SELECT name, strict
        FROM pragma_table_list
        WHERE schema = 'main'
          AND type = 'table'
          AND name NOT LIKE 'sqlite_%'
      `).all() as Array<{ name: string, strict: number }>

      expect(applicationTables.length).toBeGreaterThan(10)
      expect(applicationTables.every((table) => table.strict === 1)).toBe(true)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces global and project-bound inventory ownership', async () => {
    const handle = await createMigratedDatabase()
    const insert = handle.database.query(`
      INSERT INTO inventory_items (
        type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
      ) VALUES (1, ?, ?, 'Test item', 1, 1, 1)
    `)

    try {
      expect(() => insert.run('project', null)).toThrow()
      expect(() => insert.run('global', 1)).toThrow()
      expect(() => insert.run('project', 1)).not.toThrow()
      expect(() => insert.run('global', null)).not.toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('prevents active project names from colliding case-insensitively', async () => {
    const handle = await createMigratedDatabase()
    try {
      expect(() => handle.database.query(`
        INSERT INTO projects (
          name, revision, includes_global_inventory, created_at_ms, updated_at_ms
        ) VALUES ('default project', 1, 1, 1, 1)
      `).run()).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('does not reuse deleted generated identifiers', async () => {
    const handle = await createMigratedDatabase()
    try {
      const insert = handle.database.query(`
        INSERT INTO manufacturers (name, normalized_name, created_at_ms, updated_at_ms)
        VALUES (?, ?, 1, 1)
        RETURNING id
      `)
      const first = insert.get('First', 'first') as { id: number }
      handle.database.query('DELETE FROM manufacturers WHERE id = ?').run(first.id)
      const second = insert.get('Second', 'second') as { id: number }

      expect(second.id).toBeGreaterThan(first.id)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('keeps legacy inventory aliases unique and immutable', async () => {
    const handle = await createMigratedDatabase()
    try {
      const item = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (1, 'global', NULL, 'Aliased item', 1, 1, 1)
        RETURNING id
      `).get() as { id: number }
      handle.database.query(`
        INSERT INTO inventory_identity_aliases (
          item_id, legacy_type_key, legacy_id, created_at_ms
        ) VALUES (?, 'server', 41, 1)
      `).run(item.id)

      expect(() => handle.database.query(`
        UPDATE inventory_identity_aliases SET legacy_id = 42 WHERE item_id = ?
      `).run(item.id)).toThrow(/immutable/iu)
      expect(() => handle.database.query(`
        DELETE FROM inventory_identity_aliases WHERE item_id = ?
      `).run(item.id)).toThrow(/immutable/iu)

      handle.database.query('UPDATE inventory_items SET archived_at_ms = 2 WHERE id = ?').run(item.id)
      expect(() => handle.database.query(`
        DELETE FROM inventory_identity_aliases WHERE item_id = ?
      `).run(item.id)).not.toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces fixed Systems workspaces and same-project defaults', async () => {
    const handle = await createMigratedDatabase()
    try {
      expect(() => handle.database.query(`
        INSERT INTO workspaces (
          project_id, type, name, icon_key, color_key, sort_order, revision,
          system_key, created_at_ms, updated_at_ms
        ) VALUES (1, 'systems', 'Systems', 'server', 'neutral', 0, 1, 'systems', 1, 1)
      `).run()).toThrow()

      const project = handle.database.query(`
        INSERT INTO projects (
          name, revision, includes_global_inventory, created_at_ms, updated_at_ms
        ) VALUES ('Second Project', 1, 1, 1, 1)
        RETURNING id
      `).get() as { id: number }

      expect(() => handle.database.query(`
        INSERT INTO project_preferences (project_id, default_workspace_id, updated_at_ms)
        VALUES (?, 2, 1)
      `).run(project.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('keeps controlled vocabulary keys unique', async () => {
    const handle = await createMigratedDatabase()
    try {
      expect(() => handle.database.query(`
        INSERT INTO cpu_socket_types (key, label, sort_order)
        VALUES ('lga1200', 'Duplicate LGA1200', 999)
      `).run()).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
