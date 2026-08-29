import { describe, expect, it, vi } from 'vitest'
import { SharingPublicationCoordinator } from './publication-coordinator.mjs'

function queueRepository(operations, { connected = true } = {}) {
  const rows = new Map(operations.map((operation) => [operation.id, {
    state: 'queued',
    attemptCount: 0,
    availableAtMs: 1_000,
    ...operation,
  }]))
  const updates = []
  return {
    rows,
    updates,
    getSettings: () => ({ connectionEnabled: true, enrollmentState: connected ? 'connected' : 'retrying' }),
    nextOperation: vi.fn((at) => [...rows.values()]
      .filter((operation) => ['queued', 'running', 'retrying'].includes(operation.state) && operation.availableAtMs <= at)
      .sort((left, right) => left.availableAtMs - right.availableAtMs || left.id - right.id)[0] ?? null),
    nextOperationAvailableAt: vi.fn(() => {
      const deadlines = [...rows.values()]
        .filter((operation) => ['queued', 'running', 'retrying'].includes(operation.state))
        .map((operation) => operation.availableAtMs)
      return deadlines.length ? Math.min(...deadlines) : null
    }),
    updateOperation: vi.fn((id, patch) => {
      rows.set(id, { ...rows.get(id), ...patch })
      updates.push({ id, patch })
    }),
    getShare: vi.fn((id) => ({ id, localRevision: 1 })),
    updateShare: vi.fn((id, _revision, patch) => ({ id, localRevision: 2, ...patch })),
  }
}

function serviceFor(repository, handler = async () => {}) {
  const run = async (operation) => {
    await handler(operation)
    repository.updateOperation(operation.id, { state: 'succeeded', lastErrorCode: null })
  }
  return {
    executePublish: vi.fn(run),
    executeLifecycle: vi.fn(run),
    onStateChanged: vi.fn(),
  }
}

function coordinatorFor(repository, publicationService, options = {}) {
  const timers = []
  const coordinator = new SharingPublicationCoordinator({
    repository,
    publicationService,
    now: () => 1_000,
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length },
    clearTimer: () => {},
    ...options,
  })
  return { coordinator, timers }
}

