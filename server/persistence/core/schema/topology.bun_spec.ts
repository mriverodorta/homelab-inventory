import { afterEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function createDatabase() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-topology-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDir = resolve(import.meta.dir, '../migrations/generated')
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  }))))
  return handle
}

function insertItem(database: Database, typeId: number, name: string) {
  return database.query(`
    INSERT INTO inventory_items (
      type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
    ) VALUES (?, 'global', NULL, ?, 1, 1, 1)
    RETURNING id
  `).get(typeId, name) as { id: number }
}

describe('normalized hardware topology', () => {
  test('rejects cross-host, duplicate-component, and occupied-slot assignments', async () => {
    const handle = await createDatabase()
    try {
      const firstHost = insertItem(handle.database, 1, 'First host')
      const secondHost = insertItem(handle.database, 1, 'Second host')
      const firstCpu = insertItem(handle.database, 9, 'First CPU')
      const secondCpu = insertItem(handle.database, 9, 'Second CPU')
      handle.database.query("INSERT INTO servers (id) VALUES (?)").run(firstHost.id)
      handle.database.query("INSERT INTO servers (id) VALUES (?)").run(secondHost.id)
      handle.database.query("INSERT INTO cpus (id) VALUES (?)").run(firstCpu.id)
      handle.database.query("INSERT INTO cpus (id) VALUES (?)").run(secondCpu.id)

      const resourceIdentity = handle.database.query(`
        INSERT INTO inventory_resources (item_id, created_at_ms) VALUES (?, 1) RETURNING id
      `).get(secondHost.id) as { id: number }
      const group = handle.database.query(`
        INSERT INTO host_resource_groups (
          resource_identity_id, host_item_id, resource_type, semantic_key, label, slot_count, created_at_ms
        ) VALUES (?, ?, 'cpu', 'cpu-sockets', 'CPU sockets', 1, 1)
        RETURNING id
      `).get(resourceIdentity.id, secondHost.id) as { id: number }
      const slot = handle.database.query(`
        INSERT INTO host_resource_slots (
          resource_group_id, host_item_id, position, label, single_capacity, created_at_ms
        ) VALUES (?, ?, 1, 'CPU 1', 1, 1)
        RETURNING id
      `).get(group.id, secondHost.id) as { id: number }

      expect(() => handle.database.query(`
        INSERT INTO component_assignments (
          project_id, workspace_id, host_item_id, component_item_id, resource_slot_id, assigned_at_ms
        ) VALUES (1, 2, ?, ?, ?, 1)
      `).run(firstHost.id, firstCpu.id, slot.id)).toThrow()

      handle.database.query(`
        INSERT INTO component_assignments (
          project_id, workspace_id, host_item_id, component_item_id, resource_slot_id, assigned_at_ms
        ) VALUES (1, 2, ?, ?, ?, 1)
      `).run(secondHost.id, firstCpu.id, slot.id)

      expect(() => handle.database.query(`
        INSERT INTO component_assignments (
          project_id, workspace_id, host_item_id, component_item_id, resource_slot_id, assigned_at_ms
        ) VALUES (1, 2, ?, ?, NULL, 1)
      `).run(secondHost.id, firstCpu.id)).toThrow()
      expect(() => handle.database.query(`
        INSERT INTO component_assignments (
          project_id, workspace_id, host_item_id, component_item_id, resource_slot_id, assigned_at_ms
        ) VALUES (1, 2, ?, ?, ?, 1)
      `).run(secondHost.id, secondCpu.id, slot.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('protects connected ports and rejects incompatible endpoint kinds', async () => {
    const handle = await createDatabase()
    try {
      const switchItem = insertItem(handle.database, 4, 'Switch')
      const patchItem = insertItem(handle.database, 5, 'Patch panel')
      const upsItem = insertItem(handle.database, 7, 'UPS')
      handle.database.query('INSERT INTO network_switches (id) VALUES (?)').run(switchItem.id)
      handle.database.query('INSERT INTO patch_panels (id) VALUES (?)').run(patchItem.id)
      handle.database.query('INSERT INTO ups_systems (id) VALUES (?)').run(upsItem.id)

      const networkKindId = 1
      const powerOutputKindId = 3
      const connectorId = 1
      const addPort = handle.database.query(`
        INSERT INTO inventory_ports (item_id, created_at_ms) VALUES (?, 1) RETURNING id
      `)
      const switchPort = addPort.get(switchItem.id) as { id: number }
      const patchPort = addPort.get(patchItem.id) as { id: number }
      const upsPort = addPort.get(upsItem.id) as { id: number }
      const spareSwitchPort = addPort.get(switchItem.id) as { id: number }
      const addDetails = handle.database.query(`
        INSERT INTO item_port_details (
          port_id, kind_id, connector_type_id, slot_number, origin
        ) VALUES (?, ?, ?, ?, 'fixed')
      `)
      addDetails.run(switchPort.id, networkKindId, connectorId, 1)
      addDetails.run(patchPort.id, networkKindId, connectorId, 1)
      addDetails.run(upsPort.id, powerOutputKindId, connectorId, 1)
      addDetails.run(spareSwitchPort.id, networkKindId, connectorId, 2)

      const connection = handle.database.query(`
        INSERT INTO project_connections (
          project_id, workspace_id, connection_type, source_side, target_side, created_at_ms
        ) VALUES (1, 2, 'network', 'bottom', 'top', 1)
        RETURNING id
      `).get() as { id: number }
      handle.database.query(`
        INSERT INTO connection_endpoints (workspace_id, connection_id, role, port_id)
        VALUES (2, ?, 'source', ?), (2, ?, 'target', ?)
      `).run(connection.id, switchPort.id, connection.id, patchPort.id)

      expect(() => handle.database.query('DELETE FROM inventory_ports WHERE id = ?').run(switchPort.id)).toThrow()

      const incompatibleConnection = handle.database.query(`
        INSERT INTO project_connections (
          project_id, workspace_id, connection_type, source_side, target_side, created_at_ms
        ) VALUES (1, 2, 'network', 'bottom', 'top', 1)
        RETURNING id
      `).get() as { id: number }
      handle.database.query(`
        INSERT INTO connection_endpoints (workspace_id, connection_id, role, port_id)
        VALUES (2, ?, 'source', ?)
      `).run(incompatibleConnection.id, spareSwitchPort.id)
      expect(() => handle.database.query(`
        INSERT INTO connection_endpoints (workspace_id, connection_id, role, port_id)
        VALUES (2, ?, 'target', ?)
      `).run(incompatibleConnection.id, upsPort.id)).toThrow(/incompatible/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('requires paired internal patch-panel ports to use opposite faces', async () => {
    const handle = await createDatabase()
    try {
      const patchItem = insertItem(handle.database, 5, 'Patch panel')
      handle.database.query('INSERT INTO patch_panels (id) VALUES (?)').run(patchItem.id)

      const addPort = handle.database.query(`
        INSERT INTO inventory_ports (item_id, created_at_ms) VALUES (?, 1) RETURNING id
      `)
      const frontPort = addPort.get(patchItem.id) as { id: number }
      const backPort = addPort.get(patchItem.id) as { id: number }
      const addDetails = handle.database.query(`
        INSERT INTO item_port_details (
          port_id, kind_id, connector_type_id, slot_number, origin
        ) VALUES (?, 1, 1, ?, 'fixed')
      `)
      addDetails.run(frontPort.id, 1)
      addDetails.run(backPort.id, 2)

      const frontFace = handle.database.query(`
        INSERT INTO port_endpoint_faces (port_id, endpoint_number, side)
        VALUES (?, 1, 'front')
        RETURNING id
      `).get(frontPort.id) as { id: number }
      const anotherFrontFace = handle.database.query(`
        INSERT INTO port_endpoint_faces (port_id, endpoint_number, side)
        VALUES (?, 1, 'front')
        RETURNING id
      `).get(backPort.id) as { id: number }

      expect(() => handle.database.query(`
        INSERT INTO internal_port_links (
          item_id, first_port_id, second_port_id,
          first_endpoint_face_id, second_endpoint_face_id, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, 1)
      `).run(
        patchItem.id,
        frontPort.id,
        backPort.id,
        frontFace.id,
        anotherFrontFace.id,
      )).toThrow(/opposite endpoint faces/iu)

      const backFace = handle.database.query(`
        INSERT INTO port_endpoint_faces (port_id, endpoint_number, side)
        VALUES (?, 2, 'back')
        RETURNING id
      `).get(backPort.id) as { id: number }
      handle.database.query(`
        INSERT INTO internal_port_links (
          item_id, first_port_id, second_port_id,
          first_endpoint_face_id, second_endpoint_face_id, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, 1)
      `).run(
        patchItem.id,
        frontPort.id,
        backPort.id,
        frontFace.id,
        backFace.id,
      )
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces workspace ownership, bend ordering, and replaceable route cache', async () => {
    const handle = await createDatabase()
    try {
      const connection = handle.database.query(`
        INSERT INTO project_connections (
          project_id, workspace_id, connection_type, source_side, target_side, created_at_ms
        ) VALUES (1, 2, 'other', 'right', 'left', 1)
        RETURNING id
      `).get() as { id: number }
      const secondProject = handle.database.query(`
        INSERT INTO projects (
          name, revision, includes_global_inventory, created_at_ms, updated_at_ms
        ) VALUES ('Other project', 1, 1, 1, 1)
        RETURNING id
      `).get() as { id: number }
      const otherWorkspace = handle.database.query(`
        INSERT INTO workspaces (
          project_id, type, name, icon_key, color_key, sort_order, revision,
          created_at_ms, updated_at_ms
        ) VALUES (?, 'canvas', 'Other canvas', 'network', 'green', 1, 1, 1, 1)
        RETURNING id
      `).get(secondProject.id) as { id: number }

      expect(() => handle.database.query(`
        INSERT INTO workspace_connection_visibility (
          project_id, workspace_id, connection_id, visible, updated_at_ms
        ) VALUES (?, ?, ?, 1, 1)
      `).run(secondProject.id, otherWorkspace.id, connection.id)).toThrow()

      handle.database.query(`
        INSERT INTO workspace_manual_bend_points (
          project_id, workspace_id, connection_id, position, x, y
        ) VALUES (1, 2, ?, 0, 12, 24)
      `).run(connection.id)
      expect(() => handle.database.query(`
        INSERT INTO workspace_manual_bend_points (
          project_id, workspace_id, connection_id, position, x, y
        ) VALUES (1, 2, ?, 0, 24, 36)
      `).run(connection.id)).toThrow()

      const workspaceRevisionBefore = handle.database.query(
        'SELECT revision FROM workspaces WHERE id = 2',
      ).get()
      const upsertRoute = handle.database.query(`
        INSERT INTO workspace_route_cache (
          project_id, workspace_id, connection_id, engine_version,
          layout_fingerprint, route_fingerprint, route_payload_json, calculated_at_ms
        ) VALUES (1, 2, ?, 'wasm-1', 'layout-a', ?, ?, ?)
        ON CONFLICT (workspace_id, connection_id) DO UPDATE SET
          engine_version = excluded.engine_version,
          layout_fingerprint = excluded.layout_fingerprint,
          route_fingerprint = excluded.route_fingerprint,
          route_payload_json = excluded.route_payload_json,
          calculated_at_ms = excluded.calculated_at_ms
      `)
      upsertRoute.run(connection.id, 'route-a', '{"points":[]}', 1)
      upsertRoute.run(connection.id, 'route-b', '{"points":[{"x":12,"y":24}]}', 2)

      expect(handle.database.query('SELECT COUNT(*) AS count FROM workspace_route_cache').get()).toEqual({ count: 1 })
      expect(handle.database.query('SELECT route_fingerprint FROM workspace_route_cache').get()).toEqual({
        route_fingerprint: 'route-b',
      })
      expect(handle.database.query('SELECT revision FROM workspaces WHERE id = 2').get()).toEqual(
        workspaceRevisionBefore,
      )
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
