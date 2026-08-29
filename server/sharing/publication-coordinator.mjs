import { classifyPublicationFailure, publicationRetryDelay } from './publication-retry-policy.mjs'

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
    if (!operation) {
      const availableAtMs = this.repository.nextOperationAvailableAt?.()
      if (Number.isSafeInteger(availableAtMs)) this.schedule(Math.max(1, availableAtMs - this.now()))
      return
    }
    let nextDelay = 1000
    try {
      if (operation.kind === 'publish') await this.publicationService.executePublish(operation)
      else if (operation.kind === 'unpublish' || operation.kind === 'delete') await this.publicationService.executeLifecycle(operation)
      else throw Object.assign(new Error('Unsupported sharing operation.'), { code: 'sharing-operation-unsupported' })
    } catch (error) {
      const attemptCount = operation.attemptCount + 1
      const classification = classifyPublicationFailure(error, attemptCount)
      const retryable = classification.disposition !== 'terminal'
      const delay = publicationRetryDelay(classification, attemptCount, error?.retryAfterMs)
      nextDelay = retryable ? delay : 1000
      this.repository.updateOperation(operation.id, {
        state: retryable ? 'retrying' : 'failed',
        attemptCount,
        availableAtMs: this.now() + delay,
        lastErrorCode: safeCode(error?.code),
      })
      if (!retryable) {
        const share = this.repository.getShare(operation.shareId)
        if (share) this.publicationService.onStateChanged(this.repository.updateShare(share.id, share.localRevision, { state: 'failed' }))
      }
    } finally {
      if (!this.stopped) this.schedule(nextDelay)
    }
  }
}

function safeCode(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/u.test(value) ? value : 'sharing-publication-failed'
}
