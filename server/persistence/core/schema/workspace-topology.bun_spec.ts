import { afterEach, describe, expect, test } from 'bun:test'
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

async function createDatabase(migrationCount = CORE_MIGRATIONS.length) {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-workspace-topology-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDirectory = resolve(import.meta.dir, '../migrations/generated')
  const migrations = await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDirectory, migration.file), 'utf8'),
  })))
  await applyCommittedMigrations(handle, migrations.slice(0, migrationCount))
  return { handle, migrations }
}

describe('independent canvas topology', () => {
  test('assignments, cables, and endpoints record their owning workspace', async () => {
    const { handle } = await createDatabase()
    try {
      for (const table of [
        'component_assignments',
        'component_assignment_slots',
        'project_connections',
        'connection_endpoints',
      ]) {
        const columns = handle.database.query(`PRAGMA table_info(${table})`).all() as Array<{
          name: string
          notnull: number
        }>
        expect(columns.find((column) => column.name === 'workspace_id')).toMatchObject({ notnull: 1 })
      }
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('migrates independent canvas assignments and cables while preserving primary IDs', async () => {
    const workspaceMigrationIndex = CORE_MIGRATIONS.findIndex(
      (migration) => migration.id === '0032_workspace_owned_topology',
    )
    expect(workspaceMigrationIndex).toBeGreaterThan(0)
    const { handle, migrations } = await createDatabase(workspaceMigrationIndex)
    const workspaceMigrations = migrations.slice(0, workspaceMigrationIndex + 1)
    try {
      const database = handle.database
      const addItem = database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (?, 'global', NULL, ?, 1, 1, 1)
        RETURNING id
      `)
      const host = addItem.get(1, 'Shared host') as { id: number }
      const peer = addItem.get(4, 'Shared switch') as { id: number }
      const cpu = addItem.get(9, 'Reusable CPU') as { id: number }
      database.query('INSERT INTO servers (id) VALUES (?)').run(host.id)
      database.query('INSERT INTO network_switches (id) VALUES (?)').run(peer.id)
      database.query('INSERT INTO cpus (id) VALUES (?)').run(cpu.id)
      for (const itemId of [host.id, peer.id, cpu.id]) {
        database.query(`
          INSERT INTO project_inventory_memberships (project_id, item_id, created_at_ms)
          VALUES (1, ?, 1)
        `).run(itemId)
      }

      const secondWorkspace = database.query(`
        INSERT INTO workspaces (
          project_id, type, name, icon_key, color_key, sort_order, revision,
          created_at_ms, updated_at_ms
        ) VALUES (1, 'canvas', 'Independent canvas', 'network', 'purple', 2, 1, 1, 1)
        RETURNING id
      `).get() as { id: number }
      database.query('INSERT INTO canvas_workspaces (id) VALUES (?)').run(secondWorkspace.id)
      for (const workspaceId of [2, secondWorkspace.id]) {
        for (const itemId of [host.id, peer.id]) {
          database.query(`
            INSERT INTO workspace_placements (
              project_id, workspace_id, item_id, x, y, created_at_ms, updated_at_ms
            ) VALUES (1, ?, ?, 0, 0, 1, 1)
          `).run(workspaceId, itemId)
        }
      }

      const assignment = database.query(`
        INSERT INTO component_assignments (
          project_id, host_item_id, component_item_id, assigned_at_ms
        ) VALUES (1, ?, ?, 1)
        RETURNING id
      `).get(host.id, cpu.id) as { id: number }

      const addPort = database.query(`
        INSERT INTO inventory_ports (item_id, created_at_ms) VALUES (?, 1)
        RETURNING id
      `)
      const sourcePort = addPort.get(host.id) as { id: number }
      const targetPort = addPort.get(peer.id) as { id: number }
      for (const portId of [sourcePort.id, targetPort.id]) {
        database.query(`
          INSERT INTO item_port_details (port_id, kind_id, connector_type_id, slot_number, origin)
          VALUES (?, 1, 1, 1, 'fixed')
        `).run(portId)
      }

      const connection = database.query(`
        INSERT INTO project_connections (
          project_id, connection_type, source_side, target_side, created_at_ms
        ) VALUES (1, 'network', 'right', 'left', 1)
        RETURNING id
      `).get() as { id: number }
      database.query(`
        INSERT INTO connection_endpoints (connection_id, role, port_id)
        VALUES (?, 'source', ?), (?, 'target', ?)
      `).run(connection.id, sourcePort.id, connection.id, targetPort.id)
      database.query(`
        INSERT INTO workspace_route_cache (
          project_id, workspace_id, connection_id, engine_version, layout_fingerprint,
          route_fingerprint, route_payload_json, calculated_at_ms
        ) VALUES (1, 2, ?, 'wasm-1', 'layout', 'route', '{"points":[]}', 1)
      `).run(connection.id)

      await expect(applyCommittedMigrations(handle, workspaceMigrations)).resolves.toEqual({
        applied: 1,
        currentVersion: workspaceMigrationIndex + 1,
      })

      expect(database.query(`
        SELECT id, workspace_id, component_item_id
        FROM component_assignments WHERE host_item_id = ? ORDER BY workspace_id
      `).all(host.id)).toEqual([
        { id: assignment.id, workspace_id: 2, component_item_id: cpu.id },
        { id: assignment.id + 1, workspace_id: secondWorkspace.id, component_item_id: cpu.id },
      ])
      expect(database.query(`
        SELECT id, workspace_id FROM project_connections ORDER BY workspace_id
      `).all()).toEqual([
        { id: connection.id, workspace_id: 2 },
        { id: connection.id + 1, workspace_id: secondWorkspace.id },
      ])
      expect(database.query(`
        SELECT workspace_id, port_id FROM connection_endpoints
        WHERE port_id = ? ORDER BY workspace_id
      `).all(sourcePort.id)).toEqual([
        { workspace_id: 2, port_id: sourcePort.id },
        { workspace_id: secondWorkspace.id, port_id: sourcePort.id },
      ])
      expect(database.query(`
        SELECT connection_id, route_fingerprint FROM workspace_route_cache
      `).get()).toEqual({ connection_id: connection.id, route_fingerprint: 'route' })
      expect(database.query(`
        SELECT scope, owner_project_id FROM inventory_items WHERE id = ?
      `).get(host.id)).toEqual({ scope: 'project', owner_project_id: 1 })
      expect(database.query('PRAGMA foreign_key_check').all()).toEqual([])
      await expect(applyCommittedMigrations(handle, workspaceMigrations)).resolves.toEqual({
        applied: 0,
        currentVersion: workspaceMigrationIndex + 1,
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
