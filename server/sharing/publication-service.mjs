import { createHash } from 'node:crypto'

function idempotencyKey(shareId, manifestHash, kind = 'publish') {
  return createHash('sha256').update(`labgd:${kind}:${shareId}:${manifestHash}`).digest('hex')
}

export class SharingPublicationService {
  constructor({ repository, projector, sourceProvider, client, publicIds, onStateChanged = () => {} }) {
    this.repository = repository
    this.projector = projector
    this.sourceProvider = sourceProvider
    this.client = client
    this.publicIds = publicIds
    this.onStateChanged = onStateChanged
  }

  async projection(shareId) {
    const configuration = this.repository.getShareConfiguration(shareId)
    if (!configuration) throw new Error(`Share ${shareId} does not exist.`)
    const source = await this.sourceProvider(configuration)
    return { configuration, projected: await this.projector.project(source) }
  }

  async preview(shareId) {
    const { configuration, projected } = await this.projection(shareId)
    const localRevisionId = this.repository.persistRevision({
      shareId,
      revision: configuration.share.localRevision,
      manifestHash: projected.manifestHash,
      manifestJson: projected.manifestJson,
      blobs: projected.blobs,
    })
    return { ...projected, localRevisionId, approved: configuration.share.approvedPreviewHash === projected.manifestHash }
  }

  async approvePreview(shareId, manifestHash) {
    const { configuration, projected } = await this.projection(shareId)
    if (projected.manifestHash !== manifestHash) throw new Error('Share selections changed after the privacy preview.')
    const updated = this.repository.updateShare(shareId, configuration.share.localRevision, {
      state: 'preview-ready',
      approvedPreviewHash: manifestHash,
    })
    this.onStateChanged(updated)
    return updated
  }

  async enqueuePublish(shareId) {
    const preview = await this.preview(shareId)
    const current = this.repository.getShare(shareId)
    if (current.approvedPreviewHash !== preview.manifestHash) throw new Error('The current share must pass privacy preview before publication.')
    const operation = this.repository.enqueueOperation({
      shareId,
      localRevisionId: preview.localRevisionId,
      idempotencyKey: idempotencyKey(shareId, preview.manifestHash),
      kind: 'publish',
    })
    const updated = this.repository.updateShare(shareId, current.localRevision, { state: 'publishing' })
    this.onStateChanged(updated)
    return operation
  }

  async executePublish(operation) {
    const share = this.repository.getShare(operation.shareId)
    const local = this.repository.getLocalRevision(operation.localRevisionId)
    if (!share || !local) throw new Error('Publication operation references missing local state.')
    const manifest = JSON.parse(local.manifestJson)
    const remotePublicId = share.remotePublicId ?? await this.publicIds.id('share', share.id)
    const availableHashes = share.activeManifestHash === local.manifestHash ? local.blobs.map(({ contentHash }) => contentHash) : []
    const staged = await this.client.stage({
      idempotencyKey: operation.idempotencyKey,
      sharePublicId: remotePublicId,
      manifest,
      availableHashes,
    })
    this.repository.updateOperation(operation.id, { state: 'running', remoteOperationId: staged.operationId })
    const blobs = new Map(local.blobs.map((blob) => [blob.contentHash, blob]))
    for (const hash of staged.missingHashes) {
      const blob = blobs.get(hash)
      if (!blob) throw new Error(`lab.gd requested unknown share blob ${hash}.`)
      await this.client.upload(staged.operationId, blob)
    }
    await this.client.activate(staged.operationId, share.remoteRevision ?? 0)
    this.repository.updateOperation(operation.id, { state: 'succeeded', remoteOperationId: staged.operationId, lastErrorCode: null })
    const current = this.repository.getShare(share.id)
    const updated = this.repository.updateShare(share.id, current.localRevision, {
      remotePublicId,
      remoteRevision: (share.remoteRevision ?? 0) + 1,
      activeManifestHash: local.manifestHash,
      state: 'synced',
    })
    this.onStateChanged(updated)
    return updated
  }

  async markRelevantChange(shareId, { debounceMs = 60_000, now = Date.now() } = {}) {
    const share = this.repository.getShare(shareId)
    if (!share || share.state === 'deleted') return null
    const nextState = share.mutability === 'replaceable' && share.syncMode === 'synchronized'
      ? 'changes-pending'
      : 'manual-update-available'
    const updated = this.repository.updateShare(shareId, share.localRevision, { state: nextState })
    this.onStateChanged(updated)
    if (nextState === 'changes-pending') {
      const preview = await this.preview(shareId)
      return this.repository.enqueueOperation({
        shareId,
        localRevisionId: preview.localRevisionId,
        idempotencyKey: idempotencyKey(shareId, preview.manifestHash),
        kind: 'publish',
        availableAtMs: now + debounceMs,
      })
    }
    return null
  }
}
