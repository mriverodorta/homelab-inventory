import { describe, expect, it, vi } from 'vitest'
import { SharingEnrollmentCoordinator } from './enrollment-coordinator.mjs'
import { SharingRecoveryPendingError, SharingUnsupportedError } from './installation-identity.mjs'

function repository(initial = {}) {
  let settings = {
    id: 1, revision: 1, connectionEnabled: true, enrollmentState: 'pending',
    attemptCount: 0, nextAttemptAtMs: null, lastErrorCode: null,
    remoteEventCursor: 0, recoveryState: null, ...initial,
  }
  return {
    getSettings: () => ({ ...settings }),
    updateEnrollment: (patch) => {
      settings = { ...settings, ...patch, revision: settings.revision + 1 }
      return { ...settings }
    },
  }
}

async function eventually(assertion) {
  let lastError
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await Promise.resolve()
    }
  }
  throw lastError
}

describe('sharing enrollment coordinator', () => {
  it('waits for local readiness and never blocks the caller', async () => {
    let resolveReady
    const ready = new Promise((resolve) => { resolveReady = resolve })
    const activate = vi.fn().mockResolvedValue({ installationId: 1 })
    const timers = []
    const repo = repository()
    const reconcileAccountStatus = vi.fn().mockResolvedValue({ accountClaimed: true })
    const coordinator = new SharingEnrollmentCoordinator({
      repository: repo,
      identityService: { activate, reconcileAccountStatus },
      localReady: ready,
      setTimer: (callback) => { timers.push(callback); return callback },
      clearTimer: () => {},
    })
    expect(coordinator.start()).toBeUndefined()
    expect(activate).not.toHaveBeenCalled()
    resolveReady()
    await Promise.resolve()
    expect(timers).toHaveLength(1)
    await timers.shift()()
    await eventually(() => expect(repo.getSettings().enrollmentState).toBe('connected'))
    expect(activate).toHaveBeenCalledTimes(1)
    expect(reconcileAccountStatus).toHaveBeenCalledTimes(1)
  })

  it('persists bounded retry state and resumes one timer', async () => {
    const repo = repository()
    const callbacks = []
    const identityService = { activate: vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'network-error' })) }
    const coordinator = new SharingEnrollmentCoordinator({
      repository: repo, identityService, now: () => 1_000, random: () => 0,
      setTimer: (callback, delay) => { callbacks.push({ callback, delay }); return callback }, clearTimer: () => {},
    })
    coordinator.start()
    await eventually(() => expect(callbacks).toHaveLength(1))
    await callbacks.shift().callback()
    await eventually(() => expect(repo.getSettings()).toMatchObject({
      enrollmentState: 'retrying', attemptCount: 1, nextAttemptAtMs: 31_000,
    }))
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0].delay).toBe(30_000)
  })

  it('stops retrying for recovery and unsupported contracts', async () => {
    for (const [error, expected] of [
      [new SharingRecoveryPendingError(), 'recovery-pending'],
      [new SharingUnsupportedError(), 'unsupported'],
    ]) {
      const repo = repository()
      const callbacks = []
      const coordinator = new SharingEnrollmentCoordinator({
        repository: repo, identityService: { activate: vi.fn().mockRejectedValue(error) },
        setTimer: (callback) => { callbacks.push(callback); return callback }, clearTimer: () => {},
      })
      coordinator.start()
      await eventually(() => expect(callbacks).toHaveLength(1))
      await callbacks.shift()()
      await eventually(() => expect(repo.getSettings().enrollmentState).toBe(expected))
      expect(callbacks).toHaveLength(0)
    }
  })

  it('does not call identity services when effectively disabled', async () => {
    const repo = repository()
    const activate = vi.fn()
    const coordinator = new SharingEnrollmentCoordinator({ repository: repo, identityService: { activate }, effectiveEnabled: false })
    coordinator.start()
    await eventually(() => expect(repo.getSettings().enrollmentState).toBe('disabled'))
    expect(activate).not.toHaveBeenCalled()
  })

  it.each(['demo', 'test'])('never enrolls or renews in %s mode', async () => {
    const repo = repository()
    const identityService = { activate: vi.fn(), renewCredentials: vi.fn() }
    const coordinator = new SharingEnrollmentCoordinator({ repository: repo, identityService, effectiveEnabled: false })
    coordinator.start()
    await eventually(() => expect(repo.getSettings().enrollmentState).toBe('disabled'))
    expect(identityService.activate).not.toHaveBeenCalled()
    expect(identityService.renewCredentials).not.toHaveBeenCalled()
  })
})
