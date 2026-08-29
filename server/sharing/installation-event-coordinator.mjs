const EVENT_KINDS = new Set(['publication', 'replacement', 'unpublish', 'deletion', 'expiration', 'grace-period', 'account-claim', 'account-unlink', 'recovery'])
const SHARE_EVENT_KINDS = new Set(['publication', 'replacement', 'unpublish', 'deletion', 'expiration', 'grace-period'])
const MAX_FRAME_BYTES = 64 * 1024
const MAX_BACKOFF_MS = 60_000
const BASE_BACKOFF_MS = 1_000
const BACKOFF_JITTER_RATIO = 0.2
const TOKEN_REFRESH_MARGIN_MS = 90_000
const CONNECTION_LIVENESS_MS = 2 * 60_000
const HEARTBEAT_SILENCE_MS = 45_000
const ACCOUNT_RECONCILE_MAX_AGE_MS = 6 * 60 * 60_000
const DEFAULT_INTEREST = Object.freeze({
  required: true,
  activeShares: 0,
  pendingPublicationOperations: 0,
  pendingAccountOperations: 0,
  recoveryPending: false,
  pendingClaim: false,
  pendingClaimExpiresAtMs: null,
})

export class SharingInstallationEventCoordinator {
  constructor({
    repository,
    client,
    identityService,
    effectiveEnabled = true,
    onStateChanged = () => {},
    now = Date.now,
    random = Math.random,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    logger = console,
    tokenRefreshMarginMs = TOKEN_REFRESH_MARGIN_MS,
    connectionLivenessMs = CONNECTION_LIVENESS_MS,
    heartbeatSilenceMs = HEARTBEAT_SILENCE_MS,
    accountReconcileMaxAgeMs = ACCOUNT_RECONCILE_MAX_AGE_MS,
  }) {
    this.repository = repository
    this.client = client
    this.identityService = identityService
    this.effectiveEnabled = effectiveEnabled
    this.onStateChanged = onStateChanged
    this.now = now
    this.random = random
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.reconnectTimer = null
    this.renewalTimer = null
    this.claimTimer = null
    this.watchdogTimer = null
    this.running = null
    this.reader = null
    this.connectionController = null
    this.stopped = true
    this.attempt = 0
    this.streamConnected = false
    this.renewalRequested = false
    this.watchdogTimedOut = false
    this.lastFrameAtMs = null
    this.dormant = null
    this.logger = logger
    this.tokenRefreshMarginMs = tokenRefreshMarginMs
    this.connectionLivenessMs = connectionLivenessMs
    this.heartbeatSilenceMs = heartbeatSilenceMs
    this.accountReconcileMaxAgeMs = accountReconcileMaxAgeMs
  }

  start() {
    if (!this.effectiveEnabled || !this.stopped) return
    this.stopped = false
    this.wake()
  }

  stop() {
    this.stopped = true
    this.clearReconnectTimer()
    this.clearRenewalTimer()
    this.clearClaimTimer()
    this.clearWatchdogTimer()
    this.connectionController?.abort()
    this.connectionController = null
    void this.reader?.cancel().catch(() => {})
    this.reader = null
    this.streamConnected = false
  }

  wake() {
    if (this.stopped || !this.effectiveEnabled) return
    this.repository.expirePendingAccountClaim?.(this.now())
    const settings = this.repository.getSettings()
    const interest = this.durableInterest()
    this.scheduleClaimExpiry(interest.pendingClaimExpiresAtMs)
    if (!settings.connectionEnabled || settings.enrollmentState !== 'connected' || !this.hasInterest()) {
      this.enterDormant()
      return
    }
    this.dormant = false
    if (this.running || this.reconnectTimer) return
    this.attempt = settings.reconnectAttempt ?? 0
    this.scheduleReconnect(Math.max(0, (settings.nextReconnectAtMs ?? this.now()) - this.now()))
  }

