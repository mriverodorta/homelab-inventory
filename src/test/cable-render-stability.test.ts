import { describe, expect, it } from 'vitest'
import {
  CANVAS_CABLE_Z_INDEX,
  CANVAS_NODE_ACTIVE_Z_INDEX,
  CANVAS_NODE_BASE_Z_INDEX,
  cableRouteResultsEqual,
  preserveCanvasNodeRuntimeState,
  projectsEqualForCanvasNodes,
  reconcileItemsById,
} from '@/lib/cable-render-stability'
import type { ProjectState } from '@/types/inventory'

function project(): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Lab', version: 1, updatedAt: '2026-07-22T00:00:00.000Z' },
    items: {},
    placements: [],
    assignments: [],
    connections: [{
      id: 1,
      type: 'network',
      createdAt: '2026-07-22T00:00:00.000Z',
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 1 },
      route: {
        sourceSide: 'right',
        targetSide: 'left',
        bendPoints: [{ x: 120, y: 96 }],
      },
    }],
  }
}

describe('cable render stability', () => {
  it('treats bend and overlap changes as irrelevant to canvas nodes', () => {
    const first = project()
    const second = {
      ...first,
      metadata: { ...first.metadata, updatedAt: '2026-07-22T00:01:00.000Z' },
      connections: [{
        ...first.connections[0],
        route: {
          ...first.connections[0].route,
          bendPoints: undefined,
          avoidCableOverlap: true,
        },
      }],
    }

    expect(projectsEqualForCanvasNodes(first, second)).toBe(true)
  })

  it('invalidates canvas nodes when a route side or endpoint changes', () => {
    const first = project()
    const sideChanged = {
      ...first,
      connections: [{
        ...first.connections[0],
        route: { ...first.connections[0].route, sourceSide: 'top' as const },
      }],
    }
    const endpointChanged = {
      ...first,
      connections: [{
        ...first.connections[0],
        to: { ...first.connections[0].to, portId: 2 },
      }],
    }

    expect(projectsEqualForCanvasNodes(first, sideChanged)).toBe(false)
    expect(projectsEqualForCanvasNodes(first, endpointChanged)).toBe(false)
  })

  it('keeps canvas node content stable when only placement coordinates change', () => {
    const first = {
      ...project(),
      placements: [{ serverId: 'server:1', x: 120, y: 240 }],
    }
    const moved = {
      ...first,
      placements: [{ serverId: 'server:1', x: 108, y: 240 }],
    }
    const membershipChanged = {
      ...first,
      placements: [...first.placements, { serverId: 'switch:1', x: 480, y: 120 }],
    }

    expect(projectsEqualForCanvasNodes(first, moved)).toBe(true)
    expect(projectsEqualForCanvasNodes(first, membershipChanged)).toBe(false)
  })

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
