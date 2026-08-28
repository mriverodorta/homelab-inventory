import { SharingRecoveryPendingError, SharingUnsupportedError } from './installation-identity.mjs'

const BASE_DELAY_MS = 30_000
const MAX_DELAY_MS = 60 * 60_000

export class SharingEnrollmentCoordinator {
  constructor({
    repository,
    identityService,
    localReady = Promise.resolve(),
    effectiveEnabled = true,
    now = Date.now,
    random = Math.random,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onStateChanged = () => {},
  }) {
    this.repository = repository
    this.identityService = identityService
    this.localReady = localReady
    this.effectiveEnabled = effectiveEnabled
    this.now = now
    this.random = random
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.onStateChanged = onStateChanged
    this.started = false
    this.stopped = false
    this.timer = null
    this.running = null
  }

  start() {
    if (this.started) return
    this.started = true
    void this.localReady.then(() => this.scheduleFromState()).catch(() => {})
  }

  stop() {
    this.stopped = true
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
  }

  wake() {
    if (!this.started || this.stopped) return
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
    void this.attempt()
  }

  scheduleFromState() {
    if (this.stopped) return
    const settings = this.repository.getSettings()
    if (!this.effectiveEnabled || !settings.connectionEnabled) {
      if (settings.enrollmentState !== 'disabled') this.publish(this.repository.updateEnrollment({ enrollmentState: 'disabled', attemptCount: 0, nextAttemptAtMs: null, lastErrorCode: null }))
      return
    }
    if (settings.enrollmentState === 'recovery-pending' || settings.enrollmentState === 'unsupported') return
    const delay = Math.max(0, (settings.nextAttemptAtMs ?? this.now()) - this.now())
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.attempt()
    }, delay)
  }

  attempt() {
    if (this.running) return this.running
    const running = this.attemptInternal().finally(() => {
      if (this.running === running) this.running = null
    })
    this.running = running
    return running
  }

  async attemptInternal() {
    if (this.stopped) return
    const settings = this.repository.getSettings()
    if (!this.effectiveEnabled || !settings.connectionEnabled) return this.scheduleFromState()
    this.publish(this.repository.updateEnrollment({ enrollmentState: 'pending', nextAttemptAtMs: null, lastErrorCode: null }))
    try {
      await this.identityService.activate()
      await this.identityService.reconcileAccountStatus?.()
      this.publish(this.repository.updateEnrollment({
        enrollmentState: 'connected',
        attemptCount: 0,
        nextAttemptAtMs: null,
        lastErrorCode: null,
        recoveryState: null,
      }))
    } catch (error) {
      if (error instanceof SharingRecoveryPendingError || error?.code === 'sharing-recovery-pending') {
        this.publish(this.repository.updateEnrollment({
          enrollmentState: 'recovery-pending',
          nextAttemptAtMs: null,
          lastErrorCode: 'sharing-recovery-pending',
          recoveryState: 'pending-owner-approval',
        }))
        return
      }
      if (error instanceof SharingUnsupportedError || error?.code === 'sharing-contract-unsupported') {
        this.publish(this.repository.updateEnrollment({
          enrollmentState: 'unsupported',
          nextAttemptAtMs: null,
          lastErrorCode: 'sharing-contract-unsupported',
        }))
        return
      }
      const attemptCount = settings.attemptCount + 1
      const calculated = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(attemptCount - 1, 7))
      const jitter = Math.floor(calculated * 0.2 * this.random())
      const retryAfter = Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : 0
      const delay = Math.max(calculated + jitter, retryAfter)
      this.publish(this.repository.updateEnrollment({
        enrollmentState: 'retrying',
        attemptCount,
        nextAttemptAtMs: this.now() + delay,
        lastErrorCode: sanitizeErrorCode(error?.code),
      }))
      this.scheduleFromState()
    }
  }

  publish(settings) {
    this.onStateChanged(settings)
    return settings
  }
}

function sanitizeErrorCode(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/u.test(value) ? value : 'labgd-unavailable'
}