  holdClaim({ claimId, expiresAt }) {
    const expiresAtMs = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number(expiresAt)
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= this.now()) return false
    this.repository.savePendingAccountClaim?.(claimId, expiresAtMs)
    this.scheduleClaimExpiry(expiresAtMs)
    this.wake()
    return true
  }

  releaseClaimInterest(claimId) {
    this.repository.clearPendingAccountClaim?.(claimId)
    this.clearClaimTimer()
    this.wake()
  }

  durableInterest() {
    return this.repository.getRemoteEventInterest?.(this.now()) ?? DEFAULT_INTEREST
  }

  hasInterest() {
    return this.durableInterest().required
  }

  scheduleClaimExpiry(expiresAtMs) {
    this.clearClaimTimer()
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= this.now()) return
    this.claimTimer = this.setTimer(() => {
      this.claimTimer = null
      this.repository.expirePendingAccountClaim?.(this.now())
      this.wake()
    }, expiresAtMs - this.now())
    this.claimTimer?.unref?.()
  }

  clearClaimTimer() {
    if (this.claimTimer) this.clearTimer(this.claimTimer)
    this.claimTimer = null
  }

  resetWatchdog() {
    this.clearWatchdogTimer()
    this.lastFrameAtMs = this.now()
    this.watchdogTimer = this.setTimer(() => {
      this.watchdogTimer = null
      this.watchdogTimedOut = true
      this.connectionController?.abort()
    }, this.heartbeatSilenceMs)
    this.watchdogTimer?.unref?.()
  }

  clearWatchdogTimer() {
    if (this.watchdogTimer) this.clearTimer(this.watchdogTimer)
    this.watchdogTimer = null
  }

  enterDormant() {
    this.clearReconnectTimer()
    this.clearRenewalTimer()
    this.clearWatchdogTimer()
    this.renewalRequested = false
    this.connectionController?.abort()
    if (this.reader) void this.reader.cancel().catch(() => {})
    this.reader = null
    this.streamConnected = false
    if (this.dormant === false) this.repository.incrementEventMetric?.('dormantTransitionCount')
    this.dormant = true
    const settings = this.repository.getSettings?.()
    if (settings && ((settings.reconnectAttempt ?? 0) !== 0 || settings.nextReconnectAtMs != null || settings.eventLastErrorCode != null)) {
      this.repository.updateEventConnection?.({
        lastErrorCode: null,
        reconnectAttempt: 0,
        nextReconnectAtMs: null,
      })
    }
  }

  scheduleReconnect(delay) {
    this.clearReconnectTimer()
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
    this.reconnectTimer?.unref?.()
  }

  scheduleRenewal(expiresAtMs) {
    this.clearRenewalTimer()
    if (!Number.isFinite(expiresAtMs) || !this.hasInterest()) return
    const delay = Math.max(0, expiresAtMs - this.tokenRefreshMarginMs - this.now())
    this.renewalTimer = this.setTimer(() => {
      this.renewalTimer = null
      if (!this.hasInterest()) {
        this.enterDormant()
        return
      }
      this.renewalRequested = true
      if (this.reader) void this.reader.cancel().catch(() => {})
      else if (!this.running) this.scheduleReconnect(0)
    }, delay)
    this.renewalTimer?.unref?.()
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) this.clearTimer(this.reconnectTimer)
    this.reconnectTimer = null
  }

  clearRenewalTimer() {
    if (this.renewalTimer) this.clearTimer(this.renewalTimer)
    this.renewalTimer = null
  }

  connect() {
    if (this.running) return this.running
    const controller = new AbortController()
    this.connectionController = controller
    this.watchdogTimedOut = false
    const running = this.connectInternal(controller.signal).finally(() => {
      if (this.connectionController === controller) this.connectionController = null
      if (this.running === running) this.running = null
    })
    this.running = running
    return running
  }

  async connectInternal(signal) {
    if (this.stopped || !this.effectiveEnabled) return
    const settings = this.repository.getSettings()
    if (!settings.connectionEnabled || settings.enrollmentState !== 'connected' || !this.hasInterest() || this.identityService.getCapabilities().installationEvents !== true) return
    let opened = false
    try {
      const credentials = await this.identityService.activate?.({ signal })
      if (!this.hasInterest()) return
      this.renewalRequested = false
      if (credentials?.tokenExpiresAt) this.scheduleRenewal(Date.parse(credentials.tokenExpiresAt))
      const interest = this.durableInterest()
      if (!interest.pendingClaim && this.repository.accountReconciliationDue?.(this.now(), this.accountReconcileMaxAgeMs)) {
        await this.identityService.reconcileAccountStatus?.(undefined, { signal })
      }
      if (!this.hasInterest()) return
      const response = await this.client.events(settings.remoteEventCursor, { signal })
      if (!response.body) throw Object.assign(new Error('lab.gd event stream has no body.'), { code: 'sharing-events-invalid' })
      this.attempt = 0
      opened = true
      this.streamConnected = true
      this.dormant = false
      this.repository.incrementEventMetric?.('streamOpenCount')
      this.repository.updateEventConnection?.({
        lastConnectedAtMs: this.now(),
        lastErrorCode: null,
        reconnectAttempt: 0,
        nextReconnectAtMs: null,
      })
      this.onStateChanged(this.repository.getSettings(), 'sharing.status-changed')
      this.reader = response.body.getReader()
      this.resetWatchdog()
      await consumeSse(this.reader, async (event) => {
        if (event.kind === 'account-claim' || event.kind === 'account-unlink') {
          await this.identityService.reconcileAccountStatus(event.id, { signal })
          if (event.kind === 'account-claim') this.releaseClaimInterest(event.payload.claimId)
          this.onStateChanged(this.repository.getSettings(),'sharing.status-changed')
          this.wake()
          return
        }
        const result = this.repository.applyRemoteEvent(event)
        if (!result.applied) return
        if (result.shares.length) result.shares.forEach((share) => this.onStateChanged(share, 'sharing.share-changed'))
        else this.onStateChanged(this.repository.getSettings(), 'sharing.status-changed')
        this.wake()
      }, () => this.resetWatchdog())
    } catch (error) {
      if (this.stopped || (signal.aborted && !this.watchdogTimedOut)) return
      let connectionError = error
      if (this.watchdogTimedOut) connectionError = Object.assign(new Error('lab.gd event stream heartbeat timed out.'), { code: 'sharing-events-heartbeat-timeout' })
      if (error?.code === 'sharing-event-version-unsupported') {
        try {
          await this.identityService.readiness()
        } catch (readinessError) {
          connectionError = readinessError
        }
      }
      this.attempt += 1
      const delay = reconnectDelay(this.attempt, this.random, connectionError?.retryAfterMs)
      const errorCode = sanitizeEventErrorCode(connectionError?.code)
      const failedAt = this.now()
      const nextReconnectAtMs = failedAt + delay
      this.repository.incrementEventMetric?.('reconnectCount')
      this.repository.updateEventConnection?.({
        lastDisconnectedAtMs: failedAt,
        lastErrorCode: errorCode,
        reconnectAttempt: this.attempt,
        nextReconnectAtMs,
      })
      this.logger.warn?.('[sharing-events] Connection failed.', {
        code: errorCode,
        reconnectAttempt: this.attempt,
        nextReconnectAtMs,
      })
    } finally {
      this.reader = null
      this.clearWatchdogTimer()
      if (opened) {
        this.streamConnected = false
        this.repository.updateEventConnection?.({ lastDisconnectedAtMs: this.now() })
        this.onStateChanged(this.repository.getSettings(), 'sharing.status-changed')
      }
      this.clearRenewalTimer()
    }
    if (!this.stopped && this.repository.getSettings().connectionEnabled && this.repository.getSettings().enrollmentState === 'connected' && this.hasInterest()) {
      if (this.renewalRequested) this.scheduleReconnect(0)
      else {
        const persisted = this.repository.getSettings()
        const delay = persisted.nextReconnectAtMs == null
          ? reconnectDelay(Math.max(1, this.attempt), this.random)
          : Math.max(0, persisted.nextReconnectAtMs - this.now())
        this.scheduleReconnect(delay)
      }
    }
  }

  status() {
    const settings = this.repository.getSettings()
    const projection = this.repository.getInstallationProjection?.() ?? null
    const now = this.now()
    const recentlyAuthenticated = settings.lastConnectedAtMs != null
      && now - settings.lastConnectedAtMs <= this.connectionLivenessMs
    const credentialValid = projection?.credentialExpiresAtMs != null
      && projection.credentialExpiresAtMs > now
    const live = this.streamConnected
    const interest = this.durableInterest()
    const lifecycle = this.repository.getEventLifecycle?.()
    const dormant = !interest.required
    const staleConnected = !dormant && settings.enrollmentState === 'connected'
      && !live && !recentlyAuthenticated && !credentialValid
    return {
      live,
      dormant,
      interest: {
        ...interest,
        reasons: interestReasons(interest),
      },
      metrics: {
        streamOpenCount: lifecycle?.streamOpenCount ?? 0,
        reconnectCount: lifecycle?.reconnectCount ?? 0,
        credentialRefreshCount: lifecycle?.credentialRefreshCount ?? 0,
        dormantTransitionCount: lifecycle?.dormantTransitionCount ?? 0,
        lastFrameAtMs: this.lastFrameAtMs,
      },
      recentlyAuthenticated,
      credentialValid,
      effectiveEnrollmentState: staleConnected ? 'retrying' : settings.enrollmentState,
      lastConnectedAtMs: settings.lastConnectedAtMs ?? null,
      lastDisconnectedAtMs: settings.lastDisconnectedAtMs ?? null,
      lastRenewedAtMs: settings.lastRenewedAtMs ?? null,
      lastErrorCode: settings.eventLastErrorCode ?? null,
      reconnectAttempt: settings.reconnectAttempt ?? 0,
      nextReconnectAtMs: settings.nextReconnectAtMs ?? null,
    }
  }
}

