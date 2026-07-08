import { describe, expect, it } from 'vitest'
import {
  buildOrthogonalCablePoints,
  cablePointsToPath,
  getCableBendPoints,
  getEditableCableSegments,
  moveOrthogonalCableSegment,
  snapCableSegmentPointerToEndpoint,
} from '@/lib/orthogonal-cable'

function expectOrthogonal(points: Array<{ x: number; y: number }>) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index]
    const nextPoint = points[index + 1]

    expect(point.x === nextPoint.x || point.y === nextPoint.y).toBe(true)
  }
}

describe('orthogonal cable geometry', () => {
  it('builds default cable paths without diagonal segments', () => {
    const points = buildOrthogonalCablePoints({
      source: { x: 100, y: 200 },
      target: { x: 460, y: 80 },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
    })

    expectOrthogonal(points)
    expect(cablePointsToPath(points)).toBe('M 100,200 L 124,200 L 124,80 L 460,80')
  })

  it('normalizes old diagonal bend points into orthogonal segments', () => {
    const points = buildOrthogonalCablePoints({
      source: { x: 100, y: 200 },
      target: { x: 460, y: 80 },
      sourceSide: 'right',
      targetSide: 'left',
      laneOffset: 24,
      bendPoints: [{ x: 260, y: 150 }],
    })

    expectOrthogonal(points)
    expect(points).toEqual([
      { x: 100, y: 200 },
      { x: 100, y: 150 },
      { x: 260, y: 150 },
      { x: 260, y: 80 },
      { x: 460, y: 80 },
    ])
  })

  it('moves horizontal segments only along the vertical axis', () => {
    const points = [
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 80 },
      { x: 436, y: 80 },
      { x: 460, y: 80 },
    ]
    const movedPoints = moveOrthogonalCableSegment({
      points,
      segmentIndex: 3,
      pointer: { x: 999, y: 131 },
    })

    expectOrthogonal(movedPoints)
    expect(movedPoints).toEqual([
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 131 },
      { x: 460, y: 131 },
      { x: 460, y: 80 },
    ])
  })

  it('moves vertical segments only along the horizontal axis', () => {
    const points = [
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 80 },
      { x: 436, y: 80 },
      { x: 460, y: 80 },
    ]
    const movedPoints = moveOrthogonalCableSegment({
      points,
      segmentIndex: 1,
      pointer: { x: 331, y: 999 },
    })

    expectOrthogonal(movedPoints)
    expect(movedPoints).toEqual([
      { x: 100, y: 200 },
      { x: 331, y: 200 },
      { x: 331, y: 80 },
      { x: 460, y: 80 },
    ])
  })

  it('creates one handle per editable cable segment and stores only interior bends', () => {
    const points = [
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 80 },
      { x: 436, y: 80 },
      { x: 460, y: 80 },
    ]

    expect(getEditableCableSegments(points)).toHaveLength(4)
    expect(getCableBendPoints(points)).toEqual([
      { x: 124, y: 200 },
      { x: 124, y: 80 },
      { x: 436, y: 80 },
    ])
  })

  it('snaps endpoint-adjacent vertical segments to the endpoint center x', () => {
    const points = [
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 80 },
      { x: 460, y: 80 },
    ]

    expect(
      snapCableSegmentPointerToEndpoint({
        points,
        segmentIndex: 1,
        pointer: { x: 103, y: 90 },
        source: points[0],
        target: points.at(-1) ?? points[0],
        threshold: 8,
      }),
    ).toEqual({ x: 100, y: 90 })

    expect(
      snapCableSegmentPointerToEndpoint({
        points,
        segmentIndex: 1,
        pointer: { x: 116, y: 90 },
        source: points[0],
        target: points.at(-1) ?? points[0],
        threshold: 8,
      }),
    ).toEqual({ x: 116, y: 90 })
  })

  it('snaps manually bent vertical segments to the source endpoint center x', () => {
    const points = [
      { x: 100, y: 260 },
      { x: 130, y: 260 },
      { x: 130, y: 180 },
      { x: 160, y: 180 },
      { x: 160, y: 90 },
      { x: 460, y: 90 },
    ]

    expect(
      snapCableSegmentPointerToEndpoint({
        points,
        segmentIndex: 3,
        pointer: { x: 105, y: 140 },
        source: points[0],
        target: points.at(-1) ?? points[0],
        threshold: 8,
      }),
    ).toEqual({ x: 100, y: 140 })
  })

  it('snaps endpoint-adjacent horizontal segments to the endpoint center y', () => {
    const points = [
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 80 },
      { x: 460, y: 80 },
    ]

    expect(
      snapCableSegmentPointerToEndpoint({
        points,
        segmentIndex: 0,
        pointer: { x: 110, y: 194 },
        source: points[0],
        target: points.at(-1) ?? points[0],
        threshold: 8,
      }),
    ).toEqual({ x: 110, y: 200 })
  })
})
