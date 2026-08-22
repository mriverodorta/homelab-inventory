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
})