function reconnectDelay(attempt, random, retryAfterMs = 0) {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(Math.max(0, attempt - 1), 6))
  const boundedRandom = Math.min(1, Math.max(0, Number(random()) || 0))
  const jitter = Math.floor(exponential * BACKOFF_JITTER_RATIO * boundedRandom)
  return Math.max(exponential + jitter, Number.isFinite(retryAfterMs) ? retryAfterMs : 0)
}

function sanitizeEventErrorCode(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/u.test(value) ? value : 'sharing-events-unavailable'
}

async function consumeSse(reader, onEvent, onActivity = () => {}) {
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (value?.byteLength) onActivity()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }).replace(/\r\n?/gu, '\n')
    if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES * 2) throw Object.assign(new Error('lab.gd event stream frame is too large.'), { code: 'sharing-events-invalid' })
    let boundary
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (frame && !frame.startsWith(':')) await onEvent(parseFrame(frame))
    }
    if (done) {
      if (buffer.trim()) throw Object.assign(new Error('lab.gd event stream ended mid-frame.'), { code: 'sharing-events-invalid' })
      return
    }
  }
}

function interestReasons(interest) {
  return [
    ...(interest.activeShares > 0 ? ['active-shares'] : []),
    ...(interest.pendingPublicationOperations > 0 ? ['publication-operations'] : []),
    ...(interest.pendingAccountOperations > 0 ? ['account-operations'] : []),
    ...(interest.recoveryPending ? ['recovery'] : []),
    ...(interest.pendingClaim ? ['account-claim'] : []),
  ]
}

