import { sharingClientCapabilities } from './capabilities.mjs'

function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const error = new Error(`${label} must be a positive safe integer.`)
    error.status = 400
    error.code = 'sharing-invalid-request'
    throw error
  }
  return parsed
}

function routeError(response, error) {
  const status = Number.isInteger(error?.status) ? error.status : /revision conflict/iu.test(error?.message ?? '') ? 409 : 400
  response.status(status).json({
    message: error instanceof Error ? error.message : 'The sharing request could not be completed.',
    code: error?.code ?? (status === 409 ? 'sharing-revision-conflict' : 'sharing-request-failed'),
  })
}

function handle(response, operation) {
  void operation().catch((error) => routeError(response, error))
}

function disabledError({ demo, staging, effectiveEnabled }) {
  if (demo) return Object.assign(new Error('Sharing is unavailable in demo mode.'), { status: 403, code: 'sharing-disabled-in-demo' })
  if (staging) return Object.assign(new Error('Sharing is unavailable in staging mode.'), { status: 403, code: 'sharing-disabled-in-staging' })
  if (!effectiveEnabled) return Object.assign(new Error('Sharing is disabled by the server environment.'), { status: 403, code: 'sharing-disabled-by-environment' })
  return null
}

function publicSettings(repository, flags, capabilities) {
  const persisted = repository?.getSettings() ?? {
    revision: 0,
    connectionEnabled: false,
    enrollmentState: 'disabled',
    attemptCount: 0,
    nextAttemptAtMs: null,
    lastErrorCode: null,
    recoveryState: null,
  }
  const settings = flags.effectiveEnabled
    ? persisted
    : { ...persisted, enrollmentState: 'disabled', nextAttemptAtMs: null }
  const projection = repository?.getInstallationProjection?.() ?? null
  return {
    available: flags.effectiveEnabled,
    automaticEnrollment: flags.effectiveEnabled,
    demo: flags.demo,
    staging: flags.staging,
    origin: flags.origin,
    capabilities,
    settings: {
      ...settings,
      account: {
        claimed: projection?.accountClaimed ?? false,
        githubUsername: projection?.githubUsername ?? null,
        claimedAtMs: projection?.accountClaimedAtMs ?? null,
      },
    },
  }
}

