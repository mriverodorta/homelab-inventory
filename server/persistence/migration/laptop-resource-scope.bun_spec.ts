import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { openManagedDatabase } from '../sqlite/database.ts'
import { applyCommittedMigrations } from '../sqlite/migrator.ts'
import { schema29ProductionShapeFixture } from '../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { importLegacyCore } from './core-importer.ts'

test('0039 scopes laptop aliases without changing resource IDs or relationships and rolls back on verification failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hli-laptop-scope-'))
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  try {
    const migrations = await Promise.all(CORE_MIGRATIONS.map(async migration => ({
      ...migration, sql: await readFile(resolve(import.meta.dir, '../core/migrations/generated', migration.file), 'utf8'),
    })))
    await applyCommittedMigrations(handle, migrations.slice(0, 38))
    const snapshot = schema29ProductionShapeFixture()
    importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
    const db = handle.database
    const host = db.query('SELECT id FROM servers ORDER BY id LIMIT 1').get() as { id: number }
    db.query("UPDATE servers SET hardware_class = 'laptop' WHERE id = ?").run(host.id)
    const aliases = db.query('SELECT * FROM resource_identity_aliases ORDER BY id').all() as Record<string, any>[]
    const scoped = db.query(`SELECT a.id, '@v13:' || g.resource_type || ':' || g.semantic_key AS key
      FROM resource_identity_aliases a JOIN host_resource_groups g ON g.id = a.resource_id
      WHERE g.host_item_id = ? AND g.resource_type IN ('storage','expansion','optionalModule','controllerSlot','bootDeviceSlot','coolingProfile')`).all(host.id) as { id: number; key: string }[]
    expect(scoped.length).toBeGreaterThan(0)
    const tables = ['inventory_resources', 'host_resource_groups', 'host_resource_slots', 'component_assignments', 'component_assignment_slots', 'workspace_placements', 'project_connections', 'connection_endpoints']
    const read = () => tables.map(table => db.query(`SELECT * FROM ${table} ORDER BY id`).all())
    const before = read()
    const failure = migrations.map(migration => migration.id === '0039_scoped_laptop_resources'
      ? { ...migration, verify() { throw new Error('Synthetic verification failure') } } : migration)
    await expect(applyCommittedMigrations(handle, failure)).rejects.toThrow('Synthetic verification failure')
    expect(read()).toEqual(before)
    expect(db.query('SELECT * FROM resource_identity_aliases ORDER BY id').all()).toEqual(aliases)
    expect((await applyCommittedMigrations(handle, migrations)).applied).toBe(1)
    expect(read()).toEqual(before)
    expect(db.query('SELECT * FROM resource_identity_aliases ORDER BY id').all()).toEqual(aliases.map(alias => ({
      ...alias, legacy_resource_key: scoped.find(row => row.id === alias.id)?.key ?? alias.legacy_resource_key,
    })))
    expect((await applyCommittedMigrations(handle, migrations)).applied).toBe(0)
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    handle.close()
    await rm(root, { recursive: true, force: true })
  }
})
