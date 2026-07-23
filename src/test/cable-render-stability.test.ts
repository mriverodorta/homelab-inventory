import { describe, expect, it } from 'vitest'
import {
  CANVAS_CABLE_Z_INDEX,
  CANVAS_NODE_ACTIVE_Z_INDEX,
  CANVAS_NODE_BASE_Z_INDEX,
  cableRouteResultsEqual,
  preserveCanvasNodeRuntimeState,
  reconcileItemsById,
} from '@/lib/cable-render-stability'

describe('cable render stability', () => {
  it('recognizes equal calculated routes and preserves equal item objects', () => {
    const route = {
      points: [{ x: 0, y: 0 }, { x: 24, y: 0 }],
      manualAnchorPointIndexes: [1],
      usedFallback: false,
    }
    expect(cableRouteResultsEqual(route, {
      points: route.points.map((point) => ({ ...point })),
      manualAnchorPointIndexes: [1],
      usedFallback: false,
    })).toBe(true)

    const first = { id: 'cable:1', value: 1 }
    const second = { id: 'cable:2', value: 2 }
    const reconciled = reconcileItemsById(
      [first, second],
      [{ id: 'cable:1', value: 1 }, { id: 'cable:2', value: 3 }],
      (current, next) => current.value === next.value,
    )

    expect(reconciled[0]).toBe(first)
    expect(reconciled[1]).not.toBe(second)

    const reordered = reconcileItemsById(
      [first, second],
      [{ ...second }, { ...first }],
      (current, next) => current.value === next.value,
    )
    expect(reordered).toEqual([second, first])
    expect(reordered).not.toEqual([first, second])
  })

  it('preserves measured and selected runtime state when presentation data changes', () => {
    const current = {
      id: 'server-node:server:1',
      measured: { width: 320, height: 240 },
      selected: true,
      data: { dimmed: false },
    }
    const next = {
      id: 'server-node:server:1',
      data: { dimmed: true },
    }

    expect(preserveCanvasNodeRuntimeState(current, next)).toEqual({
      ...next,
      measured: current.measured,
      selected: true,
    })
  })

  it('uses stable base layers while selection emphasis remains presentation-only', () => {
    expect(CANVAS_NODE_BASE_Z_INDEX).toBe(1)
    expect(CANVAS_NODE_ACTIVE_Z_INDEX).toBe(1000)
    expect(CANVAS_CABLE_Z_INDEX).toBe(8)
  })
})