export function registerSharingRoutes(app, {
  repository = null,
  publicationService = null,
  publicationCoordinator = null,
  enrollmentCoordinator = null,
  eventCoordinator = null,
  identityService = null,
  resourceSnapshotProvider = null,
  demo = false,
  staging = false,
  effectiveEnabled = false,
  origin = 'https://lab.gd',
  remoteCapabilities = {},
}) {
  const flags = { demo, staging, effectiveEnabled, origin }
  const currentCapabilities = () => sharingClientCapabilities({
    enabled: effectiveEnabled,
    publication: Boolean(publicationService),
    remote: identityService?.getCapabilities?.() ?? remoteCapabilities,
  })
  const requireRuntime = () => {
    const disabled = disabledError(flags)
    if (disabled) throw disabled
    if (!repository || !publicationService || !identityService) {
      throw Object.assign(new Error('Sharing runtime is unavailable.'), { status: 503, code: 'sharing-runtime-unavailable' })
    }
  }

  app.get('/api/sharing/settings', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(publicSettings(repository, flags, currentCapabilities()))
  })

  app.get('/api/sharing/capabilities', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(currentCapabilities())
  })

  app.patch('/api/sharing/settings', (request, response) => handle(response, async () => {
    requireRuntime()
    if (typeof request.body?.connectionEnabled !== 'boolean') throw new Error('connectionEnabled must be boolean.')
    const updated = repository.setConnectionEnabled(positiveId(request.body.expectedRevision, 'Expected revision'), request.body.connectionEnabled)
    enrollmentCoordinator?.wake()
    eventCoordinator?.wake()
    response.json(publicSettings(repository, flags, currentCapabilities()))
    return updated
  }))

  app.get('/api/sharing/shares', (request, response) => handle(response, async () => {
    requireRuntime()
    const projectId = request.query.projectId == null ? undefined : positiveId(request.query.projectId, 'Project ID')
    response.set('Cache-Control', 'no-store').json({ shares: repository.listShares(projectId) })
  }))

  app.get('/api/sharing/shares/:shareId', (request, response) => handle(response, async () => {
    requireRuntime()
    const configuration = repository.getShareConfiguration(positiveId(request.params.shareId, 'Share ID'))
    if (!configuration) throw Object.assign(new Error('Share was not found.'), { status: 404, code: 'sharing-share-not-found' })
    response.set('Cache-Control', 'no-store').json(configuration)
  }))

  app.post('/api/sharing/shares', (request, response) => handle(response, async () => {
    requireRuntime()
    const share = repository.createShare(request.body)
    response.status(201).json(repository.getShareConfiguration(share.id))
  }))

  app.patch('/api/sharing/shares/:shareId', (request, response) => handle(response, async () => {
    requireRuntime()
    const shareId = positiveId(request.params.shareId, 'Share ID')
    const expectedRevision = positiveId(request.body?.expectedRevision, 'Expected revision')
    const current = repository.getShare(shareId)
    if (!current) throw Object.assign(new Error('Share was not found.'), { status: 404, code: 'sharing-share-not-found' })
    if (current.localRevision !== expectedRevision) throw new Error('Share revision conflict.')
    const remote = current.remoteRevision == null ? null : await publicationService.updateRemoteSettings(shareId, request.body)
    const updated = repository.updateShareConfiguration(
      shareId,
      expectedRevision,
      request.body,
    )
    const committed = remote
      ? { ...updated, share: repository.updateShare(shareId, updated.share.localRevision, { remoteRevision: remote.revision, state: remote.state === 'active' ? 'synced' : remote.state }) }
      : updated
    await publicationService.scheduleCurrentState(committed.share.id)
    publicationCoordinator?.wake()
    response.json(committed)
  }))

  app.post('/api/sharing/shares/:shareId/preview', (request, response) => handle(response, async () => {
    requireRuntime()
    const preview = await publicationService.preview(positiveId(request.params.shareId, 'Share ID'))
    response.json({
      manifestHash: preview.manifestHash,
      manifest: preview.manifest,
      summary: preview.summary,
      byteLength: preview.byteLength,
      approved: preview.approved,
      views: preview.blobs.map(({ value }) => value),
    })
  }))

  app.post('/api/sharing/shares/:shareId/preview/approve', (request, response) => handle(response, async () => {
    requireRuntime()
    const share = await publicationService.approvePreview(
      positiveId(request.params.shareId, 'Share ID'),
      String(request.body?.manifestHash ?? ''),
    )
    response.json({ share })
  }))

  const publish = (request, response) => handle(response, async () => {
    requireRuntime()
    const operation = await publicationService.enqueuePublish(positiveId(request.params.shareId, 'Share ID'))
    publicationCoordinator?.wake()
    response.status(202).json({ operation })
  })
  app.post('/api/sharing/shares/:shareId/publish', publish)
  app.post('/api/sharing/shares/:shareId/update', publish)

  app.post('/api/sharing/shares/:shareId/resource-snapshot', (request, response) => handle(response, async () => {
    requireRuntime()
    if (!resourceSnapshotProvider) throw Object.assign(new Error('Resource snapshots are unavailable.'), { status: 503, code: 'sharing-resource-snapshot-unavailable' })
    const shareId = positiveId(request.params.shareId, 'Share ID')
    const snapshot = await resourceSnapshotProvider(repository.getShareConfiguration(shareId))
    const saved = repository.saveResourceSnapshot(shareId, snapshot.contentHash, snapshot.payload, snapshot.capturedAtMs)
    const share = repository.getShare(shareId)
    const updated = repository.updateShare(shareId, share.localRevision, {
      state: share.remoteRevision == null ? 'unpublished' : share.syncMode === 'synchronized' ? 'changes-pending' : 'manual-update-available',
      approvedPreviewHash: null,
    })
    response.json({ snapshot: saved, share: updated })
  }))

  app.post('/api/sharing/account/claim', (_request, response) => handle(response, async () => {
    requireRuntime()
    response.status(201).json(await identityService.createClaimDevice())
  }))

  app.post('/api/sharing/account/reconcile', (_request, response) => handle(response, async () => {
    requireRuntime()
    await identityService.reconcileAccountStatus()
    response.json(publicSettings(repository,flags,currentCapabilities()))
  }))

  app.post('/api/sharing/recovery/resume', (_request, response) => handle(response, async () => {
    requireRuntime()
    await identityService.resumeRecovery()
    enrollmentCoordinator?.wake()
    response.status(202).json({ status: 'resuming' })
  }))

  const enqueueLifecycle = (kind) => (request, response) => handle(response, async () => {
    requireRuntime()
    if (identityService.getCapabilities?.().remoteLifecycle !== true) throw Object.assign(new Error('Remote share lifecycle is unsupported.'), { status: 503, code: 'sharing-remote-lifecycle-unavailable' })
    const operation = publicationService.enqueueLifecycle(positiveId(request.params.shareId, 'Share ID'), kind)
    publicationCoordinator?.wake()
    response.status(202).json({ operation })
  })
  app.post('/api/sharing/shares/:shareId/unpublish', enqueueLifecycle('unpublish'))
  app.delete('/api/sharing/shares/:shareId', enqueueLifecycle('delete'))

  app.post('/api/sharing/shares/:shareId/republish', (request, response) => handle(response, async () => {
    requireRuntime()
    if (identityService.getCapabilities?.().remoteLifecycle !== true) throw Object.assign(new Error('Remote share lifecycle is unsupported.'), { status: 503, code: 'sharing-remote-lifecycle-unavailable' })
    response.json({ share: await publicationService.republish(positiveId(request.params.shareId, 'Share ID')) })
  }))

  app.put('/api/sharing/shares/:shareId/password', (request, response) => handle(response, async () => {
    requireRuntime()
    if (identityService.getCapabilities?.().protectedShares !== true) throw Object.assign(new Error('Protected share handoff is unsupported.'), { status: 503, code: 'sharing-password-unavailable' })
    if (typeof request.body?.password !== 'string') throw new Error('A password is required.')
    response.json(await publicationService.replacePassword(positiveId(request.params.shareId, 'Share ID'), request.body.password))
  }))

  app.get('/api/sharing/shares/:shareId/analytics', (request, response) => handle(response, async () => {
    requireRuntime()
    if (identityService.getCapabilities?.().ownerAnalytics !== true) throw Object.assign(new Error('Owner analytics are unsupported.'), { status: 503, code: 'sharing-analytics-unavailable' })
    response.set('Cache-Control', 'no-store').json(await publicationService.analytics(positiveId(request.params.shareId, 'Share ID')))
  }))
}
