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

async function createMigratedDatabase() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-core-schema-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDir = resolve(import.meta.dir, '../migrations/generated')
  const migrations = await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
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
    ]))
    expect(CORE_MIGRATIONS).toHaveLength(6)
  })

  test('maps all 20 inventory categories to shared-primary-key subtype tables', () => {
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
      'wireless',
    ])
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
