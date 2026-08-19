import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CableLaneRouteRequest } from '@/engine/routing'
import { useCableRoutingController } from '@/components/canvas/use-cable-routing-controller'

const mocks = vi.hoisted(() => {
  const transient = vi.fn(async (input: {
    operation: {
      payload: {
        plan: {
          requests: Array<{
            request: { definition: { connection_id: number } }
          }>
        }
      }
    }
  }) => ({
    protocol_version: 1 as const,
    request_id: 1,
    base_revision: 0,
    result: {
      kind: 'cable-routes-planned' as const,
      payload: {
        routes: input.operation.payload.plan.requests.map((request) => ({
          route: {
            connection_id: request.request.definition.connection_id,
            points: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
            manual_anchor_point_indexes: [],
          },
          source_side: 'right' as const,
          target_side: 'left' as const,
          used_fallback: false,
          warning: null,
        })),
        recalculated_connection_ids: input.operation.payload.plan.requests.map(
          (request) => request.request.definition.connection_id,
        ),
        deferred_connection_ids: [],
        failures: [],
        repairs: [],
      },
    },
  }))
  return {
    transient,
    domainEngine: {
      enabled: true,
      client: { transient },
      state: { phase: 'ready' as const },
    },
    loadRoutingCache: vi.fn(async () => null),
    saveRoutingCache: vi.fn(async () => undefined),
  }
})

vi.mock('@/hooks/use-domain-engine', () => ({
  useDomainEngine: () => mocks.domainEngine,
}))

vi.mock('@/lib/routing-cache-api', () => ({
  loadRoutingCache: mocks.loadRoutingCache,
  saveRoutingCache: mocks.saveRoutingCache,
}))

const routeRequest: CableLaneRouteRequest = {
  connectionId: 1,
  avoidCableOverlap: false,
  request: {
    source: { x: 0, y: 0 },
    target: { x: 120, y: 0 },
    sourceSide: 'right',
    targetSide: 'left',
    sourceCandidates: [{ point: { x: 0, y: 0 }, side: 'right' }],
    targetCandidates: [{ point: { x: 120, y: 0 }, side: 'left' }],
    laneOffset: 12,
    obstacles: [],
    sourceItemId: 'server:1',
    targetItemId: 'switch:1',
    snapToGrid: false,
  },
}

describe('useCableRoutingController', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does not clear the route cache for a transient empty geometry projection', async () => {
    vi.useFakeTimers()
    const options = {
      routeGeometryReady: true,
      onResolveConnectionRouteSides: vi.fn(async () => undefined),
      onCanonicalizeConnectionRoutes: vi.fn(async () => undefined),
    }
    const { rerender } = renderHook(
      ({ routeRequests }: { routeRequests: CableLaneRouteRequest[] }) => (
        useCableRoutingController({ ...options, routeRequests })
      ),
      { initialProps: { routeRequests: [] as CableLaneRouteRequest[] } },
    )

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    rerender({ routeRequests: [routeRequest] })
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(mocks.transient).toHaveBeenCalledOnce()
    expect(mocks.transient.mock.calls[0]?.[0]).toMatchObject({
      operation: {
        kind: 'plan-cable-routes',
        payload: {
          plan: {
            requests: [expect.objectContaining({
              request: expect.objectContaining({
                definition: expect.objectContaining({ connection_id: 1 }),
              }),
            })],
          },
        },
      },
    })
  })

  it('clears routes after an empty projection remains stable', async () => {
    vi.useFakeTimers()
    const options = {
      routeGeometryReady: true,
      onResolveConnectionRouteSides: vi.fn(async () => undefined),
      onCanonicalizeConnectionRoutes: vi.fn(async () => undefined),
    }
    const { rerender } = renderHook(
      ({ routeRequests }: { routeRequests: CableLaneRouteRequest[] }) => (
        useCableRoutingController({ ...options, routeRequests })
      ),
      { initialProps: { routeRequests: [routeRequest] } },
    )

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    mocks.transient.mockClear()
    rerender({ routeRequests: [] })
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })

    expect(mocks.transient).toHaveBeenCalledOnce()
    expect(mocks.transient.mock.calls[0]?.[0]).toMatchObject({
      operation: {
        kind: 'plan-cable-routes',
        payload: { plan: { requests: [] } },
      },
    })
  })
})
