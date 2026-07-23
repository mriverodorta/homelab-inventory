import { describe, expect, it, vi } from 'vitest'
import { CableRoutingCoordinator } from '@/lib/cable-routing-coordinator'
import type { CableLaneRouteRequest } from '@/lib/cable-lane-routing'
import type {
  CableRoutingWorkerLike,
  CableRoutingWorkerRequest,
  CableRoutingWorkerResponse,
} from '@/lib/cable-routing-worker-protocol'

class FakeWorker implements CableRoutingWorkerLike {
  readonly messages: CableRoutingWorkerRequest[] = []
  private listener: ((event: MessageEvent<CableRoutingWorkerResponse>) => void) | null = null
  private errorListener: ((event: ErrorEvent) => void) | null = null
  terminate = vi.fn()

  postMessage(message: CableRoutingWorkerRequest) {
    this.messages.push(message)
  }

  addEventListener(type: 'message' | 'error', listener: ((event: MessageEvent<CableRoutingWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === 'message') {
      this.listener = listener as (event: MessageEvent<CableRoutingWorkerResponse>) => void
    } else {
      this.errorListener = listener as (event: ErrorEvent) => void
    }
  }

  removeEventListener(type: 'message' | 'error', listener: ((event: MessageEvent<CableRoutingWorkerResponse>) => void) | ((event: ErrorEvent) => void)) {
    if (type === 'message' && this.listener === listener) this.listener = null
    if (type === 'error' && this.errorListener === listener) this.errorListener = null
  }

  respond(response: CableRoutingWorkerResponse) {
    this.listener?.({ data: response } as MessageEvent<CableRoutingWorkerResponse>)
  }

  fail(message: string) {
    this.errorListener?.({ message } as ErrorEvent)
  }
}

const obstacles: CableLaneRouteRequest['request']['obstacles'] = []

function request(
  connectionId: number,
  y = 0,
  avoidCableOverlap = false,
): CableLaneRouteRequest {
  return {
    connectionId,
    avoidCableOverlap,
    request: {
      source: { x: 0, y },
      target: { x: 240, y },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
      obstacles,
      sourceItemId: 'server:1',
      targetItemId: 'switch:1',
      snapToGrid: false,
    },
  }
}

const requests = [request(1)]
const route = {
  points: [{ x: 0, y: 0 }, { x: 24, y: 0 }],
  manualAnchorPointIndexes: [],
  usedFallback: false,
}

describe('CableRoutingCoordinator', () => {
  it('coalesces queued work and applies only the newest revision', () => {
    const worker = new FakeWorker()
    const coordinator = new CableRoutingCoordinator(worker)

    expect(coordinator.request([request(1, 0)])).toBe(1)
    expect(coordinator.request([request(1, 12)])).toBe(2)
    expect(coordinator.request([request(1, 24)])).toBe(3)
    expect(worker.messages.map((message) => message.revision)).toEqual([1])
    expect(coordinator.getState().pending).toBe(true)

    worker.respond({ type: 'routes-ready', revision: 1, routes: [[1, route]] })
    expect(worker.messages.map((message) => message.revision)).toEqual([1, 3])
    expect(coordinator.getState().routes.size).toBe(0)

    worker.respond({ type: 'routes-ready', revision: 3, routes: [[1, route]] })
    expect(coordinator.getState()).toMatchObject({ pending: false, error: null })
    expect([...coordinator.getState().routes.keys()]).toEqual([1])
  })

  it('retains the last valid routes while a new request is pending or fails', () => {
    const worker = new FakeWorker()
    const coordinator = new CableRoutingCoordinator(worker)

    coordinator.request(requests)
    worker.respond({ type: 'routes-ready', revision: 1, routes: [[1, route]] })
    coordinator.request([request(1, 12)])
    expect([...coordinator.getState().routes.keys()]).toEqual([1])
    expect(coordinator.getState().pending).toBe(true)

    worker.respond({ type: 'routes-failed', revision: 2, message: 'route error' })
    expect([...coordinator.getState().routes.keys()]).toEqual([1])
    expect(coordinator.getState()).toMatchObject({ pending: false, error: 'route error' })
  })

  it('notifies subscribers and disposes the worker', () => {
    const worker = new FakeWorker()
    const coordinator = new CableRoutingCoordinator(worker)
    const listener = vi.fn()
    const unsubscribe = coordinator.subscribe(listener)

    coordinator.request(requests)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    coordinator.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('retains routes and exits the pending state after a worker error', () => {
    const worker = new FakeWorker()
    const coordinator = new CableRoutingCoordinator(worker)

    coordinator.request(requests)
    worker.respond({ type: 'routes-ready', revision: 1, routes: [[1, route]] })
    coordinator.request([request(1, 12)])
    worker.fail('Worker crashed')

    expect([...coordinator.getState().routes.keys()]).toEqual([1])
    expect(coordinator.getState()).toMatchObject({ pending: false, error: 'Worker crashed' })
  })

  it('clears routes without posting empty work and rejects an in-flight result', () => {
    const worker = new FakeWorker()
    const coordinator = new CableRoutingCoordinator(worker)

    coordinator.request(requests)
    coordinator.clear()
    worker.respond({ type: 'routes-ready', revision: 1, routes: [[1, route]] })

    expect(worker.messages).toHaveLength(1)
    expect(coordinator.getState()).toEqual({
      routes: new Map(),
      pending: false,
      error: null,
    })
  })

  it('routes only a changed independent cable and preserves unrelated route identity', () => {
    const worker = new FakeWorker()
    const coordinator = new CableRoutingCoordinator(worker)
    const secondRoute = {
      points: [{ x: 0, y: 24 }, { x: 240, y: 24 }],
      manualAnchorPointIndexes: [],
      usedFallback: false,
    }

    coordinator.request([request(1), request(2, 24)])
    worker.respond({
      type: 'routes-ready',
      revision: 1,
      routes: [[1, route], [2, secondRoute]],
    })

    coordinator.request([request(1, 12), request(2, 24)])
    expect(worker.messages[1].requests.map((entry) => entry.connectionId)).toEqual([1])

    const changedRoute = {
      points: [{ x: 0, y: 12 }, { x: 240, y: 12 }],
      manualAnchorPointIndexes: [],
      usedFallback: false,
    }
    worker.respond({ type: 'routes-ready', revision: 2, routes: [[1, changedRoute]] })

    expect(coordinator.getState().routes.get(1)).toBe(changedRoute)
    expect(coordinator.getState().routes.get(2)).toBe(secondRoute)
  })

  it('reroutes the full batch for collision dependencies but preserves equal route objects', () => {
    const worker = new FakeWorker()
    const coordinator = new CableRoutingCoordinator(worker)
    const secondRoute = {
      points: [{ x: 0, y: 24 }, { x: 240, y: 24 }],
      manualAnchorPointIndexes: [],
      usedFallback: false,
    }

    coordinator.request([request(1), request(2, 24, true)])
    worker.respond({
      type: 'routes-ready',
      revision: 1,
      routes: [[1, route], [2, secondRoute]],
    })

    coordinator.request([request(1, 12), request(2, 24, true)])
    expect(worker.messages[1].requests.map((entry) => entry.connectionId)).toEqual([1, 2])

    worker.respond({
      type: 'routes-ready',
      revision: 2,
      routes: [
        [1, { ...route, points: [{ x: 0, y: 12 }, { x: 240, y: 12 }] }],
        [2, { ...secondRoute, points: secondRoute.points.map((point) => ({ ...point })) }],
      ],
    })

    expect(coordinator.getState().routes.get(2)).toBe(secondRoute)
  })
})
