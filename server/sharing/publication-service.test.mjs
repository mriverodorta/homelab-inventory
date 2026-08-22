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
      if (existing) return existing
      const operation = { id: nextOperationId++, attemptCount: 0, state: 'queued', availableAtMs: 0, ...input }
      operations.set(operation.id, operation)
      return operation
    },
    updateOperation: (id, patch) => operations.set(id, { ...operations.get(id), ...patch }),
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
    stage: vi.fn(async () => ({ operationId: 9, missingHashes: ['a'.repeat(64)] })),
    upload: vi.fn(async () => {}),
    activate: vi.fn(async () => ({ revisionId: 12 })),
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

  it('rejects publication when selections changed after preview', async () => {
    const { publication } = service()
    await expect(publication.enqueuePublish(1)).rejects.toThrow('privacy preview')
    await expect(publication.approvePreview(1, 'd'.repeat(64))).rejects.toThrow('changed')
  })

  it('debounces synchronized shares while manual shares only become update available', async () => {
    const synchronized = service('synchronized')
    const scheduled = await synchronized.publication.markRelevantChange(1, { now: 1_000, debounceMs: 60_000 })
    expect(scheduled).toMatchObject({ kind: 'publish', availableAtMs: 61_000, localRevisionId: 1 })
    expect(synchronized.repo.getShare()).toMatchObject({ state: 'changes-pending' })

    const manual = service('manual')
    expect(await manual.publication.markRelevantChange(1)).toBeNull()
    expect(manual.repo.getShare()).toMatchObject({ state: 'manual-update-available' })
    expect(manual.repo.operations.size).toBe(0)
  })
})
