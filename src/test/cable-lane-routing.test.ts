import { describe, expect, it } from 'vitest'
import {
  getReservableCableSegments,
  segmentsHaveCollinearConflict,
  type CableRouteRequest,
} from '@/lib/cable-obstacle-routing'
import {
  routeCablesWithLaneReservations,
  shouldAvoidCableOverlap,
} from '@/lib/cable-lane-routing'

function request(y = 24): CableRouteRequest {
  return {
    source: { x: 0, y },
    target: { x: 240, y },
    sourceSide: 'right',
    targetSide: 'left',
    laneOffset: 24,
    obstacles: [],
    sourceItemId: 'server:1',
    targetItemId: 'switch:1',
    snapToGrid: true,
  }
}

function routesConflict(first: readonly { x: number; y: number }[], second: readonly { x: number; y: number }[]): boolean {
  return getReservableCableSegments(first).some((firstSegment) => (
    getReservableCableSegments(second).some((secondSegment) => (
      segmentsHaveCollinearConflict(firstSegment, secondSegment)
    ))
  ))
}

describe('cable lane batch routing', () => {
  it('uses the global override without changing individual preference semantics', () => {
    expect(shouldAvoidCableOverlap(false, undefined)).toBe(false)
    expect(shouldAvoidCableOverlap(false, true)).toBe(true)
    expect(shouldAvoidCableOverlap(true, false)).toBe(true)
  })

  it('routes an enabled cable around an overlapping disabled cable', () => {
    const routes = routeCablesWithLaneReservations([
      { connectionId: 1, avoidCableOverlap: false, request: request() },
      { connectionId: 2, avoidCableOverlap: true, request: request() },
    ])

    expect(routesConflict(routes.get(1)!.points, routes.get(2)!.points)).toBe(false)
    expect(routes.get(1)!.points).not.toEqual(routes.get(2)!.points)
  })

  it('separates multiple enabled cables in numeric connection order', () => {
    const routes = routeCablesWithLaneReservations([
      { connectionId: 3, avoidCableOverlap: true, request: request() },
      { connectionId: 1, avoidCableOverlap: true, request: request() },
      { connectionId: 2, avoidCableOverlap: true, request: request() },
    ])

    expect(routes.get(1)!.points).not.toEqual(routes.get(2)!.points)
    expect(routes.get(2)!.points).not.toEqual(routes.get(3)!.points)
    expect(routesConflict(routes.get(1)!.points, routes.get(2)!.points)).toBe(false)
    expect(routesConflict(routes.get(1)!.points, routes.get(3)!.points)).toBe(false)
    expect(routesConflict(routes.get(2)!.points, routes.get(3)!.points)).toBe(false)
  })

  it('produces the same routes regardless of request array order', () => {
    const ascending = routeCablesWithLaneReservations([
      { connectionId: 1, avoidCableOverlap: true, request: request() },
      { connectionId: 2, avoidCableOverlap: true, request: request() },
    ])
    const descending = routeCablesWithLaneReservations([
      { connectionId: 2, avoidCableOverlap: true, request: request() },
      { connectionId: 1, avoidCableOverlap: true, request: request() },
    ])

    expect(descending.get(1)).toEqual(ascending.get(1))
    expect(descending.get(2)).toEqual(ascending.get(2))
  })

  it('does not force a perpendicular crossing onto another lane', () => {
    const routes = routeCablesWithLaneReservations([
      { connectionId: 1, avoidCableOverlap: false, request: request(72) },
      {
        connectionId: 2,
        avoidCableOverlap: true,
        request: {
          ...request(),
          source: { x: 120, y: 0 },
          target: { x: 120, y: 144 },
          sourceSide: 'bottom',
          targetSide: 'top',
        },
      },
    ])

    expect(routes.get(2)!.usedFallback).toBe(false)
    expect(routes.get(2)!.points.some((point) => point.x === 120)).toBe(true)
  })

  it('allows shared endpoint stubs while separating the middle route', () => {
    const routes = routeCablesWithLaneReservations([
      { connectionId: 1, avoidCableOverlap: true, request: request() },
      { connectionId: 2, avoidCableOverlap: true, request: request() },
    ])
    const first = routes.get(1)!.points
    const second = routes.get(2)!.points

    expect(second[0]).toEqual(first[0])
    expect(second[1]).toEqual(first[1])
    expect(routesConflict(first, second)).toBe(false)
  })

  it('keeps persisted manual anchors authoritative while avoiding another route', () => {
    const manualBendPoints = [{ x: 72, y: 168 }, { x: 228, y: 168 }]
    const routes = routeCablesWithLaneReservations([
      { connectionId: 1, avoidCableOverlap: false, request: request(72) },
      {
        connectionId: 2,
        avoidCableOverlap: true,
        request: {
          ...request(72),
          manualBendPoints,
        },
      },
    ])
    const manualRoute = routes.get(2)!

    expect(manualRoute.points).toContainEqual(manualBendPoints[0])
    expect(manualRoute.points).toContainEqual(manualBendPoints[1])
    expect(routesConflict(routes.get(1)!.points, manualRoute.points)).toBe(false)
  })
})