function parseFrame(frame) {
  if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) throw Object.assign(new Error('lab.gd event stream frame is too large.'), { code: 'sharing-events-invalid' })
  let id = null
  let kind = null
  const data = []
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /u, '')
    if (field === 'id') id = value
    else if (field === 'event') kind = value
    else if (field === 'data') data.push(value)
  }
  if (!/^[1-9]\d*$/u.test(id ?? '') || !Number.isSafeInteger(Number(id)) || !EVENT_KINDS.has(kind) || data.length !== 1) throw Object.assign(new Error('lab.gd event stream frame is invalid.'), { code: 'sharing-events-invalid' })
  let payload
  try { payload = JSON.parse(data[0]) } catch { throw Object.assign(new Error('lab.gd event payload is invalid.'), { code: 'sharing-events-invalid' }) }
  validatePayload(kind, payload)
  return { id: Number(id), kind, payload }
}

function validatePayload(kind, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.eventVersion !== 1) throw Object.assign(new Error('lab.gd event version is unsupported.'), { code: 'sharing-event-version-unsupported' })
  if (typeof payload.occurredAt !== 'string' || !canonicalTimestamp(payload.occurredAt)) throw Object.assign(new Error('lab.gd event payload is invalid.'), { code: 'sharing-events-invalid' })
  if (SHARE_EVENT_KINDS.has(kind)) {
    exactKeys(payload, ['eventVersion', 'sharePublicId', 'revision', 'state', 'occurredAt'])
    if (typeof payload.sharePublicId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(payload.sharePublicId) || !Number.isSafeInteger(payload.revision) || payload.revision <= 0 || !['staged', 'active', 'unpublished', 'deleted', 'expired'].includes(payload.state)) throw Object.assign(new Error('lab.gd share event payload is invalid.'), { code: 'sharing-events-invalid' })
  } else if (kind === 'account-claim') {
    exactKeys(payload, ['eventVersion', 'claimId', 'state', 'occurredAt'])
    if (typeof payload.claimId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(payload.claimId) || payload.state !== 'completed') throw Object.assign(new Error('lab.gd claim event payload is invalid.'), { code: 'sharing-events-invalid' })
  } else if (kind === 'account-unlink') {
    exactKeys(payload, ['eventVersion', 'bindingRevision', 'disposition', 'operationId', 'affected', 'occurredAt'])
    if (!Number.isSafeInteger(payload.bindingRevision) || payload.bindingRevision < 0 || !Number.isSafeInteger(payload.operationId) || payload.operationId <= 0 || !['keep', 'unpublish', 'delete'].includes(payload.disposition)) throw Object.assign(new Error('lab.gd account unlink event payload is invalid.'), { code: 'sharing-events-invalid' })
    exactKeys(payload.affected, ['shares', 'keptOnline', 'unpublished', 'deleted'])
    const { shares, keptOnline, unpublished, deleted } = payload.affected
    const expected = payload.disposition === 'keep'
      ? [shares, 0, 0]
      : payload.disposition === 'unpublish' ? [0, shares, 0] : [0, 0, shares]
    if ([shares, keptOnline, unpublished, deleted].some((count) => !Number.isSafeInteger(count) || count < 0) || [keptOnline, unpublished, deleted].some((count, index) => count !== expected[index])) throw Object.assign(new Error('lab.gd account unlink event payload is invalid.'), { code: 'sharing-events-invalid' })
  } else {
    exactKeys(payload, ['eventVersion', 'state', 'occurredAt'])
    if (!['active', 'recovery-pending', 'revoked'].includes(payload.state)) throw Object.assign(new Error('lab.gd recovery event payload is invalid.'), { code: 'sharing-events-invalid' })
  }
}

function canonicalTimestamp(value) {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function exactKeys(value, expected) {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) throw Object.assign(new Error('lab.gd event payload is invalid.'), { code: 'sharing-events-invalid' })
}
