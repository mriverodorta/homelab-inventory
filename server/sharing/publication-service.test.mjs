import { describe, expect, it, vi } from 'vitest'
import { SharingPublicationService } from './publication-service.mjs'

function repository(syncMode = 'manual') {
  let share = {
    id: 1, projectId: 1, remotePublicId: null, remoteRevision: null,
    localRevision: 1, state: 'unpublished', mutability: 'replaceable', syncMode,
    approvedPreviewHash: null, activeManifestHash: null,
  }
  let nextRevisionId = 1
  let nextOperationId = 1
  const revisions = new Map()
  const operations = new Map()
  return {
    getShare: () => ({ ...share }),
    getShareConfiguration: () => ({ share: { ...share }, views: [], fieldDefinitionIds: [], tagIds: [] }),
    updateShare: (_id, expected, patch) => {
      if (expected !== share.localRevision) throw new Error('revision conflict')
      share = { ...share, ...patch, localRevision: share.localRevision + 1 }
      return { ...share }
    },
    persistRevision: (input) => {
      const existing = [...revisions.values()].find(({ manifestHash }) => manifestHash === input.manifestHash)
      if (existing) return existing.id
      const entry = { id: nextRevisionId++, ...input }
      revisions.set(entry.id, entry)
      return entry.id
    },
    getLocalRevision: (id) => revisions.get(id) ?? null,
    enqueueOperation: (input) => {
      const existing = [...operations.values()].find(({ idempotencyKey }) => idempotencyKey === input.idempotencyKey)
      if (existing) {
        if (existing.state === 'cancelled') Object.assign(existing, input, { state: 'queued', attemptCount: 0 })
        return existing
      }
      const operation = { id: nextOperationId++, attemptCount: 0, state: 'queued', availableAtMs: 0, ...input }
      operations.set(operation.id, operation)
      return operation
    },
    updateOperation: (id, patch) => operations.set(id, { ...operations.get(id), ...patch }),
    recordRemoteStage: (id, staged) => {
      const current = operations.get(id)
      if (current.remoteOperationId != null && current.remoteOperationId !== staged.operationId) throw new Error('remote operation changed')
      const updated = { ...current, state: 'running', remoteOperationId: staged.operationId, remoteOperationState: staged.state, remoteFailureCode: staged.failureCode, remoteMissingHashes: staged.missingHashes, activationRevisionId: staged.activationResult?.revisionId ?? null }
      operations.set(id, updated)
      return updated
    },
    completePublication: (input) => {
      const current = operations.get(input.operationId)
      operations.set(input.operationId, { ...current, state: 'succeeded', activationRevisionId: input.activationRevisionId })
      if (share.remoteRevision == null || share.remoteRevision <= input.resultingRemoteRevision) {
        share = { ...share, remotePublicId: input.remotePublicId, remoteRevision: input.resultingRemoteRevision, activeManifestHash: input.manifestHash, state: 'synced', localRevision: share.localRevision + 1 }
      }
      return { projection: 'converged', share: { ...share } }
    },
    cancelPendingOperations: (_shareId, kind = 'publish') => {
      let count = 0
      for (const operation of operations.values()) {
        if (operation.kind === kind && ['queued', 'retrying'].includes(operation.state)) {
          operation.state = 'cancelled'
          count += 1
        }
      }
      return count
    },
    operations,
  }
}

const projected = {
  manifest: { shareContractVersion: 1, views: [{ contentHash: 'a'.repeat(64) }] },
  manifestJson: JSON.stringify({ shareContractVersion: 1, views: [{ contentHash: 'a'.repeat(64) }] }),
  manifestHash: 'b'.repeat(64),
  blobs: [
    { contentHash: 'a'.repeat(64), contentJson: JSON.stringify({ viewType: 'canvas' }), mediaType: 'application/json' },
    { contentHash: 'c'.repeat(64), contentJson: JSON.stringify({ viewType: 'systems' }), mediaType: 'application/json' },
  ],
  summary: { views: 2 },
}

