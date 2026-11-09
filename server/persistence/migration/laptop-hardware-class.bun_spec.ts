import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { buildLegacyInventoryProjection } from '../core/projections/legacy-project.ts'
import { openManagedDatabase } from '../sqlite/database.ts'
import { applyCommittedMigrations } from '../sqlite/migrator.ts'
import { schema29ProductionShapeFixture } from '../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { importLegacyCore } from './core-importer.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

test('0038 preserves every existing row, supports laptops and restarts idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hli-laptop-migration-'))
  roots.push(root)
  const filePath = join(root, 'core.sqlite')
  const handle = await openManagedDatabase({ filePath, schemaName: 'core' })
  const migrations = await Promise.all(CORE_MIGRATIONS.slice(0, 38).map(async migration => ({
    ...migration, sql: await readFile(resolve(import.meta.dir, '../core/migrations/generated', migration.file), 'utf8'),
  })))
  try {
    await applyCommittedMigrations(handle, migrations.slice(0, 37))
    const snapshot = schema29ProductionShapeFixture()
    importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
    const db = handle.database
    const tables = db.query("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name").all() as { name: string }[]
    const readRows = (name: string) => db.query(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort()
    const before = new Map(tables.map(({ name }) => [name, readRows(name)]))
    const failedVerification = migrations.map((migration, index) => index === 37
      ? { ...migration, verify() { throw new Error('Injected verification failure') } }
      : migration)
    await expect(applyCommittedMigrations(handle, failedVerification)).rejects.toThrow('Injected verification failure')
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 37 })
    expect(db.query('SELECT count(*) AS count FROM schema_migrations').get()).toEqual({ count: 37 })
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    for (const { name } of tables) expect(readRows(name)).toEqual(before.get(name)!)
    expect((await applyCommittedMigrations(handle, migrations)).applied).toBe(migrations.length - 37)
    for (const { name } of tables) expect(readRows(name)).toEqual(before.get(name)!)
    const host = db.query('SELECT id FROM servers ORDER BY id LIMIT 1').get() as { id: number }
    db.query("UPDATE servers SET hardware_class = 'laptop', usage_role = 'server' WHERE id = ?").run(host.id)
    expect(buildLegacyInventoryProjection(db).servers).toContainEqual(expect.objectContaining({ hardwareClass: 'laptop', usageRole: 'server' }))
    expect(() => db.query("UPDATE servers SET hardware_class = 'unknown' WHERE id = ?").run(host.id)).toThrow()
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    handle.close()
    const reopened = await openManagedDatabase({ filePath, schemaName: 'core' })
    try {
      expect((await applyCommittedMigrations(reopened, migrations)).applied).toBe(0)
      expect(reopened.database.query('SELECT hardware_class FROM servers WHERE id = ?').get(host.id)).toEqual({ hardware_class: 'laptop' })
      expect(reopened.database.query('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { reopened.close() }
  } finally { if (!handle.closed) handle.close() }
})
