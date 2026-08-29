import { describe, expect, it, vi } from 'vitest'
import { SharingInstallationEventCoordinator } from './installation-event-coordinator.mjs'

function stream(frames) {
  return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } })
}

function lifecycleRepository(initial = {}) {
  let interest = initial.interest ?? {
    required: true,
    activeShares: 1,
    pendingPublicationOperations: 0,
    pendingAccountOperations: 0,
    recoveryPending: false,
    pendingClaim: false,
    pendingClaimExpiresAtMs: null,
  }
  let settings = {
    connectionEnabled: true,
    enrollmentState: 'connected',
    remoteEventCursor: 0,
    lastConnectedAtMs: null,
    lastDisconnectedAtMs: null,
    lastRenewedAtMs: null,
    eventLastErrorCode: null,
    reconnectAttempt: 0,
    nextReconnectAtMs: null,
    ...initial,
  }
  let projection = { credentialExpiresAtMs: initial.credentialExpiresAtMs ?? null }
  let lifecycle = {
    pendingClaimId: null,
    pendingClaimExpiresAtMs: null,
    accountLastReconciledAtMs: Object.hasOwn(initial, 'accountLastReconciledAtMs') ? initial.accountLastReconciledAtMs : Date.parse('2026-08-22T12:00:00.000Z'),
    streamOpenCount: 0,
    reconnectCount: 0,
    credentialRefreshCount: 0,
    dormantTransitionCount: 0,
  }
  return {
    getSettings: () => ({ ...settings }),
    getRemoteEventInterest: (at = Date.now()) => ({
      ...interest,
      pendingClaim: lifecycle.pendingClaimExpiresAtMs !== null && lifecycle.pendingClaimExpiresAtMs > at,
      pendingClaimExpiresAtMs: lifecycle.pendingClaimExpiresAtMs,
      required: interest.required || (lifecycle.pendingClaimExpiresAtMs !== null && lifecycle.pendingClaimExpiresAtMs > at),
    }),
    getEventLifecycle: () => ({ ...lifecycle }),
    incrementEventMetric: vi.fn((metric) => { lifecycle = { ...lifecycle, [metric]: lifecycle[metric] + 1 }; return { ...lifecycle } }),
    savePendingAccountClaim: vi.fn((claimId, expiresAtMs) => { lifecycle = { ...lifecycle, pendingClaimId: claimId, pendingClaimExpiresAtMs: expiresAtMs } }),
    clearPendingAccountClaim: vi.fn((claimId) => { if (claimId === undefined || claimId === lifecycle.pendingClaimId) lifecycle = { ...lifecycle, pendingClaimId: null, pendingClaimExpiresAtMs: null } }),
    expirePendingAccountClaim: vi.fn((at) => { if (lifecycle.pendingClaimExpiresAtMs !== null && lifecycle.pendingClaimExpiresAtMs <= at) lifecycle = { ...lifecycle, pendingClaimId: null, pendingClaimExpiresAtMs: null } }),
    accountReconciliationDue: vi.fn((at, maximumAge) => lifecycle.accountLastReconciledAtMs === null || at - lifecycle.accountLastReconciledAtMs >= maximumAge),
    getInstallationProjection: () => ({ ...projection }),
    updateEventConnection: vi.fn((patch) => {
      const { lastErrorCode, ...rest } = patch
      settings = { ...settings, ...rest, ...(lastErrorCode !== undefined ? { eventLastErrorCode: lastErrorCode } : {}) }
      return { ...settings }
    }),
    setCredentialExpiresAtMs: (value) => { projection = { ...projection, credentialExpiresAtMs: value } },
    setInterest: (value) => { interest = { ...interest, ...value } },
    applyRemoteEvent: vi.fn(() => ({ applied: false, shares: [] })),
  }
}

function controlledStream() {
  let cancelled = false
  const response = new Response(new ReadableStream({
    start() {},
    cancel() { cancelled = true },
  }), { headers: { 'content-type': 'text/event-stream' } })
  return { response, cancelled: () => cancelled }
}

