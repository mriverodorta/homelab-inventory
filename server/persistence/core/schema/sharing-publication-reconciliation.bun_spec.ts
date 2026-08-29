import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { auditPublicationMigration } from '../../../../scripts/sharing/publication-preflight.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function committedMigrations() {
  const directory = resolve(import.meta.dir, '../migrations/generated')
  return Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(directory, migration.file), 'utf8'),
  })))
}

async function databaseAt(migrationCount: number) {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-sharing-reconciliation-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  const migrations = await committedMigrations()
  await applyCommittedMigrations(handle, migrations.slice(0, migrationCount))
  return { handle, migrations }
}

function insertShareFixture(database) {
  database.query(`
    INSERT INTO shares (
      id, project_id, remote_public_id, title, mutability, sync_mode, visibility,
      state, local_revision, remote_revision, created_at_ms, updated_at_ms
    ) VALUES (1, 1, 'share_legacy', 'Legacy share', 'replaceable', 'manual',
      'unlisted', 'publishing', 1, 4, 1, 1)
  `).run()
  database.query(`
    INSERT INTO share_local_revisions (
      id, share_id, revision, manifest_hash, manifest_json, created_at_ms
    ) VALUES (1, 1, 1, ?, '{}', 1)
  `).run('a'.repeat(64))
}

