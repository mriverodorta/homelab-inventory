const MAX_ATTEMPTS = 6
const BASE_DELAY_MS = 15_000

export class SharingPublicationCoordinator {
  constructor({ repository, publicationService, effectiveEnabled = true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.repository = repository
    this.publicationService = publicationService
    this.effectiveEnabled = effectiveEnabled
    this.now = now
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.timer = null
    this.running = null
    this.stopped = false
  }

  start() {
    if (!this.effectiveEnabled || this.stopped || this.timer) return
    this.schedule(0)
  }

  stop() {
    this.stopped = true
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
  }

  wake() {
    if (this.stopped || !this.effectiveEnabled) return
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
    this.schedule(0)
  }

  schedule(delay = 1000) {
    if (this.stopped || this.timer) return
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.runNext()
    }, delay)
  }

  runNext() {
    if (this.running) return this.running
    const running = this.runNextInternal().finally(() => {
      if (this.running === running) this.running = null
    })
    this.running = running
    return running
  }

  async runNextInternal() {
    if (this.stopped || !this.effectiveEnabled) return
    const settings = this.repository.getSettings()
    if (!settings.connectionEnabled || settings.enrollmentState !== 'connected') return
    const operation = this.repository.nextOperation(this.now())
    if (!operation) return
    try {
      if (operation.kind !== 'publish') throw Object.assign(new Error('Unsupported sharing operation.'), { code: 'sharing-operation-unsupported' })
      await this.publicationService.executePublish(operation)
    } catch (error) {
      const attemptCount = operation.attemptCount + 1
      const retryable = attemptCount < MAX_ATTEMPTS && !String(error?.code ?? '').includes('unsupported')
      this.repository.updateOperation(operation.id, {
        state: retryable ? 'retrying' : 'failed',
        attemptCount,
        availableAtMs: this.now() + Math.min(15 * 60_000, BASE_DELAY_MS * 2 ** (attemptCount - 1)),
        lastErrorCode: safeCode(error?.code),
      })
      const share = this.repository.getShare(operation.shareId)
      if (share) this.publicationService.onStateChanged(this.repository.updateShare(share.id, share.localRevision, { state: 'failed' }))
    } finally {
      if (!this.stopped) this.schedule()
    }
  }
}

function safeCode(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/u.test(value) ? value : 'sharing-publication-failed'
}