function service(syncMode = 'manual') {
  const repo = repository(syncMode)
  const client = {
    stage: vi.fn(async () => ({ operationId: 9, state: 'ready', failureCode: null, missingHashes: ['a'.repeat(64)], activationResult: null })),
    upload: vi.fn(async () => {}),
    activate: vi.fn(async (operationId) => ({ operationId, revisionId: 12 })),
  }
  const publication = new SharingPublicationService({
    repository: repo,
    projector: { project: vi.fn(async () => projected) },
    sourceProvider: vi.fn(async ({ share }) => ({ share })),
    client,
    publicIds: { id: vi.fn(async () => 'share_public_0001') },
  })
  return { repo, client, publication }
}

describe('sharing publication service', () => {
  it('publishes the exact approved bytes and uploads only missing hashes', async () => {
    const { repo, client, publication } = service()
    const preview = await publication.preview(1)
    await publication.approvePreview(1, preview.manifestHash)
    const operation = await publication.enqueuePublish(1)
    await publication.executePublish(operation)
    expect(client.stage).toHaveBeenCalledWith(expect.objectContaining({ manifest: projected.manifest, availableHashes: [] }))
    expect(client.upload).toHaveBeenCalledTimes(1)
    expect(client.upload).toHaveBeenCalledWith(9, expect.objectContaining({ contentHash: 'a'.repeat(64), contentJson: projected.blobs[0].contentJson }))
    expect(client.activate).toHaveBeenCalledWith(9, 0)
    expect(repo.getShare()).toMatchObject({ state: 'synced', remotePublicId: 'share_public_0001', remoteRevision: 1, activeManifestHash: projected.manifestHash })
  })

  it('replays one remote operation and public ID after credential recovery', async () => {
    const { repo, client, publication } = service()
    client.stage.mockResolvedValue({ operationId: 132, state: 'ready', failureCode: null, missingHashes: [], activationResult: null })
    client.activate
      .mockRejectedValueOnce(Object.assign(new Error('Authentication failed.'), { code: 'authentication-failed' }))
      .mockResolvedValueOnce({ operationId: 132, revisionId: 133 })
    const preview = await publication.preview(1)
    await publication.approvePreview(1, preview.manifestHash)
    const operation = await publication.enqueuePublish(1)

    await expect(publication.executePublish(operation)).rejects.toMatchObject({ code: 'authentication-failed' })
    expect(repo.getShare()).toMatchObject({ state: 'publishing', remotePublicId: null, remoteRevision: null, activeManifestHash: null })
    expect(repo.operations.get(operation.id)).toMatchObject({ id: operation.id, state: 'running', remoteOperationId: 132, expectedRemoteRevision: 0 })
    await publication.executePublish(operation)

    expect(repo.operations.size).toBe(1)
    expect(client.stage).toHaveBeenCalledTimes(2)
    expect(client.stage.mock.calls[0][0]).toEqual(client.stage.mock.calls[1][0])
    expect(client.activate).toHaveBeenNthCalledWith(1, 132, 0)
    expect(client.activate).toHaveBeenNthCalledWith(2, 132, 0)
    expect(repo.operations.get(operation.id)).toMatchObject({ state: 'succeeded', remoteOperationId: 132 })
    expect(repo.getShare()).toMatchObject({ state: 'synced', remotePublicId: 'share_public_0001', remoteRevision: 1 })
  })

  it('recovers the same Registry-blocked operation after staging replay exposes the durable failure', async () => {
    const { repo, client, publication } = service()
    const ready = { operationId: 132, state: 'ready', failureCode: null, missingHashes: [], activationResult: null }
    const blocked = { operationId: 132, state: 'failed', failureCode: 'registry-definition-unavailable', missingHashes: [], activationResult: null }
    client.stage.mockResolvedValueOnce(ready).mockResolvedValueOnce(blocked).mockResolvedValueOnce(blocked)
    client.activate
      .mockRejectedValueOnce(Object.assign(new Error('generic activation conflict'), { code: 'publication-failed', status: 409 }))
      .mockResolvedValueOnce({ operationId: 132, revisionId: 733 })
    const preview = await publication.preview(1)
    await publication.approvePreview(1, preview.manifestHash)
    const operation = await publication.enqueuePublish(1)

    await expect(publication.executePublish(operation)).rejects.toMatchObject({ code: 'registry-definition-unavailable' })
    await publication.executePublish(repo.operations.get(operation.id))

    expect(repo.operations.size).toBe(1)
    expect(client.stage.mock.calls.map(([request]) => request.sharePublicId)).toEqual(['share_public_0001', 'share_public_0001', 'share_public_0001'])
    expect(client.activate).toHaveBeenNthCalledWith(1, 132, 0)
    expect(client.activate).toHaveBeenNthCalledWith(2, 132, 0)
    expect(repo.getShare()).toMatchObject({ remotePublicId: 'share_public_0001', remoteRevision: 1, state: 'synced' })
  })

  it('converges an active staging replay without activating or incrementing twice', async () => {
    const { repo, client, publication } = service()
    client.stage.mockResolvedValue({ operationId: 132, state: 'active', failureCode: null, missingHashes: [], activationResult: { operationId: 132, revisionId: 733 } })
    const preview = await publication.preview(1)
    await publication.approvePreview(1, preview.manifestHash)
    const operation = await publication.enqueuePublish(1)
    repo.updateShare(1, repo.getShare().localRevision, { remotePublicId: 'share_public_0001', remoteRevision: 1, state: 'synced' })

    await publication.executePublish(operation)

    expect(client.activate).not.toHaveBeenCalled()
    expect(repo.getShare()).toMatchObject({ remoteRevision: 1, activeManifestHash: projected.manifestHash, state: 'synced' })
  })

  it('rejects publication when selections changed after preview', async () => {
    const { publication } = service()
    await expect(publication.enqueuePublish(1)).rejects.toThrow('privacy preview')
    await expect(publication.approvePreview(1, 'd'.repeat(64))).rejects.toThrow('changed')
  })

  it('debounces synchronized shares while manual shares only become update available', async () => {
    const synchronized = service('synchronized')
    synchronized.repo.updateShare(1, 1, { remoteRevision: 1, state: 'synced' })
    const scheduled = await synchronized.publication.markRelevantChange(1, { now: 1_000, debounceMs: 60_000 })
    expect(scheduled).toMatchObject({ kind: 'publish', availableAtMs: 61_000, localRevisionId: 1 })
    expect(synchronized.repo.getShare()).toMatchObject({ state: 'changes-pending' })

    const manual = service('manual')
    manual.repo.updateShare(1, 1, { remoteRevision: 1, state: 'synced' })
    expect(await manual.publication.markRelevantChange(1)).toBeNull()
    expect(manual.repo.getShare()).toMatchObject({ state: 'manual-update-available' })
    expect(manual.repo.operations.size).toBe(0)
  })

  it('collapses repeated synchronized changes into one pending publication', async () => {
    const synchronized = service('synchronized')
    synchronized.repo.updateShare(1, 1, { remoteRevision: 1, state: 'synced' })
    await synchronized.publication.markRelevantChange(1, { now: 1_000 })
    await synchronized.publication.markRelevantChange(1, { now: 2_000 })
    expect([...synchronized.repo.operations.values()].filter(({ state }) => state === 'queued')).toHaveLength(1)
    expect([...synchronized.repo.operations.values()].filter(({ state }) => state === 'cancelled')).toHaveLength(0)
  })

  it('does not schedule unpublished shares when local project data changes', async () => {
    const unpublished = service('synchronized')
    expect(await unpublished.publication.markRelevantChange(1)).toBeNull()
    expect(unpublished.repo.getShare()).toMatchObject({ state: 'unpublished', localRevision: 1 })
    expect(unpublished.repo.operations.size).toBe(0)
  })
})
