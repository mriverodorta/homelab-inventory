import { describe, expect, it, vi } from 'vitest'
import type { EngineRequestInput } from '@/engine/types'
import type { EngineResponse } from '../../shared/engine/protocol.mjs'
import { CableRoutingCoordinator } from '@/lib/cable-routing-coordinator'
import type { CableLaneRouteRequest, CableRoutingCacheSnapshot } from '@/engine/routing'
import {
  cableRoutingGeometryFingerprint,
  ROUTING_CACHE_FORMAT_VERSION,
  ROUTING_PLANNER_VERSION,
} from '@/engine/routing'
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
  source_side: 'right' as const,
  target_side: 'left' as const,
  used_fallback: false,
  warning: null,
})

function response(
  routes: ReturnType<typeof cableRoute>[],
  recalculated = routes.map((route) => route.route.connection_id),
  failures: Array<{ connection_id: number; message: string }> = [],
  deferredConnectionIds: number[] = [],
  repairs: Array<{
    connection_id: number
    bend_points: Array<{ x: number; y: number }>
    reason: 'terminal-overlap'
  }> = [],
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
        deferred_connection_ids: deferredConnectionIds,
        failures,
        repairs,
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
      sourceCandidates: [
        { point: { x: 0, y }, side: 'right' },
      ],
      targetCandidates: [
        { point: { x: 240, y }, side: 'left' },
      ],
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

  it('does not replay an unchanged request after a terminal routing failure', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const stableRequest = request(1)

    coordinator.request([stableRequest])
    client.calls[0].reject(new Error('Workspace engine request timed out.'))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState().error).toBe('Workspace engine request timed out.')
    expect(coordinator.request([stableRequest])).toBe(1)
    expect(client.calls).toHaveLength(1)
  })

  it('does not let stale in-flight work overwrite a restored cached geometry', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const originalRequest = request(1)

    coordinator.request([originalRequest])
    client.calls[0].resolve(response([cableRoute(1, 0)]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    coordinator.request([request(1, 24)])
    expect(client.calls).toHaveLength(2)

    coordinator.request([originalRequest])
    expect(coordinator.getState().routes.get(1)?.points).toEqual(cableRoute(1, 0).route.points)
    expect(coordinator.getState().pending).toBe(true)

    client.calls[1].resolve(response([cableRoute(1, 24)]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState().routes.get(1)?.points).toEqual(cableRoute(1, 0).route.points)
    expect(client.calls).toHaveLength(2)
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
      warnings: new Map(),
      repairs: new Map(),
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

  it('retains the last route when the planner temporarily omits a desired connection', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)

    coordinator.request([request(1)])
    client.calls[0].resolve(response([cableRoute(1, 0)]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    const retained = coordinator.getState().routes.get(1)

    coordinator.request([request(1, 12)])
    client.calls[1].resolve(response([], [1]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState().routes.get(1)).toBe(retained)
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

  it('clears rendered routes without replacing the durable route cache', () => {
    const client = new FakeClient()
    const persistCache = vi.fn(async () => undefined)
    const coordinator = new CableRoutingCoordinator(
      client as unknown as DomainEngineClient,
      { persistCache },
    )
    const stableRequest = request(1)
    coordinator.hydrate(exactCache(stableRequest))
    coordinator.request([stableRequest])

    coordinator.clear()

    expect(coordinator.getState().routes.size).toBe(0)
    expect(persistCache).not.toHaveBeenCalled()
    coordinator.request([stableRequest])
    expect(client.calls).toHaveLength(0)
    expect(coordinator.getState().routes.get(1)?.points).toEqual(cableRoute(1, 0).route.points)
  })

  it('does not reroute when only obstacle object identities change', () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const first = request(1)
    first.request.obstacles = [{
      itemId: 'server:1', left: 0, top: 0, right: 120, bottom: 80,
    }]
    const equivalent = request(1)
    equivalent.request.obstacles = [{
      itemId: 'server:1', left: 0, top: 0, right: 120, bottom: 80,
    }]

    coordinator.request([first])
    coordinator.request([equivalent])

    expect(client.calls).toHaveLength(1)
  })

  it('hydrates an exact persisted route cache without dispatching planner work', () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const stableRequest = request(1)
    coordinator.hydrate({
      version: ROUTING_CACHE_FORMAT_VERSION,
      plannerVersion: ROUTING_PLANNER_VERSION,
      geometryFingerprint: cableRoutingGeometryFingerprint([stableRequest]),
      obstacles: [],
      entries: [{
        input: {
          avoid_cable_overlap: false,
          request: {
            definition: {
              connection_id: 1,
              source: { x: 0, y: 0 },
              target: { x: 240, y: 0 },
              source_side: 'right',
              target_side: 'left',
              lane_offset: 24,
              manual_bends: [],
            },
            source_candidates: [{ point: { x: 0, y: 0 }, side: 'right' }],
            target_candidates: [{ point: { x: 240, y: 0 }, side: 'left' }],
            source_side_constraint: 'right',
            target_side_constraint: 'left',
            previous_source_side: null,
            previous_target_side: null,
            source_item_id: 'server:1',
            target_item_id: 'switch:1',
            obstacles: [],
            reserved_segments: [],
            snap_to_grid: false,
            grid_size: 12,
            previous_valid_route: null,
          },
        },
        result: cableRoute(1, 0),
      }],
      failures: [],
      updatedAt: '2026-07-30T00:00:00.000Z',
    })

    expect(coordinator.request([stableRequest])).toBe(0)
    expect(client.calls).toHaveLength(0)
    expect(coordinator.getState()).toEqual({
      routes: new Map([[1, expect.objectContaining({ points: cableRoute(1, 0).route.points })]]),
      pending: false,
      error: null,
      warnings: new Map(),
      repairs: new Map(),
    })
  })

  it('renders an exact cache immediately while reseeding a rebuilt worker', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const stableRequest = request(1)
    coordinator.hydrate(exactCache(stableRequest))

    coordinator.request([stableRequest], true)

    expect(client.calls).toHaveLength(1)
    expect(coordinator.getState().routes.get(1)?.points).toEqual(cableRoute(1, 0).route.points)
    expect(coordinator.getState().pending).toBe(true)
    client.calls[0].resolve(response([cableRoute(1, 0)], []))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    expect(coordinator.getState().routes.get(1)?.points).toEqual(cableRoute(1, 0).route.points)
  })

  it('publishes route repairs without persisting a cache built from stale bend inputs', async () => {
    const client = new FakeClient()
    const persistCache = vi.fn(async () => undefined)
    const coordinator = new CableRoutingCoordinator(
      client as unknown as DomainEngineClient,
      { persistCache },
    )
    const invalidRequest = request(1)
    invalidRequest.request.manualBendPoints = [{ x: 24, y: 12 }]

    coordinator.request([invalidRequest])
    client.calls[0].resolve(response(
      [cableRoute(1, 0)],
      [1],
      [],
      [],
      [{
        connection_id: 1,
        bend_points: [{ x: 24, y: 0 }],
        reason: 'terminal-overlap',
      }],
    ))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState().repairs.get(1)).toEqual({
      connectionId: 1,
      originalBendPoints: [{ x: 24, y: 12 }],
      bendPoints: [{ x: 24, y: 0 }],
      reason: 'terminal-overlap',
    })
    expect(persistCache).not.toHaveBeenCalled()
  })

  it('hydrates a known route failure without retrying unchanged geometry', () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const stableRequest = request(1)
    coordinator.hydrate({
      version: ROUTING_CACHE_FORMAT_VERSION,
      plannerVersion: ROUTING_PLANNER_VERSION,
      geometryFingerprint: cableRoutingGeometryFingerprint([stableRequest]),
      obstacles: [],
      entries: [],
      failures: [{
        connection_id: 1,
        message: 'No bounded orthogonal route was found.',
      }],
      updatedAt: '2026-07-30T00:00:00.000Z',
    })

    coordinator.request([stableRequest])

    expect(client.calls).toHaveLength(0)
    expect(coordinator.getState().pending).toBe(false)
    expect(coordinator.getState().warnings.get(1)).toContain('No bounded')
  })

  it('continues bounded route batches before publishing the completed plan', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const requests = [1, 2, 3, 4, 5].map((id) => request(id, id * 24))

    coordinator.request(requests)
    client.calls[0].resolve(response(
      [1, 2, 3, 4].map((id) => cableRoute(id, id * 24)),
      [1, 2, 3, 4],
      [],
      [5],
    ))
    await vi.waitFor(() => expect(client.calls).toHaveLength(2))
    expect(coordinator.getState().pending).toBe(true)

    client.calls[1].resolve(response(
      [1, 2, 3, 4, 5].map((id) => cableRoute(id, id * 24)),
      [5],
    ))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState().routes.size).toBe(5)
    expect(coordinator.getState().error).toBeNull()
  })

  it('replans when a matching cache fingerprint is missing a requested connection', async () => {
    const client = new FakeClient()
    const persistCache = vi.fn(async () => undefined)
    const coordinator = new CableRoutingCoordinator(
      client as unknown as DomainEngineClient,
      { persistCache },
    )
    const requests = [request(1), request(2, 24)]
    const cache = {
      version: ROUTING_CACHE_FORMAT_VERSION,
      plannerVersion: ROUTING_PLANNER_VERSION,
      geometryFingerprint: cableRoutingGeometryFingerprint(requests),
      obstacles: [],
      entries: [{
        input: {
          avoid_cable_overlap: false,
          request: {
            definition: {
              connection_id: 1,
              source: { x: 0, y: 0 },
              target: { x: 240, y: 0 },
              source_side: 'right' as const,
              target_side: 'left' as const,
              lane_offset: 24,
              manual_bends: [],
            },
            source_candidates: [{ point: { x: 0, y: 0 }, side: 'right' as const }],
            target_candidates: [{ point: { x: 240, y: 0 }, side: 'left' as const }],
            source_side_constraint: 'right' as const,
            target_side_constraint: 'left' as const,
            previous_source_side: null,
            previous_target_side: null,
            source_item_id: 'server:1',
            target_item_id: 'switch:1',
            obstacles: [],
            reserved_segments: [],
            snap_to_grid: false,
            grid_size: 12,
            previous_valid_route: null,
          },
        },
        result: cableRoute(1, 0),
      }],
      failures: [],
      updatedAt: '2026-07-30T00:00:00.000Z',
    }
    coordinator.hydrate(cache)

    coordinator.request(requests)

    expect(client.calls).toHaveLength(1)
    expect(coordinator.getState().pending).toBe(true)
    expect(coordinator.getState().routes).toEqual(new Map([
      [1, expect.objectContaining({ points: cableRoute(1, 0).route.points })],
    ]))
    client.calls[0].resolve(response([cableRoute(1, 0), cableRoute(2, 24)], [2]))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    expect(coordinator.getState().routes.size).toBe(2)
    expect(persistCache).toHaveBeenCalledOnce()
  })

  it('replans when a matching cache fingerprint contains a stale extra connection', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    const requests = [request(1)]
    const extraRequest = request(2, 24)
    const fullRequests = [...requests, extraRequest]
    const cache = {
      version: ROUTING_CACHE_FORMAT_VERSION,
      plannerVersion: ROUTING_PLANNER_VERSION,
      geometryFingerprint: cableRoutingGeometryFingerprint(requests),
      obstacles: [],
      entries: fullRequests.map((entry, index) => ({
        input: {
          avoid_cable_overlap: entry.avoidCableOverlap,
          request: {
            definition: {
              connection_id: entry.connectionId,
              source: entry.request.source,
              target: entry.request.target,
              source_side: 'right' as const,
              target_side: 'left' as const,
              lane_offset: 24,
              manual_bends: [],
            },
            source_candidates: [{ point: entry.request.source, side: 'right' as const }],
            target_candidates: [{ point: entry.request.target, side: 'left' as const }],
            source_side_constraint: 'right' as const,
            target_side_constraint: 'left' as const,
            previous_source_side: null,
            previous_target_side: null,
            source_item_id: 'server:1',
            target_item_id: 'switch:1',
            obstacles: [],
            reserved_segments: [],
            snap_to_grid: false,
            grid_size: 12,
            previous_valid_route: null,
          },
        },
        result: [cableRoute(1, 0), cableRoute(2, 24)][index],
      })),
      failures: [],
      updatedAt: '2026-07-30T00:00:00.000Z',
    }
    coordinator.hydrate(cache)

    coordinator.request(requests)

    expect(client.calls).toHaveLength(1)
    expect(coordinator.getState().routes.size).toBe(1)
    expect(coordinator.getState().routes.has(2)).toBe(false)
    client.calls[0].resolve(response([cableRoute(1, 0)], []))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))
    expect(coordinator.getState().routes.size).toBe(1)
    expect(coordinator.getState().routes.has(2)).toBe(false)
  })

  it('degrades only the failed connection without publishing a global error', async () => {
    const client = new FakeClient()
    const coordinator = new CableRoutingCoordinator(client as unknown as DomainEngineClient)
    coordinator.request([request(1), request(2, 24)])
    client.calls[0].resolve(response(
      [cableRoute(1, 0)],
      [1, 2],
      [{ connection_id: 2, message: 'No bounded orthogonal route was found.' }],
    ))

    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState().routes.size).toBe(1)
    expect(coordinator.getState().routes.has(2)).toBe(false)
    expect(coordinator.getState().error).toBeNull()
    expect(coordinator.getState().warnings.get(2)).toContain('No bounded')
  })

  it('persists a known failure when changed geometry has no safe route', async () => {
    const client = new FakeClient()
    const persisted: CableRoutingCacheSnapshot[] = []
    const persistCache = vi.fn(async (cache: CableRoutingCacheSnapshot) => {
      persisted.push(cache)
    })
    const coordinator = new CableRoutingCoordinator(
      client as unknown as DomainEngineClient,
      { persistCache },
    )
    const initialRequest = request(1)
    const initialCache = {
      version: ROUTING_CACHE_FORMAT_VERSION,
      plannerVersion: ROUTING_PLANNER_VERSION,
      geometryFingerprint: cableRoutingGeometryFingerprint([initialRequest]),
      obstacles: [],
      entries: [{
        input: {
          avoid_cable_overlap: false,
          request: {
            definition: {
              connection_id: 1,
              source: { x: 0, y: 0 },
              target: { x: 240, y: 0 },
              source_side: 'right' as const,
              target_side: 'left' as const,
              lane_offset: 24,
              manual_bends: [],
            },
            source_candidates: [{ point: { x: 0, y: 0 }, side: 'right' as const }],
            target_candidates: [{ point: { x: 240, y: 0 }, side: 'left' as const }],
            source_side_constraint: 'right' as const,
            target_side_constraint: 'left' as const,
            previous_source_side: null,
            previous_target_side: null,
            source_item_id: 'server:1',
            target_item_id: 'switch:1',
            obstacles: [],
            reserved_segments: [],
            snap_to_grid: false,
            grid_size: 12,
            previous_valid_route: null,
          },
        },
        result: cableRoute(1, 0),
      }],
      failures: [],
      updatedAt: '2026-07-30T00:00:00.000Z',
    }
    coordinator.hydrate(initialCache)
    coordinator.request([initialRequest])
    const movedRequest = request(1, 24)

    coordinator.request([movedRequest])
    client.calls[0].resolve(response(
      [],
      [1],
      [{ connection_id: 1, message: 'No bounded orthogonal route was found.' }],
    ))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState().routes.has(1)).toBe(false)
    expect(coordinator.getState().warnings.has(1)).toBe(true)
    expect(persistCache).toHaveBeenCalledOnce()
    expect(persisted[0]?.failures).toEqual([{
      connection_id: 1,
      message: 'No bounded orthogonal route was found.',
    }])
  })

  it('persists successful routes when another requested route fails', async () => {
    const client = new FakeClient()
    const persisted: CableRoutingCacheSnapshot[] = []
    const persistCache = vi.fn(async (cache: CableRoutingCacheSnapshot) => {
      persisted.push(cache)
    })
    const coordinator = new CableRoutingCoordinator(
      client as unknown as DomainEngineClient,
      { persistCache },
    )

    coordinator.request([request(1), request(2, 24)])
    client.calls[0].resolve(response(
      [cableRoute(1, 0)],
      [1, 2],
      [{ connection_id: 2, message: 'No bounded orthogonal route was found.' }],
    ))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(persistCache).toHaveBeenCalledOnce()
    expect(persisted[0]?.entries).toHaveLength(1)
    expect(persisted[0]?.entries[0]?.result.route.connection_id).toBe(1)
  })

  it('serializes one exclusive cache outcome when a returned route is also reported failed', async () => {
    const client = new FakeClient()
    const persisted: CableRoutingCacheSnapshot[] = []
    const coordinator = new CableRoutingCoordinator(
      client as unknown as DomainEngineClient,
      { persistCache: async (cache) => { persisted.push(cache) } },
    )

    coordinator.request([request(1)])
    client.calls[0].resolve(response(
      [cableRoute(1, 0)],
      [1],
      [{ connection_id: 1, message: 'No bounded orthogonal route was found.' }],
    ))
    await vi.waitFor(() => expect(coordinator.getState().pending).toBe(false))

    expect(coordinator.getState().warnings.has(1)).toBe(false)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.entries).toHaveLength(1)
    expect(persisted[0]?.failures).toEqual([])
  })
})

