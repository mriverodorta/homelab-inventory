import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { schema29ProductionShapeFixture } from '../../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../../legacy/identity-plan.ts'
import { importLegacyCore } from '../../migration/core-importer.ts'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { createRepositoryContext } from './repository-context.ts'
import { createSharingRepository } from './sharing-repository.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-sharing-repository-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  const repository = createSharingRepository(createRepositoryContext(handle.database, () => Date.parse('2026-08-22T12:00:00.000Z')))
  return { handle, repository }
}

describe('sharing repository', () => {
  test('starts connected-by-default enrollment in pending state with optimistic settings updates', async () => {
    const { handle, repository } = await fixture()
    try {
      expect(repository.getSettings()).toMatchObject({
        id: 1,
        revision: 1,
        connectionEnabled: true,
        enrollmentState: 'pending',
        attemptCount: 0,
      })
      expect(repository.setConnectionEnabled(1, false)).toMatchObject({
        revision: 2,
        connectionEnabled: false,
        enrollmentState: 'disabled',
      })
      expect(() => repository.setConnectionEnabled(1, true)).toThrow('revision conflict')
      expect(repository.setConnectionEnabled(2, true)).toMatchObject({
        revision: 3,
        connectionEnabled: true,
        enrollmentState: 'pending',
      })
      expect(repository.updateEnrollment({
        enrollmentState: 'retrying',
        attemptCount: 1,
        nextAttemptAtMs: Date.parse('2026-08-22T12:01:00.000Z'),
        lastErrorCode: 'labgd-unavailable',
      })).toMatchObject({ enrollmentState: 'retrying', attemptCount: 1 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('persists one rebuildable installation projection', async () => {
    const { handle, repository } = await fixture()
    try {
      const projection = {
        clientInstanceId: 'e332056f-1371-4bdc-ac2b-23290e125f12',
        keyId: 'sharing-test',
        publicKeySpki: 'public-key',
        identityHash: 'a'.repeat(64),
        remoteInstallationId: null,
        credentialExpiresAtMs: null,
        state: 'local' as const,
        recoveryPublicKeySpki: null,
      }
      expect(repository.saveInstallationProjection(projection)).toMatchObject(projection)
      expect(repository.saveInstallationProjection({ ...projection, remoteInstallationId: 7, state: 'active' })).toMatchObject({
        remoteInstallationId: 7,
        state: 'active',
      })
      repository.deleteInstallationProjection()
      expect(repository.getInstallationProjection()).toBeNull()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('stores relational share selections and immutable preview bytes', async () => {
    const { handle, repository } = await fixture()
    try {
      const share = repository.createShare({
        projectId: 1,
        title: 'Public canvas',
        mutability: 'replaceable',
        syncMode: 'synchronized',
        visibility: 'unlisted',
        views: [{ workspaceId: 2, viewType: 'canvas' }],
      })
      expect(share).toMatchObject({ id: 1, localRevision: 1, state: 'unpublished' })
      expect(repository.getShareConfiguration(share.id)).toMatchObject({
        views: [{ workspaceId: 2, viewType: 'canvas', displayOrder: 0 }],
      })
      const contentJson = JSON.stringify({ viewType: 'canvas', value: 'approved bytes' })
      const contentHash = createHash('sha256').update(contentJson).digest('hex')
      const revisionId = repository.persistRevision({
        shareId: share.id,
        revision: 1,
        manifestHash: 'b'.repeat(64),
        manifestJson: JSON.stringify({ contractVersion: 1 }),
        blobs: [{ contentHash, mediaType: 'application/vnd.homelab-inventory.canvas+json', contentJson }],
      })
      expect(repository.persistRevision({
        shareId: share.id,
        revision: 1,
        manifestHash: 'b'.repeat(64),
        manifestJson: JSON.stringify({ contractVersion: 1 }),
        blobs: [{ contentHash, mediaType: 'application/vnd.homelab-inventory.canvas+json', contentJson }],
      })).toBe(revisionId)
      expect(repository.getLocalRevision(revisionId)).toMatchObject({
        manifestHash: 'b'.repeat(64),
        blobs: [{ contentHash, contentJson }],
      })
      expect(repository.enqueueOperation({
        shareId: share.id,
        localRevisionId: revisionId,
        idempotencyKey: 'publish:1:1',
        kind: 'publish',
      })).toMatchObject({ id: 1, state: 'queued' })
      expect(repository.enqueueOperation({
        shareId: share.id,
        localRevisionId: revisionId,
        idempotencyKey: 'publish:1:1',
        kind: 'publish',
      })).toMatchObject({ id: 1 })
      expect(repository.nextOperation()).toMatchObject({ id: 1, shareId: 1 })
      expect(repository.updateShare(share.id, 1, { state: 'preview-ready', approvedPreviewHash: 'b'.repeat(64) })).toMatchObject({
        localRevision: 2,
        state: 'preview-ready',
      })
      expect(() => repository.updateShare(share.id, 1, { state: 'publishing' })).toThrow('revision conflict')
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
