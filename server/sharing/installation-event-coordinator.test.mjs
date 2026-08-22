import { describe, expect, it, vi } from 'vitest'
import { SharingInstallationEventCoordinator } from './installation-event-coordinator.mjs'

function stream(frames) {
  return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } })
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
    expect(client.events).toHaveBeenCalledWith(7)
    expect(applied).toEqual([8, 9])
    expect(delays).toEqual([1000])
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

  it('never starts in fixture-disabled, demo, or staging runtime', () => {
    const setTimer = vi.fn()
    const coordinator = new SharingInstallationEventCoordinator({ repository: {}, client: {}, identityService: {}, effectiveEnabled: false, setTimer })
    coordinator.start()
    expect(setTimer).not.toHaveBeenCalled()
  })
})
