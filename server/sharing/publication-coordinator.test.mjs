import { describe, expect, it, vi } from 'vitest'
import { SharingPublicationCoordinator } from './publication-coordinator.mjs'

describe('sharing publication coordinator', () => {
  it('does not process publication while disconnected', async () => {
    const repository = {
      getSettings: () => ({ connectionEnabled: true, enrollmentState: 'retrying' }),
      nextOperation: vi.fn(() => ({ id: 1, shareId: 1, kind: 'publish' })),
    }
    const publicationService = { executePublish: vi.fn() }
    const coordinator = new SharingPublicationCoordinator({ repository, publicationService })
    await coordinator.runNext()
    expect(repository.nextOperation).not.toHaveBeenCalled()
    expect(publicationService.executePublish).not.toHaveBeenCalled()
  })

  it('processes one queued publication at a time', async () => {
    const repository = {
      getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected' }),
      nextOperation: vi.fn().mockReturnValueOnce({ id: 1, shareId: 1, kind: 'publish' }).mockReturnValue(null),
    }
    const publicationService = { executePublish: vi.fn(async () => {}), onStateChanged: vi.fn() }
    const coordinator = new SharingPublicationCoordinator({ repository, publicationService, setTimer: () => 1, clearTimer: () => {} })
    await coordinator.runNext()
    expect(publicationService.executePublish).toHaveBeenCalledTimes(1)
  })

  it('reuses the queued idempotency operation for lifecycle execution', async () => {
    const operation = { id: 2, shareId: 4, kind: 'unpublish', idempotencyKey: 'stable-unpublish', attemptCount: 0 }
    const repository = { getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected' }), nextOperation: vi.fn(() => operation) }
    const publicationService = { executeLifecycle: vi.fn(async (received) => expect(received.idempotencyKey).toBe('stable-unpublish')), onStateChanged: vi.fn() }
    const coordinator = new SharingPublicationCoordinator({ repository, publicationService, setTimer: () => 1, clearTimer: () => {} })
    await coordinator.runNext()
    expect(publicationService.executeLifecycle).toHaveBeenCalledOnce()
  })

  it('keeps Registry-blocked publications retrying beyond six attempts with durable bounded backoff', async () => {
    const operation = { id: 7, shareId: 4, kind: 'publish', attemptCount: 8 }
    const updateOperation = vi.fn()
    const repository = {
      getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected' }),
      nextOperation: vi.fn(() => operation),
      updateOperation,
      getShare: () => ({ id: 4, localRevision: 3 }),
      updateShare: vi.fn(),
    }
    const publicationService = { executePublish: vi.fn(async () => { throw Object.assign(new Error('Registry unavailable'), { code: 'registry-definition-unavailable' }) }), onStateChanged: vi.fn() }
    const coordinator = new SharingPublicationCoordinator({ repository, publicationService, now: () => 1_000, setTimer: () => 1, clearTimer: () => {} })
    await coordinator.runNext()
    expect(updateOperation).toHaveBeenCalledWith(7, expect.objectContaining({ state: 'retrying', attemptCount: 9, availableAtMs: 1_000 + 15_000 * 2 ** 8 }))
  })

  it('resumes the persisted retry deadline after coordinator restart', async () => {
    const delays = []
    const repository = {
      getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected' }),
      nextOperation: vi.fn(() => null),
      nextOperationAvailableAt: vi.fn(() => 301_000),
    }
    const coordinator = new SharingPublicationCoordinator({
      repository,
      publicationService: {},
      now: () => 1_000,
      setTimer: (_callback, delay) => { delays.push(delay); return 1 },
      clearTimer: () => {},
    })

    await coordinator.runNext()

    expect(repository.nextOperation).toHaveBeenCalledWith(1_000)
    expect(delays).toEqual([300_000])
  })

  it('fails ownership and integrity errors immediately instead of retrying', async () => {
    for (const code of ['publication-ownership-denied', 'sharing-publication-integrity-failed']) {
      const operation = { id: 8, shareId: 5, kind: 'publish', attemptCount: 0 }
      const updateOperation = vi.fn()
      const repository = { getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected' }), nextOperation: vi.fn(() => operation), updateOperation, getShare: () => ({ id: 5, localRevision: 1 }), updateShare: vi.fn(() => ({})) }
      const publicationService = { executePublish: vi.fn(async () => { throw Object.assign(new Error(code), { code }) }), onStateChanged: vi.fn() }
      const coordinator = new SharingPublicationCoordinator({ repository, publicationService, setTimer: () => 1, clearTimer: () => {} })
      await coordinator.runNext()
      expect(updateOperation).toHaveBeenCalledWith(8, expect.objectContaining({ state: 'failed', attemptCount: 1 }))
    }
  })
})
