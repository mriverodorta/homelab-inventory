import { describe, expect, it } from 'vitest'
import {
  cablePointsToPath,
  getEditableCableSegments,
} from '@/lib/orthogonal-cable'

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
      { index: 3, orientation: 'horizontal', midpoint: { x: 112, y: 120 } },
    ])
  })
})
