import { describe, expect, it, vi } from 'vitest'
import type { EngineRequestInput } from '@/engine/types'
import type { EngineResponse } from '../../shared/engine/protocol.mjs'
import { CableRoutingCoordinator } from '@/lib/cable-routing-coordinator'
import type { CableLaneRouteRequest } from '@/engine/routing'
import { DomainEngineInterruptedError, type DomainEngineClient } from '@/engine/client'

type PendingCall = {
  input: EngineRequestInput
  resolve: (response: EngineResponse) => void
  reject: (error: Error) => void
}

const cableRoute = (connectionId: number, y: number) => ({
  route: {
    connection_id: connectionId,
    points: [{ x: 0, y }, { x: 240, y }],
    manual_anchor_point_indexes: [],
  },
  used_fallback: false,
  warning: null,
})

function response(
  routes: ReturnType<typeof cableRoute>[],
  recalculated = routes.map((route) => route.route.connection_id),
): EngineResponse {
  return {
    protocol_version: 1 as const,
    request_id: 1,
    base_revision: 0,
    result: {
      kind: 'cable-routes-planned' as const,
      payload: {
        routes,
        recalculated_connection_ids: recalculated,
      },
    },
  }
}

class FakeClient {
  readonly calls: PendingCall[] = []

  transient(input: EngineRequestInput) {
    return new Promise<EngineResponse>((resolve, reject) => {
      this.calls.push({ input, resolve, reject })
    })
  }
}

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
      obstacles: [],
      sourceItemId: 'server:1',
      targetItemId: 'switch:1',
      snapToGrid: false,
    },
  }
}

describe('CableRoutingCoordinator', () => {
  it('coalesces queued work and applies only the newest revision', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)

    expect(coordinator.request([request(1, 0)])).toBe(1)
    expect(coordinator.request([request(1, 12)])).toBe(2)
    expect(coordinator.request([request(1, 24)])).toBe(3)
    expect(client.calls).toHaveLength(1)

    client.calls[0].resolve(response([cableRoute(1, 0)]))
    await vi.waitFor(() => expect(client.calls).toHaveLength(2))
    expect(coordinator.getState().routes.size).toBe(0)

    client.calls[1].resolve(response([cableRoute(1, 24)]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    expect(coordinator.getState().routes.get(1)?.points[0].y).toBe(24)
  })

  it('retains the last valid route while recalculation is pending or fails', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)

    coordinator.request([request(1)])
    client.calls[0].resolve(response([cableRoute(1, 0)]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    const retained = coordinator.getState().routes.get(1)

    coordinator.request([request(1, 12)])
    expect(coordinator.getState().routes.get(1)).toBe(retained)
    client.calls[1].reject(new Error('route error'))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    expect(coordinator.getState().routes.get(1)).toBe(retained)
    expect(coordinator.getState().error).toBe('route error')
  })

  it('retains routes without publishing an error for expected worker interruption', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)

    coordinator.request([request(1)])
    client.calls[0].resolve(response([cableRoute(1, 0)]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    const retainedRoutes = coordinator.getState().routes

    coordinator.request([request(1, 12)])
    client.calls[1].reject(new DomainEngineInterruptedError())
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState()).toEqual({
      routes: retainedRoutes,
      pending: false,
      error: null,
    })
  })

  it('preserves equal route identities returned by the engine', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    coordinator.request([request(1), request(2, 24)])
    client.calls[0].resolve(response([cableRoute(1, 0), cableRoute(2, 24)]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    const secondRoute = coordinator.getState().routes.get(2)

    coordinator.request([request(1, 12), request(2, 24)])
    client.calls[1].resolve(response([cableRoute(1, 12), cableRoute(2, 24)], [1]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    expect(coordinator.getState().routes.get(2)).toBe(secondRoute)
  })

  it('can replay unchanged requests after the worker is rebuilt without clearing routes', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const stableRequest = request(1)
    coordinator.request([stableRequest])
    client.calls[0].resolve(response([cableRoute(1, 0)]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    const retained = coordinator.getState().routes.get(1)

    coordinator.request([stableRequest], true)
    expect(client.calls).toHaveLength(2)
    expect(coordinator.getState().routes.get(1)).toBe(retained)
    client.calls[1].resolve(response([cableRoute(1, 0)], [1]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    expect(coordinator.getState().routes.get(1)).toBe(retained)
  })

  it('clears rendered routes and ignores an in-flight result after disposal', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const listener = vi.fn()
    coordinator.subscribe(listener)
    coordinator.request([request(1)])
    coordinator.clear()
    expect(coordinator.getState().routes.size).toBe(0)

    coordinator.dispose()
    client.calls[0].resolve(response([cableRoute(1, 0)]))
    await Promise.resolve()
    expect(coordinator.getState().routes.size).toBe(0)
  })
})
