import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../persistence/fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../persistence/legacy/identity-plan.ts'
import { importLegacyCore } from '../persistence/migration/core-importer.ts'
import { openManagedDatabase } from '../persistence/sqlite/database.ts'
import { applyCommittedMigrations } from '../persistence/sqlite/migrator.ts'
import { SqliteHomelabInventoryStore } from '../persistence/sqlite-store.ts'
import { BackupService } from './backup-service.mjs'
import { inspectArchiveBuffer } from './archive-envelope.mjs'
import { preflightRestore } from './restore-preflight.mjs'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function context() {
  const dataDir = await mkdtemp(join(tmpdir(), 'hli-sqlite-backup-'))
  roots.push(dataDir)
  const core = await openManagedDatabase({
    filePath: join(dataDir, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  await applyCommittedMigrations(core, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../persistence/core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: core.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  const store = new SqliteHomelabInventoryStore({
    core,
    dataDir,
    appVersion: '0.12.0',
    now: () => Date.parse('2026-08-12T02:00:00.000Z'),
  })
  const service = new BackupService({ store, appVersion: '0.12.0' })
  await service.init()
  return { service, store }
}

describe('SQLite portable backup service', () => {
  test('creates a v2 archive and selectively restores inventory without changing project relationships', async () => {
    const { service, store } = await context()
    try {
      const projectBefore = structuredClone((await store.snapshotStores()).project)
      const created = await service.create({ sections: ['inventory'], persist: false })

      expect(created.manifest).toMatchObject({
        formatVersion: 2,
        schemaVersion: 29,
        databaseSchemas: { core: CORE_MIGRATIONS.length, telemetry: null, catalog: null },
      })

      const server = store.getProject().items['server:7'] as any
      store.updateInventoryItem({ type: 'server', id: 7 }, { ...server, name: 'Temporary restore target' })
      const projectImmediatelyBeforeRestore = structuredClone((await store.snapshotStores()).project)
      const parsed = await inspectArchiveBuffer(created.archive)
      const preflight = preflightRestore({
        manifest: { ...parsed.manifest, sections: ['inventory'] },
        files: parsed.files,
        currentStores: await store.snapshotStores(),
      })
      expect(preflight.blockers).toEqual([])

      await service.applyParsed(parsed, ['inventory'])

      expect((store.getProject().items['server:7'] as any).name).toBe(server.name)
      expect((await store.snapshotStores()).project).toEqual(projectImmediatelyBeforeRestore)
      expect(projectImmediatelyBeforeRestore.revision).toBe(projectBefore.revision + 1)
    } finally {
      store.close()
    }
  })

  test('remaps persisted compatibility findings to restored semantic resource slots', async () => {
    const { service, store } = await context()
    try {
      const database = store.core.database
      database.query(`
        INSERT INTO compatibility_audit_findings (
          id, project_id, host_item_id, component_item_id, assignment_id,
          resource_slot_id, finding_key, rule_key, severity, classification,
          message, details_json, first_seen_at_ms, last_seen_at_ms, resolved_at_ms
        ) VALUES (1, 1, 1, 4, 3, 4, 'finding:storage-slot', 'storage.form-factor',
          'warning', 'actionable', 'Storage slot mismatch.', '{}', 1, 1, NULL)
      `).run()

      const created = await service.create({ sections: ['inventory', 'project'], persist: false })
      const parsed = await inspectArchiveBuffer(created.archive)
      const projectFile = 'sections/project.json'
      const project = JSON.parse(parsed.files.get(projectFile)!.toString('utf8'))
      const archivedSlot = project.workbooks.identities.resourceSlots
        .find((identity: any) => identity.canonical_id === 4)
      expect(archivedSlot).toBeDefined()
      project.workbooks.identities.resourceSlots.push({ ...archivedSlot, canonical_id: 999 })
      project.workbooks.tables.compatibility_audit_findings[0].resource_slot_id = 999
      parsed.files.set(projectFile, Buffer.from(`${JSON.stringify(project, null, 2)}\n`))

      await service.applyParsed(parsed, ['inventory', 'project'])

      const finding = store.core.database.query(`
        SELECT finding.resource_slot_id AS resourceSlotId,
               assignment.resource_slot_id AS assignmentSlotId,
               resource.position, resource_alias.legacy_resource_key AS resourceKey
        FROM compatibility_audit_findings finding
        JOIN component_assignments assignment ON assignment.id = finding.assignment_id
        JOIN host_resource_slots resource ON resource.id = finding.resource_slot_id
        JOIN host_resource_groups resource_group ON resource_group.id = resource.resource_group_id
        JOIN resource_identity_aliases resource_alias
          ON resource_alias.resource_id = resource_group.resource_identity_id
        WHERE finding.finding_key = 'finding:storage-slot'
      `).get() as any
      expect(finding).toEqual({
        resourceSlotId: finding.assignmentSlotId,
        assignmentSlotId: finding.resourceSlotId,
        position: 1,
        resourceKey: 'm2-storage',
      })
    } finally {
      store.close()
    }
  })
})
