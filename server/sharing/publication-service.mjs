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

  enqueueLifecycle(shareId, kind) {
    if (!['unpublish', 'delete'].includes(kind)) throw new Error('Remote lifecycle operation is invalid.')
    const share = this.repository.getShare(shareId)
    if (!share?.remotePublicId || !share.remoteRevision) throw new Error('Share has no remote lifecycle state.')
    return this.repository.enqueueOperation({
      shareId,
      idempotencyKey: idempotencyKey(shareId, String(share.remoteRevision), kind),
      kind,
    })
  }

  async executeLifecycle(operation) {
    const share = this.repository.getShare(operation.shareId)
    if (!share?.remotePublicId || !share.remoteRevision) throw new Error('Lifecycle operation references missing remote state.')
    const result = operation.kind === 'unpublish'
      ? await this.client.unpublish(share.remotePublicId, share.remoteRevision, operation.idempotencyKey)
      : await this.client.delete(share.remotePublicId, share.remoteRevision, operation.idempotencyKey)
    this.repository.updateOperation(operation.id, { state: 'succeeded', lastErrorCode: null })
    const current = this.repository.getShare(share.id)
    const updated = this.repository.updateShare(share.id, current.localRevision, { remoteRevision: result.revision, state: result.state })
    this.onStateChanged(updated)
    return updated
  }

  async republish(shareId) {
    const share = this.repository.getShare(shareId)
    if (!share?.remotePublicId || !share.remoteRevision) throw new Error('Share has no retained remote revision.')
    const key = idempotencyKey(shareId, String(share.remoteRevision), 'republish')
    const result = await this.client.republish(share.remotePublicId, share.remoteRevision, key)
    const current = this.repository.getShare(shareId)
    const updated = this.repository.updateShare(shareId, current.localRevision, { remoteRevision: result.revision, state: result.state === 'active' ? 'synced' : result.state })
    this.onStateChanged(updated)
    return updated
  }

  async replacePassword(shareId, password) {
    const share = this.repository.getShare(shareId)
    if (!share?.remotePublicId || !share.remoteRevision) throw new Error('Share must be published before setting its password.')
    const key = idempotencyKey(shareId, String(share.remoteRevision), 'password')
    const result = await this.client.replacePassword(share.remotePublicId, share.remoteRevision, key, password)
    const current = this.repository.getShare(shareId)
    const updated = this.repository.updateShare(shareId, current.localRevision, { remoteRevision: result.revision })
    this.onStateChanged(updated)
    return { share: updated, passwordConfigured: true, viewerGrantsRevoked: true }
  }

  async updateRemoteSettings(shareId, input) {
    const share = this.repository.getShare(shareId)
    if (!share?.remotePublicId || !share.remoteRevision) return null
    const expiration = input.expiration?.type === 'at'
      ? { type: 'fixed', at: new Date(input.expiration.expiresAtMs).toISOString() }
      : input.expiration
    return this.client.settings(share.remotePublicId, share.remoteRevision, idempotencyKey(shareId, String(share.remoteRevision), 'settings'), {
      visibility: input.visibility,
      expiration,
      embed: input.embed,
      commentsEnabled: Boolean(input.commentsEnabled),
      reactionsEnabled: Boolean(input.reactionsEnabled),
    })
  }

  analytics(shareId) {
    const share = this.repository.getShare(shareId)
    if (!share?.remotePublicId) throw new Error('Share has not been published.')
    return this.client.analytics(share.remotePublicId)
  }

  async markRelevantChange(shareId, { debounceMs = 60_000, now = Date.now() } = {}) {
    const share = this.repository.getShare(shareId)
    if (!share || share.state === 'deleted') return null
    if (share.remoteRevision == null) return null
    const nextState = share.mutability === 'replaceable' && share.syncMode === 'synchronized'
      ? 'changes-pending'
      : 'manual-update-available'
    const updated = this.repository.updateShare(shareId, share.localRevision, { state: nextState })
    this.onStateChanged(updated)
    return this.scheduleCurrentState(shareId, { debounceMs, now })
  }

  async scheduleCurrentState(shareId, { debounceMs = 60_000, now = Date.now() } = {}) {
    const share = this.repository.getShare(shareId)
    if (!share || share.state === 'deleted' || share.remoteRevision == null) return null
    if (share.mutability !== 'replaceable' || share.syncMode !== 'synchronized') return null
    const preview = await this.preview(shareId)
    if (share.activeManifestHash === preview.manifestHash) {
      this.repository.cancelPendingOperations(shareId, 'publish')
      const current = this.repository.getShare(shareId)
      if (current.state !== 'synced') {
        const synced = this.repository.updateShare(shareId, current.localRevision, { state: 'synced' })
        this.onStateChanged(synced)
      }
      return null
    }
    this.repository.cancelPendingOperations(shareId, 'publish')
    return this.repository.enqueueOperation({
      shareId,
      localRevisionId: preview.localRevisionId,
      idempotencyKey: idempotencyKey(shareId, preview.manifestHash),
      kind: 'publish',
      availableAtMs: now + debounceMs,
    })
  }
}
