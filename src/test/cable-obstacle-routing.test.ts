import { describe, expect, it } from 'vitest'
import {
  buildCableObstacles,
  getReservableCableSegments,
  routeCableAroundObstacles,
  segmentCrossesObstacleInterior,
  segmentsHaveCollinearConflict,
} from '@/lib/cable-obstacle-routing'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function expectOrthogonal(points: Array<{ x: number; y: number }>) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const first = points[index]
    const second = points[index + 1]
    expect(first.x === second.x || first.y === second.y).toBe(true)
  }
}

function routeLength(points: Array<{ x: number; y: number }>): number {
  return points.slice(0, -1).reduce((total, point, index) => {
    const next = points[index + 1]
    return total + Math.abs(next.x - point.x) + Math.abs(next.y - point.y)
  }, 0)
}

function projectWith(items: InventoryItem[]): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Routing', version: 1, updatedAt: '2026-07-22T00:00:00.000Z' },
    items: Object.fromEntries(items.map((item) => [item.key!, item])),
    placements: items.map((item, index) => ({
      serverId: item.key!,
      x: index * 360,
      y: 120,
    })),
    assignments: [],
    connections: [],
  }
}

describe('cable obstacle routing', () => {
  it('reserves only middle cable segments and excludes endpoint portal stubs', () => {
    const points = [
      { x: 0, y: 24 },
      { x: 12, y: 24 },
      { x: 12, y: 72 },
      { x: 180, y: 72 },
      { x: 180, y: 120 },
      { x: 192, y: 120 },
    ]

    expect(getReservableCableSegments(points)).toEqual([
      { start: points[1], end: points[2] },
      { start: points[2], end: points[3] },
      { start: points[3], end: points[4] },
    ])
  })

  it('detects nearby collinear overlap but allows crossings and point contact', () => {
    const horizontal = { start: { x: 0, y: 24 }, end: { x: 120, y: 24 } }

    expect(segmentsHaveCollinearConflict(
      horizontal,
      { start: { x: 48, y: 24 }, end: { x: 168, y: 24 } },
    )).toBe(true)
    expect(segmentsHaveCollinearConflict(
      horizontal,
      { start: { x: 48, y: 30 }, end: { x: 168, y: 30 } },
    )).toBe(true)
    expect(segmentsHaveCollinearConflict(
      horizontal,
      { start: { x: 48, y: 36 }, end: { x: 168, y: 36 } },
    )).toBe(false)
    expect(segmentsHaveCollinearConflict(
      horizontal,
      { start: { x: 60, y: 0 }, end: { x: 60, y: 72 } },
    )).toBe(false)
    expect(segmentsHaveCollinearConflict(
      horizontal,
      { start: { x: 120, y: 24 }, end: { x: 180, y: 24 } },
    )).toBe(false)
  })

  it('moves an automatic middle segment to the nearest free cable lane', () => {
    const result = routeCableAroundObstacles({
      source: { x: 0, y: 24 },
      target: { x: 240, y: 24 },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
      obstacles: [],
      reservedSegments: [
        { start: { x: 24, y: 24 }, end: { x: 216, y: 24 } },
      ],
      sourceItemId: 'server:1',
      targetItemId: 'switch:1',
      snapToGrid: true,
    })

    const middleSegments = getReservableCableSegments(result.points)
    expect(result.usedFallback).toBe(false)
    expect(middleSegments.some((segment) => (
      segment.start.y === segment.end.y && Math.abs(segment.start.y - 24) === 12
    ))).toBe(true)
    expect(middleSegments.every((segment) => !segmentsHaveCollinearConflict(
      segment,
      { start: { x: 24, y: 24 }, end: { x: 216, y: 24 } },
    ))).toBe(true)
  })

  it('builds project obstacles with twelve pixels of clearance', () => {
    const server: InventoryItem = { id: 1, key: 'server:1', type: 'server', name: 'Server' }
    const obstacle = buildCableObstacles(projectWith([server]))[0]

    expect(obstacle).toMatchObject({
      itemId: 'server:1',
      left: -12,
      top: 108,
      right: 294,
    })
    expect(obstacle.bottom).toBeGreaterThan(120)
  })

  it('uses measured canvas dimensions instead of estimates when available', () => {
    const server: InventoryItem = { id: 1, key: 'server:1', type: 'server', name: 'Server' }
    const measuredSizes = new Map([['server:1', { width: 340, height: 460 }]])
    const obstacle = buildCableObstacles(projectWith([server]), 12, measuredSizes)[0]

    expect(obstacle).toMatchObject({
      left: -12,
      top: 108,
      right: 352,
      bottom: 592,
    })
  })

  it('uses a short orthogonal detour around unrelated equipment', () => {
    const obstacle = { itemId: 'switch:1', left: 84, top: 12, right: 216, bottom: 132 }
    const result = routeCableAroundObstacles({
      source: { x: 0, y: 72 },
      target: { x: 300, y: 72 },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
      obstacles: [obstacle],
      sourceItemId: 'server:1',
      targetItemId: 'patchPanel:1',
      snapToGrid: true,
    })

    expectOrthogonal(result.points)
    expect(result.usedFallback).toBe(false)
    for (let index = 0; index < result.points.length - 1; index += 1) {
      expect(segmentCrossesObstacleInterior(result.points[index], result.points[index + 1], obstacle)).toBe(false)
    }
    expect(result.points.some((point) => point.y === 12 || point.y === 132)).toBe(true)
  })

  it('uses configured endpoint-side portals without routing beneath endpoint items', () => {
    const sourceObstacle = { itemId: 'server:1', left: -12, top: -12, right: 112, bottom: 112 }
    const targetObstacle = { itemId: 'powerStrip:1', left: 288, top: 188, right: 412, bottom: 312 }
    const result = routeCableAroundObstacles({
      source: { x: 100, y: 50 },
      target: { x: 350, y: 300 },
      sourceSide: 'right',
      targetSide: 'bottom',
      laneOffset: 24,
      obstacles: [
        sourceObstacle,
        targetObstacle,
      ],
      sourceItemId: 'server:1',
      targetItemId: 'powerStrip:1',
      snapToGrid: false,
    })

    expect(result.usedFallback).toBe(false)
    expectOrthogonal(result.points)
    expect(result.points[1]).toEqual({ x: 112, y: 50 })
    expect(result.points.at(-2)).toEqual({ x: 350, y: 312 })
    expect(result.points).toContainEqual({ x: 288, y: 312 })

    const middleSegments = result.points.slice(1, -1)
    for (let index = 0; index < middleSegments.length - 1; index += 1) {
      expect(segmentCrossesObstacleInterior(middleSegments[index], middleSegments[index + 1], sourceObstacle)).toBe(false)
      expect(segmentCrossesObstacleInterior(middleSegments[index], middleSegments[index + 1], targetObstacle)).toBe(false)
    }
  })

  it('snaps endpoint portals outward to the next clear twelve-pixel lane', () => {
    const result = routeCableAroundObstacles({
      source: { x: 100, y: 50 },
      target: { x: 350, y: 300 },
      sourceSide: 'right',
      targetSide: 'bottom',
      laneOffset: 24,
      obstacles: [
        { itemId: 'server:1', left: -11, top: -11, right: 113, bottom: 113 },
        { itemId: 'powerStrip:1', left: 287, top: 187, right: 413, bottom: 313 },
      ],
      sourceItemId: 'server:1',
      targetItemId: 'powerStrip:1',
      snapToGrid: true,
    })

    expect(result.points[1]).toEqual({ x: 120, y: 50 })
    expect(result.points.at(-2)).toEqual({ x: 350, y: 324 })
  })

  it('prefers the shortest staggered route before comparing bend count', () => {
    const result = routeCableAroundObstacles({
      source: { x: 0, y: 100 },
      target: { x: 400, y: 100 },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
      obstacles: [
        { itemId: 'server:2', left: 100, top: 60, right: 180, bottom: 200 },
        { itemId: 'server:3', left: 220, top: 0, right: 300, bottom: 140 },
      ],
      sourceItemId: 'server:1',
      targetItemId: 'powerStrip:1',
      snapToGrid: false,
    })

    expect(result.usedFallback).toBe(false)
    expect(routeLength(result.points)).toBe(560)
    expect(result.points.some((point) => point.y === 60)).toBe(true)
    expect(result.points.some((point) => point.y === 140)).toBe(true)
  })

  it('keeps free obstacle-edge coordinates when cable snapping is disabled', () => {
    const result = routeCableAroundObstacles({
      source: { x: 3, y: 65 },
      target: { x: 301, y: 65 },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
      obstacles: [{ itemId: 'nas:1', left: 89, top: 19, right: 197, bottom: 113 }],
      sourceItemId: 'server:1',
      targetItemId: 'switch:1',
      snapToGrid: false,
    })

    expect(result.points.some((point) => point.y === 19 || point.y === 113)).toBe(true)
  })

  it('routes through persisted manual anchors in order and reports their point indexes', () => {
    const anchors = [{ x: 72, y: 168 }, { x: 228, y: 168 }]
    const result = routeCableAroundObstacles({
      source: { x: 0, y: 72 },
      target: { x: 300, y: 72 },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
      obstacles: [{ itemId: 'switch:1', left: 84, top: 12, right: 216, bottom: 132 }],
      manualBendPoints: anchors,
      sourceItemId: 'server:1',
      targetItemId: 'patchPanel:1',
      snapToGrid: true,
    })

    expect(result.manualAnchorPointIndexes).toHaveLength(2)
    expect(result.manualAnchorPointIndexes[0]).toBeLessThan(result.manualAnchorPointIndexes[1])
    expect(result.points[result.manualAnchorPointIndexes[0]]).toEqual(anchors[0])
    expect(result.points[result.manualAnchorPointIndexes[1]]).toEqual(anchors[1])
  })

  it('temporarily projects a covered manual anchor without mutating its stored coordinate', () => {
    const anchor = { x: 144, y: 72 }
    const baseRequest = {
      source: { x: 0, y: 72 },
      target: { x: 300, y: 72 },
      sourceSide: 'right' as const,
      targetSide: 'left' as const,
      laneOffset: 24,
      manualBendPoints: [anchor],
      sourceItemId: 'server:1',
      targetItemId: 'switch:1',
      snapToGrid: true,
    }
    const covered = routeCableAroundObstacles({
      ...baseRequest,
      obstacles: [{ itemId: 'nas:1', left: 120, top: 48, right: 180, bottom: 96 }],
    })
    const restored = routeCableAroundObstacles({ ...baseRequest, obstacles: [] })

    expect(covered.points[covered.manualAnchorPointIndexes[0]]).not.toEqual(anchor)
    expect(restored.points[restored.manualAnchorPointIndexes[0]]).toEqual(anchor)
    expect(baseRequest.manualBendPoints).toEqual([anchor])
  })

  it('shortens an endpoint stub rather than entering a nearby obstacle', () => {
    const obstacle = { itemId: 'nas:1', left: 12, top: 48, right: 96, bottom: 96 }
    const result = routeCableAroundObstacles({
      source: { x: 0, y: 72 },
      target: { x: 240, y: 144 },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
      obstacles: [obstacle],
      sourceItemId: 'server:1',
      targetItemId: 'switch:1',
      snapToGrid: true,
    })

    expect(result.points[1]).toEqual({ x: 12, y: 72 })
    expect(segmentCrossesObstacleInterior(result.points[0], result.points[1], obstacle)).toBe(false)
  })

  it('invalidates a cached direct route when an obstacle moves into its corridor', () => {
    const request = {
      source: { x: 0, y: 72 },
      target: { x: 300, y: 72 },
      sourceSide: 'right' as const,
      targetSide: 'left' as const,
      laneOffset: 24,
      sourceItemId: 'server:1',
      targetItemId: 'switch:1',
      snapToGrid: false,
    }
    const direct = routeCableAroundObstacles({
      ...request,
      obstacles: [{ itemId: 'nas:1', left: 500, top: 500, right: 600, bottom: 600 }],
    })
    const blocked = routeCableAroundObstacles({
      ...request,
      obstacles: [{ itemId: 'nas:1', left: 120, top: 48, right: 180, bottom: 96 }],
    })

    expect(blocked.points).not.toEqual(direct.points)
    expect(blocked.points.some((point) => point.y === 48 || point.y === 96)).toBe(true)
  })
})
