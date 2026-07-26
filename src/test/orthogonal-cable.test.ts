import { describe, expect, it } from 'vitest'
import {
  cablePointsToPath,
  createOrthogonalFallbackRoute,
  getEditableCableSegments,
} from '@/lib/orthogonal-cable'

function expectNoImmediateBacktracking(points: Array<{ x: number; y: number }>) {
  for (let index = 0; index < points.length - 2; index += 1) {
    const first = points[index]
    const middle = points[index + 1]
    const last = points[index + 2]
    if (first.x === middle.x && middle.x === last.x) {
      expect(middle.y).toBeGreaterThanOrEqual(Math.min(first.y, last.y))
      expect(middle.y).toBeLessThanOrEqual(Math.max(first.y, last.y))
    }
    if (first.y === middle.y && middle.y === last.y) {
      expect(middle.x).toBeGreaterThanOrEqual(Math.min(first.x, last.x))
      expect(middle.x).toBeLessThanOrEqual(Math.max(first.x, last.x))
    }
  }
}

describe('orthogonal cable rendering', () => {
  it('turns engine points into an SVG path without changing them', () => {
    const points = [
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 80 },
      { x: 460, y: 80 },
    ]
    expect(cablePointsToPath(points)).toBe('M 100,200 L 124,200 L 124,80 L 460,80')
    expect(points).toEqual([
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 80 },
      { x: 460, y: 80 },
    ])
  })

  it('exposes only non-trivial orthogonal segments as interaction paths', () => {
    expect(getEditableCableSegments([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 120 },
      { x: 200, y: 120 },
    ])).toEqual([
      { index: 2, orientation: 'vertical', midpoint: { x: 24, y: 60 } },
    ])
  })

  it('keeps source and target connector trunks fixed', () => {
    expect(getEditableCableSegments([
      { x: 0, y: 0 },
      { x: 0, y: 120 },
      { x: 200, y: 120 },
      { x: 200, y: 260 },
    ])).toEqual([
      { index: 1, orientation: 'horizontal', midpoint: { x: 100, y: 120 } },
    ])
  })

  it.each([
    ['top', 'bottom'],
    ['bottom', 'top'],
    ['left', 'right'],
    ['right', 'left'],
  ] as const)('does not backtrack in the %s to %s fallback', (sourceSide, targetSide) => {
    const route = createOrthogonalFallbackRoute(
      { x: 100, y: 200 },
      { x: 460, y: 320 },
      sourceSide,
      targetSide,
    )

    expectNoImmediateBacktracking(route.points)
    expect(route.points.slice(0, -1).every((point, index) => {
      const next = route.points[index + 1]
      return point.x === next.x || point.y === next.y
    })).toBe(true)
  })
})
