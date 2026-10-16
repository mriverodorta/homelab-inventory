import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { openManagedDatabase } from '../sqlite/database.ts'
import { applyCommittedMigrations } from '../sqlite/migrator.ts'
import { schema29ProductionShapeFixture } from '../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { importLegacyCore } from './core-importer.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hli-pc-resource-migration-'))
  roots.push(root)
  const filePath = join(root, 'core.sqlite')
  const handle = await openManagedDatabase({ filePath, schemaName: 'core' })
  const migrations = await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    ...migration, sql: await readFile(resolve(import.meta.dir, '../core/migrations/generated', migration.file), 'utf8'),
  })))
  await applyCommittedMigrations(handle, migrations.slice(0, -1))
  const snapshot: any = schema29ProductionShapeFixture()
  snapshot.inventory.pcBuilds = [{ id: 1, name: 'Existing custom PC' }]
  snapshot.inventory.motherboards = [{ id: 1, name: 'Existing board', compatibility: { host: {
    cpu: { socketCount: 2, sockets: ['AM5'] }, memory: { slots: 4 },
  } } }]
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  // Reconstruct the previous release: it did not persist logical PC or board cooling resources.
  handle.database.exec(`CREATE TEMP TABLE removed_resources AS
    SELECT g.resource_identity_id FROM host_resource_groups g
    WHERE g.host_item_id IN (SELECT id FROM pc_builds) OR g.resource_type = 'cooling';
    DELETE FROM resource_identity_aliases WHERE resource_id IN (SELECT resource_identity_id FROM removed_resources);
    DELETE FROM host_resource_groups WHERE resource_identity_id IN (SELECT resource_identity_id FROM removed_resources);
    DELETE FROM inventory_resources WHERE id IN (SELECT resource_identity_id FROM removed_resources);
    DROP TABLE removed_resources;`)
  return { handle, migrations, filePath }
}

test('0037 preserves existing topology, adds missing resources, and is restart-idempotent', async () => {
  const { handle, migrations, filePath } = await fixture()
  try {
    const database = handle.database
    const tables = ['component_assignments', 'component_assignment_slots', 'workspace_placements', 'project_connections', 'connection_endpoints', 'workspace_route_cache', 'registry_links']
    const before = Object.fromEntries(tables.map((table) => [table, database.query(`SELECT * FROM ${table} ORDER BY id`).all()]))
    const slots = database.query('SELECT * FROM host_resource_slots ORDER BY id').all()
    expect((await applyCommittedMigrations(handle, migrations)).applied).toBe(1)
    for (const table of tables) {
      const rows = database.query(`SELECT * FROM ${table} ORDER BY id`).all() as Record<string, unknown>[]
      if (table === 'component_assignments') for (const row of rows) { expect(row.resource_provider_assignment_id).toBeNull(); delete row.resource_provider_assignment_id }
      expect(rows).toEqual(before[table])
    }
    expect(database.query('SELECT * FROM host_resource_slots ORDER BY id').all().slice(0, slots.length)).toEqual(slots)
    expect(database.query(`SELECT resource_type, slot_count FROM host_resource_groups WHERE host_item_id IN (SELECT id FROM pc_builds) ORDER BY resource_type`).all())
      .toEqual([{ resource_type: 'case', slot_count: 1 }, { resource_type: 'motherboard', slot_count: 1 }, { resource_type: 'power', slot_count: 1 }])
    expect(database.query("SELECT count(*) AS n FROM host_resource_slots s JOIN host_resource_groups g ON g.id = s.resource_group_id WHERE g.resource_type = 'cooling'").get()).toEqual({ n: 2 })
    const after = database.query('SELECT * FROM host_resource_slots ORDER BY id').all()
    handle.close()
    const reopened = await openManagedDatabase({ filePath, schemaName: 'core' })
    try {
      expect((await applyCommittedMigrations(reopened, migrations)).applied).toBe(0)
      expect(reopened.database.query('SELECT * FROM host_resource_slots ORDER BY id').all()).toEqual(after)
      expect(reopened.database.query('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { reopened.close() }
  } finally { if (!handle.closed) handle.close() }
})

test('0037 fails atomically on conflicting logical resource identities', async () => {
  const { handle, migrations } = await fixture()
  try {
    const db = handle.database
    db.exec(`INSERT INTO inventory_resources (item_id, created_at_ms) SELECT id, 1 FROM pc_builds;
      INSERT INTO host_resource_groups (resource_identity_id, host_item_id, resource_type, semantic_key, label, slot_count, created_at_ms)
      SELECT id, item_id, 'memory', 'motherboard', 'Conflicting resource', 2, 1 FROM inventory_resources WHERE item_id IN (SELECT id FROM pc_builds);`)
    const assignments = db.query('SELECT * FROM component_assignments ORDER BY id').all()
    expect(db.query("SELECT count(*) AS n FROM host_resource_groups WHERE semantic_key = 'motherboard' AND resource_type = 'memory'").get()).toEqual({ n: 1 })
    expect(db.query("SELECT count(*) AS n FROM host_resource_groups g JOIN pc_builds pc ON pc.id = g.host_item_id WHERE g.semantic_key = 'motherboard'").get()).toEqual({ n: 1 })
    await expect(applyCommittedMigrations(handle, migrations)).rejects.toThrow()
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 36 })
    expect(db.query('SELECT * FROM component_assignments ORDER BY id').all()).toEqual(assignments)
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
  } finally { handle.close() }
})