function pushStream(signal = null) {
  let controller
  const response = new Response(new ReadableStream({
    start(value) {
      controller = value
      signal?.addEventListener('abort', () => value.error(new DOMException('Aborted', 'AbortError')), { once: true })
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
  return {
    response,
    push(value) { controller.enqueue(new TextEncoder().encode(value)) },
  }
}

function timerHarness() {
  const entries = []
  return {
    entries,
    setTimer(callback, delay) {
      const entry = { callback: null, delay, active: true }
      entry.callback = (...args) => {
        entry.active = false
        return callback(...args)
      }
      entries.push(entry)
      return entry
    },
    clearTimer(entry) { entry.active = false },
    next(delay) { return entries.find((entry) => entry.active && (delay === undefined || entry.delay === delay)) },
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

describe('sharing installation event coordinator', () => {
  it('resumes from the persisted cursor and applies ordered events before scheduling reconnect', async () => {
    let cursor = 7
    const applied = []
    const delays = []
    const repository = {
      getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected', remoteEventCursor: cursor }),
      applyRemoteEvent: vi.fn((event) => { applied.push(event.id); cursor = event.id; return { applied: true, shares: [{ id: 1, state: event.payload.state }] } }),
    }
    const client = { events: vi.fn(async () => stream([
      'id: 8\nevent: unpublish\ndata: {"eventVersion":1,"sharePublicId":"share_1","revision":3,"state":"unpublished","occurredAt":"2026-08-22T12:00:00.000Z"}\n\n',
      'id: 9\nevent: deletion\ndata: {"eventVersion":1,"sharePublicId":"share_1","revision":4,"state":"deleted","occurredAt":"2026-08-22T12:01:00.000Z"}\n\n',
    ])) }
    const coordinator = new SharingInstallationEventCoordinator({ repository, client, identityService: { getCapabilities: () => ({ installationEvents: true }), readiness: vi.fn() }, onStateChanged: vi.fn(), setTimer: (_callback, delay) => { delays.push(delay); return 1 }, clearTimer: vi.fn() })
    coordinator.stopped = false
    await coordinator.connect()
    expect(client.events).toHaveBeenCalledWith(7, { signal: expect.any(AbortSignal) })
    expect(applied).toEqual([8, 9])
    const reconnectDelays = delays.filter((delay) => delay >= 1000 && delay <= 1200)
    expect(reconnectDelays).toHaveLength(1)
  })

  it('renegotiates instead of committing an unknown event version', async () => {
    const readiness = vi.fn(async () => ({}))
    const repository = { getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected', remoteEventCursor: 0 }), applyRemoteEvent: vi.fn() }
    const client = { events: vi.fn(async () => stream(['id: 1\nevent: recovery\ndata: {"eventVersion":2,"state":"active","occurredAt":"2026-08-22T12:00:00.000Z"}\n\n'])) }
    const coordinator = new SharingInstallationEventCoordinator({ repository, client, identityService: { getCapabilities: () => ({ installationEvents: true }), readiness }, setTimer: () => 1, clearTimer: vi.fn() })
    coordinator.stopped = false
    await coordinator.connect()
    expect(repository.applyRemoteEvent).not.toHaveBeenCalled()
    expect(readiness).toHaveBeenCalledOnce()
  })

  it('reconciles installation account state without mutating a share', async () => {
    const applyRemoteEvent = vi.fn()
    const reconcileAccountStatus = vi.fn(async () => ({ accountClaimed: true, githubUsername: 'maikeldorta' }))
    const onStateChanged = vi.fn()
    const repository = {
      getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected', remoteEventCursor: 11 }),
      applyRemoteEvent,
    }
    const client = { events: vi.fn(async () => stream([
      'id: 12\nevent: account-claim\ndata: {"eventVersion":1,"claimId":"claim_12","state":"completed","occurredAt":"2026-08-22T12:00:00.000Z"}\n\n',
    ])) }
    const coordinator = new SharingInstallationEventCoordinator({
      repository,
      client,
      identityService: {
        getCapabilities: () => ({ installationEvents: true }),
        reconcileAccountStatus,
      },
      onStateChanged,
      setTimer: () => 1,
      clearTimer: vi.fn(),
    })
    coordinator.stopped = false

    await coordinator.connect()

    expect(reconcileAccountStatus).toHaveBeenCalledOnce()
    expect(reconcileAccountStatus).toHaveBeenCalledWith(12, { signal: expect.any(AbortSignal) })
    expect(applyRemoteEvent).not.toHaveBeenCalled()
    expect(onStateChanged).toHaveBeenCalledWith(repository.getSettings(), 'sharing.status-changed')
  })

  it('reconciles account unlink summaries after preceding share lifecycle events', async () => {
    let cursor = 20
    const calls = []
    const repository = {
      getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected', remoteEventCursor: cursor }),
      applyRemoteEvent: vi.fn((event) => { calls.push(`share:${event.id}`); cursor = event.id; return { applied: true, shares: [{ id: 2, state: event.payload.state }] } }),
    }
    const reconcileAccountStatus = vi.fn(async (eventId) => { if (eventId) { calls.push(`account:${eventId}`); cursor = eventId } })
    const client = { events: vi.fn(async () => stream([
      'id: 21\nevent: unpublish\ndata: {"eventVersion":1,"sharePublicId":"share_2","revision":4,"state":"unpublished","occurredAt":"2026-08-24T12:00:00.000Z"}\n\n',
      'id: 22\nevent: account-unlink\ndata: {"eventVersion":1,"bindingRevision":4,"disposition":"unpublish","operationId":17,"affected":{"shares":1,"keptOnline":0,"unpublished":1,"deleted":0},"occurredAt":"2026-08-24T12:00:01.000Z"}\n\n',
    ])) }
    const coordinator = new SharingInstallationEventCoordinator({
      repository,
      client,
      identityService: { getCapabilities: () => ({ installationEvents: true }), reconcileAccountStatus },
      onStateChanged: vi.fn(),
      setTimer: () => 1,
      clearTimer: vi.fn(),
    })
    coordinator.stopped = false
    await coordinator.connect()
    expect(calls).toEqual(['share:21', 'account:22'])
    expect(repository.applyRemoteEvent).toHaveBeenCalledOnce()
  })

  it('never starts in fixture-disabled, demo, or staging runtime', () => {
    const setTimer = vi.fn()
    const coordinator = new SharingInstallationEventCoordinator({ repository: {}, client: {}, identityService: {}, effectiveEnabled: false, setTimer })
    coordinator.start()
    expect(setTimer).not.toHaveBeenCalled()
  })

  it('stays dormant without shares or operations and does not activate credentials', () => {
    const timers = timerHarness()
    const repository = lifecycleRepository({
      credentialExpiresAtMs: 1,
      interest: {
        required: false,
        activeShares: 0,
        pendingPublicationOperations: 0,
        pendingAccountOperations: 0,
        recoveryPending: false,
      },
    })
    const identityService = {
      activate: vi.fn(),
      getCapabilities: () => ({ installationEvents: true }),
    }
    const client = { events: vi.fn() }
    const coordinator = new SharingInstallationEventCoordinator({
      repository,
      client,
      identityService,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })

    coordinator.start()

    expect(timers.entries.filter(({ active }) => active)).toHaveLength(0)
    expect(identityService.activate).not.toHaveBeenCalled()
    expect(client.events).not.toHaveBeenCalled()
    expect(coordinator.status()).toMatchObject({
      dormant: true,
      effectiveEnrollmentState: 'connected',
      interest: { required: false, pendingClaim: false },
    })
  })

  it('opens a bounded claim stream and returns to dormant when the claim expires', async () => {
    let currentTime = 10_000
    const timers = timerHarness()
    const pending = controlledStream()
    const repository = lifecycleRepository({
      interest: {
        required: false,
        activeShares: 0,
        pendingPublicationOperations: 0,
        pendingAccountOperations: 0,
        recoveryPending: false,
      },
    })
    const identityService = {
      activate: vi.fn(async () => ({ tokenExpiresAt: new Date(currentTime + 600_000).toISOString() })),
      reconcileAccountStatus: vi.fn(),
      getCapabilities: () => ({ installationEvents: true }),
    }
    const client = { events: vi.fn(async () => pending.response) }
    const coordinator = new SharingInstallationEventCoordinator({
      repository,
      client,
      identityService,
      now: () => currentTime,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    coordinator.start()
    expect(coordinator.holdClaim({ claimId: 'claim_123', expiresAt: currentTime + 30_000 })).toBe(true)
    timers.next(0).callback()
    await eventually(() => expect(client.events).toHaveBeenCalledOnce())
    expect(coordinator.status()).toMatchObject({ dormant: false, interest: { pendingClaim: true } })

    currentTime += 30_000
    timers.next(30_000).callback()
    await eventually(() => expect(pending.cancelled()).toBe(true))
    expect(coordinator.status()).toMatchObject({ dormant: true, interest: { pendingClaim: false } })
    expect(timers.entries.filter(({ active }) => active)).toHaveLength(0)
  })

  it('closes the active stream and clears timers after the last live share disappears', async () => {
    const timers = timerHarness()
    const pending = controlledStream()
    const repository = lifecycleRepository({ credentialExpiresAtMs: 600_000 })
    const identityService = {
      activate: vi.fn(async () => ({ tokenExpiresAt: new Date(600_000).toISOString() })),
      reconcileAccountStatus: vi.fn(),
      getCapabilities: () => ({ installationEvents: true }),
    }
    const client = { events: vi.fn(async () => pending.response) }
    const coordinator = new SharingInstallationEventCoordinator({
      repository,
      client,
      identityService,
      now: () => 0,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    coordinator.start()
    timers.next(0).callback()
    await eventually(() => expect(client.events).toHaveBeenCalledOnce())

    repository.setInterest({ required: false, activeShares: 0 })
    coordinator.wake()

    await eventually(() => expect(pending.cancelled()).toBe(true))
    expect(coordinator.status()).toMatchObject({ dormant: true, live: false })
    expect(timers.entries.filter(({ active }) => active)).toHaveLength(0)
  })

  it('executes proactive renewal and reconnects the SSE stream with one stable identity', async () => {
    let currentTime = 1_000
    const timers = timerHarness()
    const first = controlledStream()
    const second = controlledStream()
    const stableIdentity = { clientInstanceId: 'stable-instance', installationId: 7, keyId: 'stable-key' }
    const credentials = [
      { ...stableIdentity, tokenExpiresAt: new Date(currentTime + 100_000).toISOString() },
      { ...stableIdentity, tokenExpiresAt: new Date(currentTime + 200_000).toISOString() },
    ]
    const repository = lifecycleRepository({ credentialExpiresAtMs: currentTime + 100_000 })
    const activate = vi.fn(async () => credentials[Math.min(activate.mock.calls.length - 1, 1)])
    const client = { events: vi.fn(async () => client.events.mock.calls.length === 1 ? first.response : second.response) }
    const coordinator = new SharingInstallationEventCoordinator({
      repository,
      client,
      identityService: { activate, reconcileAccountStatus: vi.fn(), getCapabilities: () => ({ installationEvents: true }) },
      now: () => currentTime,
      random: () => 0,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      logger: { warn: vi.fn() },
    })
    coordinator.stopped = false

    const firstConnection = coordinator.connect()
    await eventually(() => expect(client.events).toHaveBeenCalledTimes(1))
    expect(timers.next(10_000)).toBeTruthy()
    currentTime += 10_000
    timers.next(10_000).callback()
    await firstConnection
    expect(first.cancelled()).toBe(true)
    expect(timers.next(0)).toBeTruthy()
    timers.next(0).callback()
    await eventually(() => expect(client.events).toHaveBeenCalledTimes(2))
    expect(activate).toHaveBeenCalledTimes(2)
    expect(credentials.map(({ clientInstanceId, installationId, keyId }) => ({ clientInstanceId, installationId, keyId })))
      .toEqual([stableIdentity, stableIdentity])
    coordinator.stop()
    expect(second.cancelled()).toBe(true)
  })

  it('persists bounded exponential reconnect state across consecutive failures and restart', async () => {
    let currentTime = 10_000
    const timers = timerHarness()
    const repository = lifecycleRepository()
    const client = { events: vi.fn(async () => { throw Object.assign(new Error('offline'), { code: 'network-error' }) }) }
    const identityService = {
      activate: vi.fn(async () => ({ tokenExpiresAt: new Date(currentTime + 600_000).toISOString() })),
      reconcileAccountStatus: vi.fn(),
      getCapabilities: () => ({ installationEvents: true }),
    }
    const coordinator = new SharingInstallationEventCoordinator({ repository, client, identityService, now: () => currentTime, random: () => 0, setTimer: timers.setTimer, clearTimer: timers.clearTimer, logger: { warn: vi.fn() } })
    coordinator.stopped = false
    await coordinator.connect()
    expect(repository.getSettings()).toMatchObject({ reconnectAttempt: 1, nextReconnectAtMs: 11_000, eventLastErrorCode: 'network-error' })
    currentTime = 11_000
    timers.next(1_000).callback()
    await eventually(() => expect(client.events).toHaveBeenCalledTimes(2))
    await eventually(() => expect(repository.getSettings().reconnectAttempt).toBe(2))
    expect(repository.getSettings().nextReconnectAtMs).toBe(13_000)

    coordinator.stop()
    currentTime = 12_000
    const restartedTimers = timerHarness()
    const restarted = new SharingInstallationEventCoordinator({ repository, client, identityService, now: () => currentTime, random: () => 0, setTimer: restartedTimers.setTimer, clearTimer: restartedTimers.clearTimer, logger: { warn: vi.fn() } })
    restarted.start()
    expect(restartedTimers.next(1_000)).toBeTruthy()
    restarted.stop()
  })

  it('keeps one effective connection and marks expired stale credentials as retrying', async () => {
    const now = 500_000
    const pending = controlledStream()
    const repository = lifecycleRepository({
      credentialExpiresAtMs: now - 1,
      lastConnectedAtMs: now - 300_000,
    })
    const client = { events: vi.fn(async () => pending.response) }
    const identityService = {
      activate: vi.fn(async () => ({ tokenExpiresAt: new Date(now + 600_000).toISOString() })),
      reconcileAccountStatus: vi.fn(),
      getCapabilities: () => ({ installationEvents: true }),
    }
    const coordinator = new SharingInstallationEventCoordinator({ repository, client, identityService, now: () => now, random: () => 0, logger: { warn: vi.fn() } })
    expect(coordinator.status()).toMatchObject({ effectiveEnrollmentState: 'retrying', live: false, credentialValid: false })
    coordinator.stopped = false
    const one = coordinator.connect()
    const two = coordinator.connect()
    expect(one).toBe(two)
    await eventually(() => expect(client.events).toHaveBeenCalledOnce())
    expect(coordinator.status()).toMatchObject({ effectiveEnrollmentState: 'connected', live: true })
    coordinator.stop()
    await one
  })

  it('aborts activation immediately when the last remote interest disappears', async () => {
    const repository = lifecycleRepository()
    let activationSignal
    const activate = vi.fn(({ signal }) => new Promise((_resolve, reject) => {
      activationSignal = signal
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const coordinator = new SharingInstallationEventCoordinator({
      repository,
      client: { events: vi.fn() },
      identityService: { activate, getCapabilities: () => ({ installationEvents: true }) },
      logger: { warn: vi.fn() },
    })
    coordinator.stopped = false
    const running = coordinator.connect()
    await eventually(() => expect(activationSignal).toBeInstanceOf(AbortSignal))
    repository.setInterest({ required: false, activeShares: 0 })
    coordinator.wake()
    await running
    expect(activationSignal.aborted).toBe(true)
    expect(repository.getSettings()).toMatchObject({ reconnectAttempt: 0, nextReconnectAtMs: null })
  })

  it('reconnects after heartbeat silence and resets the watchdog for comment frames', async () => {
    let currentTime = 10_000
    const timers = timerHarness()
    const repository = lifecycleRepository()
    let pending
    const client = { events: vi.fn(async (_cursor, { signal }) => {
      pending = pushStream(signal)
      return pending.response
    }) }
    const coordinator = new SharingInstallationEventCoordinator({
      repository,
      client,
      identityService: { activate: vi.fn(async () => ({ tokenExpiresAt: new Date(currentTime + 600_000).toISOString() })), getCapabilities: () => ({ installationEvents: true }) },
      now: () => currentTime,
      random: () => 0,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      logger: { warn: vi.fn() },
    })
    coordinator.stopped = false
    const running = coordinator.connect()
    await eventually(() => expect(timers.next(45_000)).toBeTruthy())
    const firstWatchdog = timers.next(45_000)
    currentTime = 20_000
    pending.push(': heartbeat\n\n')
    await eventually(() => expect(firstWatchdog.active).toBe(false))
    expect(coordinator.status().metrics.lastFrameAtMs).toBe(20_000)
    timers.next(45_000).callback()
    await running
    expect(repository.getSettings()).toMatchObject({ eventLastErrorCode: 'sharing-events-heartbeat-timeout', reconnectAttempt: 1 })
    expect(repository.getEventLifecycle()).toMatchObject({ streamOpenCount: 1, reconnectCount: 1 })
  })

  it('avoids account-status traffic on fresh reconnects and reconciles only stale state', async () => {
    const freshRepository = lifecycleRepository({ accountLastReconciledAtMs: 100_000 })
    const freshReconcile = vi.fn()
    const fresh = new SharingInstallationEventCoordinator({
      repository: freshRepository,
      client: { events: vi.fn(async () => stream([': heartbeat\n\n'])) },
      identityService: { activate: vi.fn(), reconcileAccountStatus: freshReconcile, getCapabilities: () => ({ installationEvents: true }) },
      now: () => 100_001,
      setTimer: () => 1,
      clearTimer: vi.fn(),
    })
    fresh.stopped = false
    await fresh.connect()
    expect(freshReconcile).not.toHaveBeenCalled()

    const staleRepository = lifecycleRepository({ accountLastReconciledAtMs: null })
    const staleReconcile = vi.fn(async () => null)
    const stale = new SharingInstallationEventCoordinator({
      repository: staleRepository,
      client: { events: vi.fn(async () => stream([': heartbeat\n\n'])) },
      identityService: { activate: vi.fn(), reconcileAccountStatus: staleReconcile, getCapabilities: () => ({ installationEvents: true }) },
      now: () => 100_001,
      setTimer: () => 1,
      clearTimer: vi.fn(),
    })
    stale.stopped = false
    await stale.connect()
    expect(staleReconcile).toHaveBeenCalledWith(undefined, { signal: expect.any(AbortSignal) })
  })

  it('resumes a persisted account claim after restart without exposing its identifier', () => {
    const repository = lifecycleRepository({ interest: { required: false, activeShares: 0, pendingPublicationOperations: 0, pendingAccountOperations: 0, recoveryPending: false } })
    const first = new SharingInstallationEventCoordinator({ repository, client: {}, identityService: {}, now: () => 10_000 })
    expect(first.holdClaim({ claimId: 'claim_private_1', expiresAt: 70_000 })).toBe(true)
    first.stop()
    const restarted = new SharingInstallationEventCoordinator({ repository, client: {}, identityService: {}, now: () => 20_000 })
    expect(restarted.status()).toMatchObject({ dormant: false, interest: { pendingClaim: true, pendingClaimExpiresAtMs: 70_000 } })
    expect(JSON.stringify(restarted.status())).not.toContain('claim_private_1')
  })
})