function insertLegacyOperation(database, input) {
  database.query(`
    INSERT INTO share_publication_operations (
      id, share_id, local_revision_id, idempotency_key, kind, state,
      attempt_count, available_at_ms, remote_operation_id, last_error_code,
      created_at_ms, updated_at_ms
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.kind === 'publish' ? 1 : null,
    input.key,
    input.kind,
    input.state,
    input.attemptCount ?? 0,
    input.availableAtMs ?? 1,
    input.remoteOperationId ?? null,
    input.lastErrorCode ?? null,
    input.createdAtMs ?? 1,
    input.updatedAtMs ?? input.createdAtMs ?? 1,
  )
}

describe('LabGD publication reconciliation migration', () => {
  test('classifies legacy intent without fabricating ambiguous revisions or changing evidence', async () => {
    const { handle, migrations } = await databaseAt(CORE_MIGRATIONS.length - 2)
    try {
      insertShareFixture(handle.database)
      insertLegacyOperation(handle.database, { id: 1, key: 'completed', kind: 'publish', state: 'succeeded', remoteOperationId: 120, attemptCount: 1 })
      insertLegacyOperation(handle.database, { id: 2, key: 'safe-queued', kind: 'publish', state: 'queued' })
      insertLegacyOperation(handle.database, { id: 3, key: 'running-remote', kind: 'publish', state: 'running', remoteOperationId: 132, attemptCount: 1, lastErrorCode: 'registry-definition-unavailable' })
      insertLegacyOperation(handle.database, { id: 4, key: 'retrying-remote', kind: 'publish', state: 'retrying', remoteOperationId: 133, attemptCount: 9, availableAtMs: 21_600_001, lastErrorCode: 'registry-definition-unavailable' })
      insertLegacyOperation(handle.database, { id: 5, key: 'failed-remote', kind: 'publish', state: 'failed', remoteOperationId: 134, attemptCount: 3, lastErrorCode: 'sharing-network-failed' })
      insertLegacyOperation(handle.database, { id: 6, key: 'touched-queued', kind: 'publish', state: 'queued', updatedAtMs: 2 })
      insertLegacyOperation(handle.database, { id: 7, key: 'legacy-delete', kind: 'delete', state: 'queued' })
      const projectBefore = handle.database.query('SELECT * FROM projects WHERE id = 1').get()
      const shareBefore = handle.database.query('SELECT * FROM shares WHERE id = 1').get()
      const localRevisionBefore = handle.database.query('SELECT * FROM share_local_revisions WHERE id = 1').get()
      const evidenceBefore = handle.database.query(`
        SELECT id, idempotency_key, state, attempt_count, available_at_ms,
          remote_operation_id, last_error_code, created_at_ms, updated_at_ms
        FROM share_publication_operations ORDER BY id
      `).all()

      await expect(applyCommittedMigrations(handle, migrations.slice(0, -1))).resolves.toEqual({ applied: 1, currentVersion: 35 })
      const receipt = handle.database.query(`
        SELECT completed_at_ms AS completedAtMs
        FROM schema_migrations WHERE migration_id = '0035_labgd_publication_convergence'
      `).get() as { completedAtMs: number }
      handle.database.query(`
        INSERT INTO share_publication_operations (
          id, share_id, local_revision_id, idempotency_key, kind, state,
          attempt_count, available_at_ms, expected_remote_revision,
          remote_operation_state, created_at_ms, updated_at_ms
        ) VALUES (8, 1, 1, 'post-migration-exact', 'publish', 'queued', 0, ?, 4,
          NULL, ?, ?)
      `).run(receipt.completedAtMs + 1, receipt.completedAtMs + 1, receipt.completedAtMs + 1)
      expect(auditPublicationMigration(handle.database)).toMatchObject({
        reconciliationRequiredCount: 4,
        groups: expect.arrayContaining([
          {
            kind: 'publish',
            state: 'running',
            remoteOperationPresent: true,
            expectedRevisionPresent: true,
            predatesMigration0035: true,
            count: 1,
          },
        ]),
      })

      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 1, currentVersion: 36 })
      expect(auditPublicationMigration(handle.database).reconciliationRequiredCount).toBe(4)

      expect(handle.database.query(`
        SELECT id, state, expected_remote_revision AS expectedRemoteRevision,
          predates_migration_0035 AS predatesMigration0035,
          revision_intent_provenance AS revisionIntentProvenance
        FROM share_publication_operations ORDER BY id
      `).all()).toEqual([
        { id: 1, state: 'succeeded', expectedRemoteRevision: null, predatesMigration0035: 1, revisionIntentProvenance: 'exact' },
        { id: 2, state: 'queued', expectedRemoteRevision: 4, predatesMigration0035: 1, revisionIntentProvenance: 'safe-backfill' },
        { id: 3, state: 'running', expectedRemoteRevision: null, predatesMigration0035: 1, revisionIntentProvenance: 'reconciliation-required' },
        { id: 4, state: 'retrying', expectedRemoteRevision: null, predatesMigration0035: 1, revisionIntentProvenance: 'reconciliation-required' },
        { id: 5, state: 'failed', expectedRemoteRevision: null, predatesMigration0035: 1, revisionIntentProvenance: 'reconciliation-required' },
        { id: 6, state: 'queued', expectedRemoteRevision: null, predatesMigration0035: 1, revisionIntentProvenance: 'reconciliation-required' },
        { id: 7, state: 'queued', expectedRemoteRevision: null, predatesMigration0035: 1, revisionIntentProvenance: 'exact' },
        { id: 8, state: 'queued', expectedRemoteRevision: 4, predatesMigration0035: 0, revisionIntentProvenance: 'exact' },
      ])
      expect(handle.database.query(`
        SELECT id, idempotency_key, state, attempt_count, available_at_ms,
          remote_operation_id, last_error_code, created_at_ms, updated_at_ms
        FROM share_publication_operations WHERE id <= 7 ORDER BY id
      `).all()).toEqual(evidenceBefore)
      expect(handle.database.query('SELECT * FROM projects WHERE id = 1').get()).toEqual(projectBefore)
      expect(handle.database.query('SELECT * FROM shares WHERE id = 1').get()).toEqual(shareBefore)
      expect(handle.database.query('SELECT * FROM share_local_revisions WHERE id = 1').get()).toEqual(localRevisionBefore)

      const afterFirstRun = handle.database.query('SELECT * FROM share_publication_operations ORDER BY id').all()
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 0, currentVersion: 36 })
      expect(handle.database.query('SELECT * FROM share_publication_operations ORDER BY id').all()).toEqual(afterFirstRun)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('is a deterministic data no-op when no unfinished publication exists', async () => {
    const { handle, migrations } = await databaseAt(CORE_MIGRATIONS.length - 1)
    try {
      const before = handle.database.query('SELECT count(*) AS count FROM share_publication_operations').get()
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 1, currentVersion: 36 })
      expect(handle.database.query('SELECT count(*) AS count FROM share_publication_operations').get()).toEqual(before)
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({ applied: 0, currentVersion: 36 })
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
