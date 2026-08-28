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
        lastConnectedAtMs: null,
        lastDisconnectedAtMs: null,
        lastRenewedAtMs: null,
        eventLastErrorCode: null,
        reconnectAttempt: 0,
        nextReconnectAtMs: null,
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
      const revisionBeforeConnectionUpdate = repository.getSettings().revision
      expect(repository.updateEventConnection({
        lastConnectedAtMs: Date.parse('2026-08-22T12:00:10.000Z'),
        lastDisconnectedAtMs: Date.parse('2026-08-22T12:00:20.000Z'),
        lastRenewedAtMs: Date.parse('2026-08-22T12:00:05.000Z'),
        lastErrorCode: 'sharing-events-failed',
        reconnectAttempt: 2,
        nextReconnectAtMs: Date.parse('2026-08-22T12:00:30.000Z'),
      })).toMatchObject({
        lastConnectedAtMs: Date.parse('2026-08-22T12:00:10.000Z'),
        lastDisconnectedAtMs: Date.parse('2026-08-22T12:00:20.000Z'),
        lastRenewedAtMs: Date.parse('2026-08-22T12:00:05.000Z'),
        eventLastErrorCode: 'sharing-events-failed',
        reconnectAttempt: 2,
        nextReconnectAtMs: Date.parse('2026-08-22T12:00:30.000Z'),
        revision: revisionBeforeConnectionUpdate,
      })
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
        embed: { enabled: true, origins: ['https://wiki.example.com:8443'] },
        resourceSnapshotIncluded: true,
        views: [{ workspaceId: 2, viewType: 'canvas' }],
      })
      expect(share).toMatchObject({
        id: 1,
        localRevision: 1,
        state: 'unpublished',
        embedEnabled: true,
        embedOrigins: ['https://wiki.example.com:8443'],
        resourceSnapshotIncluded: true,
      })
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
      expect(repository.cancelPendingOperations(share.id)).toBe(1)
      expect(repository.nextOperation()).toBeNull()
      expect(repository.enqueueOperation({
        shareId: share.id,
        localRevisionId: revisionId,
        idempotencyKey: 'publish:1:1',
        kind: 'publish',
      })).toMatchObject({ id: 1, state: 'queued' })
      expect(repository.updateShare(share.id, 1, { state: 'preview-ready', approvedPreviewHash: 'b'.repeat(64) })).toMatchObject({
        localRevision: 2,
        state: 'preview-ready',
      })
      expect(() => repository.updateShare(share.id, 1, { state: 'publishing' })).toThrow('revision conflict')

      const updated = repository.updateShareConfiguration(share.id, 2, {
        projectId: 1,
        title: 'Updated public canvas',
        mutability: 'replaceable',
        syncMode: 'manual',
        visibility: 'public',
        embed: { enabled: false },
        resourceSnapshotIncluded: false,
        views: [{ workspaceId: 2, viewType: 'canvas' }],
      })
      expect(updated.share).toMatchObject({
        localRevision: 3,
        title: 'Updated public canvas',
        state: 'unpublished',
        approvedPreviewHash: null,
        embedEnabled: false,
        embedOrigins: [],
        resourceSnapshotIncluded: false,
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('applies remote events and advances the cursor in one transaction', async () => {
    const { handle, repository } = await fixture()
    try {
      repository.saveInstallationProjection({clientInstanceId:'7a179ed6-7583-4dd2-8df2-fbb5e9fda786',keyId:'key-1',publicKeySpki:'spki',identityHash:'a'.repeat(64),remoteInstallationId:7,credentialExpiresAtMs:null,state:'active',recoveryPublicKeySpki:null})
      const share = repository.createShare({ projectId: 1, title: 'Remote share', mutability: 'replaceable', syncMode: 'manual', visibility: 'unlisted', views: [{ workspaceId: 1, viewType: 'systems' }] })
      repository.updateShare(share.id, share.localRevision, { remotePublicId: 'share_remote_1', remoteRevision: 2, state: 'synced' })
      expect(repository.applyRemoteEvent({ id: 40, kind: 'unpublish', payload: { eventVersion: 1, sharePublicId: 'share_remote_1', revision: 3, state: 'unpublished', occurredAt: '2026-08-22T12:00:00.000Z' } })).toMatchObject({ applied: true, shares: [{ state: 'unpublished', remoteRevision: 3 }] })
      expect(repository.getSettings().remoteEventCursor).toBe(40)
      expect(repository.applyRemoteEvent({ id: 40, kind: 'unpublish', payload: { eventVersion: 1, sharePublicId: 'share_remote_1', revision: 3, state: 'unpublished', occurredAt: '2026-08-22T12:00:00.000Z' } })).toEqual({ applied: false, shares: [] })
      const beforeClaim=repository.getShare(share.id)
      expect(()=>repository.applyRemoteEvent({ id: 41, kind: 'account-claim', payload: { eventVersion: 1, claimId: 'claim_1', state: 'completed', occurredAt: '2026-08-22T12:01:00.000Z' } })).toThrow('signed account status')
      repository.reconcileInstallationAccount({claimed:true,githubUsername:'mriverodorta',accountClaimedAtMs:Date.parse('2026-08-22T12:01:00.000Z')},41)
      expect(repository.getShare(share.id)).toMatchObject({accountClaimed:true,localRevision:beforeClaim?.localRevision})
      expect(repository.getInstallationProjection()).toMatchObject({accountClaimed:true,githubUsername:'mriverodorta'})
      expect(repository.getSettings().remoteEventCursor).toBe(41)
      expect(() => repository.applyRemoteEvent({ id: 42, kind: 'replacement', payload: { eventVersion: 1, sharePublicId: 'share_remote_1', revision: 4, state: 'hostile', occurredAt: '2026-08-22T12:02:00.000Z' } })).toThrow('state is invalid')
      expect(repository.getSettings().remoteEventCursor).toBe(41)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('persists durable account unlink attempts and applies authoritative dispositions atomically', async () => {
    const { handle, repository } = await fixture()
    try {
      repository.saveInstallationProjection({clientInstanceId:'5dc597d2-6064-4ab7-8387-af2282150758',keyId:'key-unlink',publicKeySpki:'spki',identityHash:'c'.repeat(64),remoteInstallationId:8,credentialExpiresAtMs:Date.parse('2026-08-23T12:00:00.000Z'),state:'active',recoveryPublicKeySpki:null})
      repository.reconcileInstallationAccount({claimed:true,githubUsername:'maikeldorta',accountClaimedAtMs:Date.parse('2026-08-22T12:01:00.000Z'),accountBindingRevision:3})
      const remote = repository.createShare({ projectId: 1, title: 'Remote share', mutability: 'replaceable', syncMode: 'manual', visibility: 'unlisted', views: [{ workspaceId: 1, viewType: 'systems' }] })
      repository.updateShare(remote.id, remote.localRevision, { remotePublicId: 'unlink_remote_1', remoteRevision: 2, state: 'synced' })
      const local = repository.createShare({ projectId: 1, title: 'Local draft', mutability: 'replaceable', syncMode: 'manual', visibility: 'unlisted', views: [{ workspaceId: 1, viewType: 'systems' }] })

      const prepared = repository.prepareAccountUnlink({
        clientAttemptId: '3c58e2df-f909-4131-b62c-7763682fc1d4',
        remoteIdempotencyKey: 'c3373662-7995-4179-824c-bfb08e80996d',
        expectedAccountBindingRevision: 3,
        shareDisposition: 'unpublish',
        actorUserId: 1,
      })
      expect(prepared).toMatchObject({ id: 1, state: 'pending', expectedAccountBindingRevision: 3, shareDisposition: 'unpublish' })
      expect(repository.getRemoteEventInterest()).toMatchObject({ required: true, pendingAccountOperations: 1 })
      expect(repository.prepareAccountUnlink({
        clientAttemptId: '3c58e2df-f909-4131-b62c-7763682fc1d4',
        remoteIdempotencyKey: 'different-key-is-ignored-for-an-existing-attempt',
        expectedAccountBindingRevision: 3,
        shareDisposition: 'unpublish',
        actorUserId: 1,
      })).toMatchObject({ id: 1, remoteIdempotencyKey: 'c3373662-7995-4179-824c-bfb08e80996d' })
      expect(() => repository.prepareAccountUnlink({
        clientAttemptId: '3c58e2df-f909-4131-b62c-7763682fc1d4',
        remoteIdempotencyKey: 'another-key',
        expectedAccountBindingRevision: 3,
        shareDisposition: 'delete',
        actorUserId: 1,
      })).toThrow('attempt conflict')

      const completed = repository.completeAccountUnlink({
        operationId: prepared.id,
        actorUserId: 1,
        result: {
          account: { connected: false, githubUsername: null, bindingRevision: 4 },
          disposition: 'unpublish',
          affected: { shares: 1, keptOnline: 0, unpublished: 1, deleted: 0 },
        },
      })
      expect(completed).toMatchObject({ sharesReconciled: true, affectedLocalShares: 1 })
      expect(repository.getInstallationProjection()).toMatchObject({ accountClaimed: false, githubUsername: null, accountBindingRevision: 4, state: 'active' })
      expect(repository.getShare(remote.id)).toMatchObject({ state: 'unpublished', remotePublicId: 'unlink_remote_1' })
      expect(repository.getShare(local.id)).toMatchObject({ state: 'unpublished', remotePublicId: null })
      expect(repository.getRemoteEventInterest()).toMatchObject({ required: false, activeShares: 0, pendingAccountOperations: 0 })
      expect(handle.database.query("SELECT type, actor_user_id AS actorUserId, details_json AS detailsJson FROM security_events WHERE type = 'sharing-account-unlinked'").get()).toMatchObject({ actorUserId: 1 })
      expect(repository.completeAccountUnlink({ operationId: prepared.id, actorUserId: 1, result: completed.result })).toMatchObject({ sharesReconciled: true })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('contains account unlink count drift until bounded lifecycle events reconcile shares', async () => {
    const { handle, repository } = await fixture()
    try {
      repository.saveInstallationProjection({clientInstanceId:'05416e89-1ad4-47a4-b768-3a7c7201a7a4',keyId:'key-drift',publicKeySpki:'spki',identityHash:'d'.repeat(64),remoteInstallationId:9,credentialExpiresAtMs:null,state:'active',recoveryPublicKeySpki:null})
      repository.reconcileInstallationAccount({claimed:true,githubUsername:'maikeldorta',accountClaimedAtMs:Date.parse('2026-08-22T12:01:00.000Z'),accountBindingRevision:1})
      const remote = repository.createShare({ projectId: 1, title: 'Remote share', mutability: 'replaceable', syncMode: 'manual', visibility: 'unlisted', views: [{ workspaceId: 1, viewType: 'systems' }] })
      repository.updateShare(remote.id, remote.localRevision, { remotePublicId: 'unlink_drift_1', remoteRevision: 2, state: 'synced' })
      const operation = repository.prepareAccountUnlink({clientAttemptId:'6a2226ec-bc96-41f0-92ea-707576787348',remoteIdempotencyKey:'daf069fc-03a8-44be-be24-010713574ebf',expectedAccountBindingRevision:1,shareDisposition:'delete',actorUserId:null})
      expect(repository.completeAccountUnlink({
        operationId: operation.id,
        actorUserId: null,
        result: { account: { connected: false, githubUsername: null, bindingRevision: 2 }, disposition: 'delete', affected: { shares: 2, keptOnline: 0, unpublished: 0, deleted: 2 } },
      })).toMatchObject({ sharesReconciled: false, affectedLocalShares: 1 })
      expect(repository.getInstallationProjection()).toMatchObject({ accountClaimed: false, accountBindingRevision: 2 })
      expect(repository.getShare(remote.id)).toMatchObject({ state: 'synced' })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('derives remote event interest from live shares and pending operations', async () => {
    const { handle, repository } = await fixture()
    try {
      expect(repository.getRemoteEventInterest()).toEqual({
        required: false,
        activeShares: 0,
        pendingPublicationOperations: 0,
        pendingAccountOperations: 0,
        recoveryPending: false,
      })

      const share = repository.createShare({
        projectId: 1,
        title: 'Demand-driven events',
        mutability: 'replaceable',
        syncMode: 'manual',
        visibility: 'unlisted',
        views: [{ workspaceId: 1, viewType: 'systems' }],
      })
      expect(repository.getRemoteEventInterest().required).toBe(false)

      repository.enqueueOperation({
        shareId: share.id,
        idempotencyKey: 'demand-driven-publish-1',
        kind: 'publish',
      })
      expect(repository.getRemoteEventInterest()).toMatchObject({ required: true, pendingPublicationOperations: 1 })

      const operation = repository.nextOperation()
      expect(operation).not.toBeNull()
      repository.updateOperation(operation!.id, { state: 'succeeded' })
      expect(repository.getRemoteEventInterest().required).toBe(false)

      let current = repository.getShare(share.id)!
      current = repository.updateShare(current.id, current.localRevision, {
        remotePublicId: 'demand_events_1',
        remoteRevision: 1,
        state: 'synced',
      })
      expect(repository.getRemoteEventInterest()).toMatchObject({ required: true, activeShares: 1 })

      repository.updateShare(current.id, current.localRevision, { state: 'unpublished' })
      expect(repository.getRemoteEventInterest()).toMatchObject({ required: false, activeShares: 0 })

      repository.updateEnrollment({ enrollmentState: repository.getSettings().enrollmentState, recoveryState: 'pending-owner-approval' })
      expect(repository.getRemoteEventInterest()).toMatchObject({ required: true, recoveryPending: true })
      repository.updateEnrollment({ enrollmentState: repository.getSettings().enrollmentState, recoveryState: null })
      expect(repository.getRemoteEventInterest().required).toBe(false)
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
