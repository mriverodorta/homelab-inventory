import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { legacySemanticSnapshot } from '../legacy/semantic-snapshot.ts'
import { closeManagedDatabase, openManagedDatabase } from '../sqlite/database.ts'
import { applyCommittedMigrations } from '../sqlite/migrator.ts'
import { importLegacyCore } from './core-importer.ts'
import { verifyImportedCore } from './core-verifier.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function migratedDatabase() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-core-import-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDir = resolve(import.meta.dir, '../core/migrations/generated')
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  }))))
  return handle
}

describe('schema-29 core import', () => {
  test('imports a production-shaped snapshot in one verified relational graph', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    const identityPlan = buildCanonicalIdentityPlan(snapshot)
    try {
      expect(importLegacyCore({ database: handle.database, snapshot, identityPlan })).toEqual({
        projectId: 1,
        systemsWorkspaceId: 1,
        canvasWorkspaceId: 2,
      })
      expect(verifyImportedCore({ database: handle.database, expected: legacySemanticSnapshot(snapshot) })).toEqual({ ok: true })
      expect(handle.database.query('SELECT count(*) AS count FROM workspace_manual_bend_points').get()).toEqual({ count: 1 })
      expect(handle.database.query('SELECT count(*) AS count FROM workspace_route_cache').get()).toEqual({ count: 1 })
      expect(handle.database.query('SELECT count(*) AS count FROM host_resource_slots').get()).toEqual({ count: 4 })
      expect(handle.database.query('SELECT imported_revision FROM registry_links WHERE id = 1').get()).toEqual({ imported_revision: 1 })
      expect(handle.database.query('SELECT state FROM agent_host_bindings').get()).toEqual({ state: 'active' })
      expect(handle.database.query('SELECT local_time, retention_count FROM backup_schedules').get()).toEqual({ local_time: '03:30', retention_count: 14 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rolls the whole import back when a late relationship is invalid', async () => {
    const handle = await migratedDatabase()
    const snapshot = schema29ProductionShapeFixture()
    snapshot.notifications.contactPoints[0].type = 'unsupported'
    const identityPlan = buildCanonicalIdentityPlan(snapshot)
    try {
      expect(() => importLegacyCore({ database: handle.database, snapshot, identityPlan })).toThrow()
      expect(handle.database.query('SELECT count(*) AS count FROM inventory_items').get()).toEqual({ count: 0 })
      expect(handle.database.query('SELECT count(*) AS count FROM registry_sources').get()).toEqual({ count: 0 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects lossy canonical conversions and non-empty targets', async () => {
    const handle = await migratedDatabase()
    try {
      const lossy = schema29ProductionShapeFixture()
      lossy.inventory.ram[0].specs.capacityGb = 1 / 3
      expect(() => importLegacyCore({ database: handle.database, snapshot: lossy, identityPlan: buildCanonicalIdentityPlan(lossy) })).toThrow(/lose precision/iu)

      const valid = schema29ProductionShapeFixture()
      importLegacyCore({ database: handle.database, snapshot: valid, identityPlan: buildCanonicalIdentityPlan(valid) })
      expect(() => importLegacyCore({ database: handle.database, snapshot: valid, identityPlan: buildCanonicalIdentityPlan(valid) })).toThrow(/must not contain inventory/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
