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
})
