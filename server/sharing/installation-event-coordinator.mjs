const EVENT_KINDS = new Set(['publication', 'replacement', 'unpublish', 'deletion', 'expiration', 'grace-period', 'account-claim', 'account-unlink', 'recovery'])
const SHARE_EVENT_KINDS = new Set(['publication', 'replacement', 'unpublish', 'deletion', 'expiration', 'grace-period'])
const MAX_FRAME_BYTES = 64 * 1024
const MAX_BACKOFF_MS = 60_000

export class SharingInstallationEventCoordinator {
  constructor({ repository, client, identityService, effectiveEnabled = true, onStateChanged = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.repository = repository
    this.client = client
    this.identityService = identityService
    this.effectiveEnabled = effectiveEnabled
    this.onStateChanged = onStateChanged
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.timer = null
    this.running = null
    this.reader = null
    this.stopped = true
    this.attempt = 0
  }

  start() {
    if (!this.effectiveEnabled || !this.stopped) return
    this.stopped = false
    this.wake()
  }

  stop() {
    this.stopped = true
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
    void this.reader?.cancel().catch(() => {})
    this.reader = null
  }

  wake() {
    if (this.stopped || !this.effectiveEnabled) return
    const settings = this.repository.getSettings()
    if (!settings.connectionEnabled || settings.enrollmentState !== 'connected') {
      void this.reader?.cancel().catch(() => {})
      return
    }
    if (this.running || this.timer) return
    this.schedule(0)
  }

  schedule(delay) {
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.connect()
    }, delay)
  }

  connect() {
    if (this.running) return this.running
    const running = this.connectInternal().finally(() => {
      if (this.running === running) this.running = null
    })
    this.running = running
    return running
  }

  async connectInternal() {
    if (this.stopped || !this.effectiveEnabled) return
    const settings = this.repository.getSettings()
    if (!settings.connectionEnabled || settings.enrollmentState !== 'connected' || this.identityService.getCapabilities().installationEvents !== true) return
    try {
      await this.identityService.reconcileAccountStatus?.()
      const response = await this.client.events(settings.remoteEventCursor)
      if (!response.body) throw Object.assign(new Error('lab.gd event stream has no body.'), { code: 'sharing-events-invalid' })
      this.attempt = 0
      this.reader = response.body.getReader()
      await consumeSse(this.reader, async (event) => {
        if (event.kind === 'account-claim' || event.kind === 'account-unlink') {
          await this.identityService.reconcileAccountStatus(event.id)
          this.onStateChanged(this.repository.getSettings(),'sharing.status-changed')
          return
        }
        const result = this.repository.applyRemoteEvent(event)
        if (!result.applied) return
        if (result.shares.length) result.shares.forEach((share) => this.onStateChanged(share, 'sharing.share-changed'))
        else this.onStateChanged(this.repository.getSettings(), 'sharing.status-changed')
      })
    } catch (error) {
      if (this.stopped) return
      if (error?.code === 'sharing-event-version-unsupported') await this.identityService.readiness()
      this.attempt += 1
    } finally {
      this.reader = null
    }
    if (!this.stopped && this.repository.getSettings().connectionEnabled && this.repository.getSettings().enrollmentState === 'connected') {
      this.schedule(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.attempt, 6)))
    }
  }
}

async function consumeSse(reader, onEvent) {
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
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
  if (typeof payload.occurredAt !== 'string' || !Number.isFinite(Date.parse(payload.occurredAt))) throw Object.assign(new Error('lab.gd event payload is invalid.'), { code: 'sharing-events-invalid' })
  if (SHARE_EVENT_KINDS.has(kind)) {
    exactKeys(payload, ['eventVersion', 'sharePublicId', 'revision', 'state', 'occurredAt'])
    if (typeof payload.sharePublicId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(payload.sharePublicId) || !Number.isSafeInteger(payload.revision) || payload.revision <= 0 || !['active', 'unpublished', 'deleted', 'expired', 'grace-period'].includes(payload.state)) throw Object.assign(new Error('lab.gd share event payload is invalid.'), { code: 'sharing-events-invalid' })
  } else if (kind === 'account-claim') {
    exactKeys(payload, ['eventVersion', 'claimId', 'state', 'occurredAt'])
    if (typeof payload.claimId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(payload.claimId) || payload.state !== 'completed') throw Object.assign(new Error('lab.gd claim event payload is invalid.'), { code: 'sharing-events-invalid' })
  } else if (kind === 'account-unlink') {
    exactKeys(payload, ['eventVersion', 'bindingRevision', 'disposition', 'operationId', 'affected', 'occurredAt'])
    if (!Number.isSafeInteger(payload.bindingRevision) || payload.bindingRevision <= 0 || !Number.isSafeInteger(payload.operationId) || payload.operationId <= 0 || !['keep', 'unpublish', 'delete'].includes(payload.disposition)) throw Object.assign(new Error('lab.gd account unlink event payload is invalid.'), { code: 'sharing-events-invalid' })
    exactKeys(payload.affected, ['shares', 'keptOnline', 'unpublished', 'deleted'])
    const { shares, keptOnline, unpublished, deleted } = payload.affected
    if ([shares, keptOnline, unpublished, deleted].some((count) => !Number.isSafeInteger(count) || count < 0) || keptOnline + unpublished + deleted !== shares) throw Object.assign(new Error('lab.gd account unlink event payload is invalid.'), { code: 'sharing-events-invalid' })
  } else {
    exactKeys(payload, ['eventVersion', 'state', 'occurredAt'])
    if (!['active', 'recovery-pending', 'revoked'].includes(payload.state)) throw Object.assign(new Error('lab.gd recovery event payload is invalid.'), { code: 'sharing-events-invalid' })
  }
}

function exactKeys(value, expected) {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) throw Object.assign(new Error('lab.gd event payload is invalid.'), { code: 'sharing-events-invalid' })
}
