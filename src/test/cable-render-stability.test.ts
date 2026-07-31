import { describe, expect, it } from 'vitest'
import {
  CANVAS_CABLE_Z_INDEX,
  CANVAS_NODE_ACTIVE_Z_INDEX,
  CANVAS_NODE_BASE_Z_INDEX,
  cableRouteMatchesEndpoints,
  cableRouteResultsEqual,
  preserveCanvasNodeRuntimeState,
  reconcileItemsById,
  selectStableCableRoute,
} from '@/lib/cable-render-stability'

describe('cable render stability', () => {
  it('recognizes equal calculated routes and preserves equal item objects', () => {
    const route = {
      points: [{ x: 0, y: 0 }, { x: 24, y: 0 }],
      sourceSide: 'right' as const,
      targetSide: 'left' as const,
      manualAnchorPointIndexes: [1],
      usedFallback: false,
    }
    expect(cableRouteResultsEqual(route, {
      points: route.points.map((point) => ({ ...point })),
      sourceSide: 'right',
      targetSide: 'left',
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

  it('recognizes whether a planned route matches mounted endpoint handles', () => {
    const route = {
      points: [{ x: 24, y: 48 }, { x: 120, y: 48 }],
      sourceSide: 'right' as const,
      targetSide: 'left' as const,
      manualAnchorPointIndexes: [],
      usedFallback: false,
    }

    expect(cableRouteMatchesEndpoints(route, { x: 24, y: 48 }, { x: 120, y: 48 })).toBe(true)
    expect(cableRouteMatchesEndpoints(undefined, { x: 24, y: 48 }, { x: 120, y: 48 })).toBe(false)
    expect(cableRouteMatchesEndpoints(route, null, { x: 120, y: 48 })).toBe(false)
    expect(cableRouteMatchesEndpoints(route, { x: 24, y: 48 }, { x: 132, y: 48 })).toBe(false)
  })

  it('keeps the previous route while a new plan targets stale endpoint geometry', () => {
    const previous = {
      points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      sourceSide: 'right' as const,
      targetSide: 'left' as const,
      manualAnchorPointIndexes: [],
      usedFallback: false,
    }
    const planned = {
      ...previous,
      points: [{ x: 12, y: 0 }, { x: 112, y: 100 }],
    }

    expect(selectStableCableRoute({
      planned,
      previous,
      source: { x: 0, y: 0 },
      target: { x: 100, y: 100 },
    })).toBe(previous)
  })

  it('uses a persisted plan on first render before handles finish measuring', () => {
    const planned = {
      points: [{ x: 12, y: 0 }, { x: 112, y: 100 }],
      sourceSide: 'right' as const,
      targetSide: 'left' as const,
      manualAnchorPointIndexes: [],
      usedFallback: false,
    }

    expect(selectStableCableRoute({
      planned,
      previous: undefined,
      source: null,
      target: null,
    })).toBe(planned)
  })

  it('promotes a current plan after it matches both measured endpoints', () => {
    const previous = {
      points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      sourceSide: 'right' as const,
      targetSide: 'left' as const,
      manualAnchorPointIndexes: [],
      usedFallback: false,
    }
    const planned = {
      ...previous,
      points: [{ x: 12, y: 0 }, { x: 112, y: 100 }],
    }

    expect(selectStableCableRoute({
      planned,
      previous,
      source: { x: 12, y: 0 },
      target: { x: 112, y: 100 },
    })).toBe(planned)
  })

  it('uses stable base layers while selection emphasis remains presentation-only', () => {
    expect(CANVAS_NODE_BASE_Z_INDEX).toBe(1)
    expect(CANVAS_NODE_ACTIVE_Z_INDEX).toBe(1000)
    expect(CANVAS_CABLE_Z_INDEX).toBe(8)
  })
})