describe('sharing publication coordinator', () => {
  it('does not process publication while disconnected', async () => {
    const repository = queueRepository([{ id: 1, shareId: 1, kind: 'publish' }], { connected: false })
    const publicationService = serviceFor(repository)
    const { coordinator } = coordinatorFor(repository, publicationService)
    await coordinator.runNext()
    expect(repository.nextOperation).not.toHaveBeenCalled()
    expect(publicationService.executePublish).not.toHaveBeenCalled()
  })

  it('runs a ready publication immediately after a Registry-blocked operation reaches the six-hour cap', async () => {
    const repository = queueRepository([
      { id: 1, shareId: 1, kind: 'publish', attemptCount: 40 },
      { id: 2, shareId: 2, kind: 'publish' },
    ])
    const publicationService = serviceFor(repository, async (operation) => {
      if (operation.id === 1) throw Object.assign(new Error('Registry unavailable'), { code: 'registry-definition-unavailable' })
    })
    const { coordinator } = coordinatorFor(repository, publicationService)

    await coordinator.runNext()

    expect(publicationService.executePublish.mock.calls.map(([operation]) => operation.id)).toEqual([1, 2])
    expect(repository.rows.get(1)).toMatchObject({ state: 'retrying', availableAtMs: 21_601_000 })
    expect(repository.rows.get(2)).toMatchObject({ state: 'succeeded' })
  })

  it.each(['unpublish', 'delete'])('does not let a blocked publication delay a ready %s operation', async (kind) => {
    const repository = queueRepository([
      { id: 1, shareId: 1, kind: 'publish', attemptCount: 40 },
      { id: 2, shareId: 2, kind },
    ])
    const publicationService = serviceFor(repository, async (operation) => {
      if (operation.id === 1) throw Object.assign(new Error('Registry unavailable'), { code: 'registry-definition-unavailable' })
    })
    const { coordinator } = coordinatorFor(repository, publicationService)

    await coordinator.runNext()

    expect(publicationService.executeLifecycle).toHaveBeenCalledOnce()
    expect(publicationService.executeLifecycle.mock.calls[0][0]).toMatchObject({ id: 2, kind })
  })

  it('executes ready operations by durable deadline and then operation ID', async () => {
    const repository = queueRepository([
      { id: 4, shareId: 4, kind: 'publish', availableAtMs: 900 },
      { id: 2, shareId: 2, kind: 'publish', availableAtMs: 900 },
      { id: 1, shareId: 1, kind: 'publish', availableAtMs: 800 },
    ])
    const publicationService = serviceFor(repository)
    const { coordinator } = coordinatorFor(repository, publicationService)

    await coordinator.runNext()

    expect(publicationService.executePublish.mock.calls.map(([operation]) => operation.id)).toEqual([1, 2, 4])
  })

  it('yields after a bounded batch and immediately schedules another turn', async () => {
    const repository = queueRepository([
      { id: 1, shareId: 1, kind: 'publish' },
      { id: 2, shareId: 2, kind: 'publish' },
      { id: 3, shareId: 3, kind: 'publish' },
    ])
    const publicationService = serviceFor(repository)
    const { coordinator, timers } = coordinatorFor(repository, publicationService, { maxOperationsPerTurn: 2 })

    await coordinator.runNext()

    expect(publicationService.executePublish.mock.calls.map(([operation]) => operation.id)).toEqual([1, 2])
    expect(repository.rows.get(3)).toMatchObject({ state: 'queued' })
    expect(timers.map(({ delay }) => delay)).toEqual([0])
  })

  it('uses the earliest persisted deadline when no operation is ready', async () => {
    const repository = queueRepository([
      { id: 1, shareId: 1, kind: 'publish', availableAtMs: 301_000 },
      { id: 2, shareId: 2, kind: 'publish', availableAtMs: 121_000 },
    ])
    const { coordinator, timers } = coordinatorFor(repository, serviceFor(repository))

    await coordinator.runNext()

    expect(timers.map(({ delay }) => delay)).toEqual([120_000])
  })

  it('resumes persisted order and retry deadlines after coordinator restart', async () => {
    const repository = queueRepository([
      { id: 7, shareId: 7, kind: 'publish', state: 'retrying', availableAtMs: 301_000, attemptCount: 9 },
      { id: 8, shareId: 8, kind: 'publish', state: 'queued', availableAtMs: 201_000 },
    ])
    const first = coordinatorFor(repository, serviceFor(repository))
    await first.coordinator.runNext()
    expect(first.timers.map(({ delay }) => delay)).toEqual([200_000])

    const restarted = coordinatorFor(repository, serviceFor(repository))
    await restarted.coordinator.runNext()
    expect(restarted.timers.map(({ delay }) => delay)).toEqual([200_000])
    expect([...repository.rows.values()].map(({ id, availableAtMs, attemptCount }) => ({ id, availableAtMs, attemptCount }))).toEqual([
      { id: 7, availableAtMs: 301_000, attemptCount: 9 },
      { id: 8, availableAtMs: 201_000, attemptCount: 0 },
    ])
  })

  it('changes only the failing operation and never duplicates its remote request', async () => {
    const repository = queueRepository([
      { id: 1, shareId: 1, kind: 'publish', idempotencyKey: 'stable-a' },
      { id: 2, shareId: 2, kind: 'publish', idempotencyKey: 'stable-b' },
    ])
    const beforeSecond = { ...repository.rows.get(2) }
    const publicationService = serviceFor(repository, async (operation) => {
      if (operation.id === 1) throw Object.assign(new Error('Registry unavailable'), { code: 'registry-definition-unavailable' })
    })
    const { coordinator } = coordinatorFor(repository, publicationService, { maxOperationsPerTurn: 1 })

    await coordinator.runNext()

    expect(repository.updates).toEqual([{
      id: 1,
      patch: expect.objectContaining({ state: 'retrying', attemptCount: 1 }),
    }])
    expect(repository.rows.get(2)).toEqual(beforeSecond)
    expect(publicationService.executePublish).toHaveBeenCalledTimes(1)
    expect(publicationService.executePublish.mock.calls[0][0].idempotencyKey).toBe('stable-a')
  })

  it('fails ownership and integrity errors immediately instead of retrying', async () => {
    for (const code of ['publication-ownership-denied', 'sharing-publication-integrity-failed']) {
      const repository = queueRepository([{ id: 8, shareId: 5, kind: 'publish' }])
      const publicationService = serviceFor(repository, async () => { throw Object.assign(new Error(code), { code }) })
      const { coordinator } = coordinatorFor(repository, publicationService)
      await coordinator.runNext()
      expect(repository.rows.get(8)).toMatchObject({ state: 'failed', attemptCount: 1, lastErrorCode: code })
    }
  })
})