function exactCache(stableRequest: CableLaneRouteRequest): CableRoutingCacheSnapshot {
  return {
    version: ROUTING_CACHE_FORMAT_VERSION,
    plannerVersion: ROUTING_PLANNER_VERSION,
    geometryFingerprint: cableRoutingGeometryFingerprint([stableRequest]),
    obstacles: [],
    entries: [{
      input: {
        avoid_cable_overlap: false,
        request: {
          definition: {
            connection_id: stableRequest.connectionId,
            source: stableRequest.request.source,
            target: stableRequest.request.target,
            source_side: 'right',
            target_side: 'left',
            lane_offset: 24,
            manual_bends: [],
          },
          source_candidates: [{ point: stableRequest.request.source, side: 'right' }],
          target_candidates: [{ point: stableRequest.request.target, side: 'left' }],
          source_side_constraint: 'right',
          target_side_constraint: 'left',
          previous_source_side: null,
          previous_target_side: null,
          source_item_id: 'server:1',
          target_item_id: 'switch:1',
          obstacles: [],
          reserved_segments: [],
          snap_to_grid: false,
          grid_size: 12,
          previous_valid_route: null,
        },
      },
      result: cableRoute(stableRequest.connectionId, stableRequest.request.source.y),
    }],
    failures: [],
    updatedAt: '2026-08-05T00:00:00.000Z',
  }
}
