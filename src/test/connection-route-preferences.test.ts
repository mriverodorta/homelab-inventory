import { describe, expect, it } from 'vitest'
import {
  clearAllManualConnectionBends,
  countConnectionsWithManualBends,
  countConnectionsWithManualRouteGeometry,
  restoreAllAutomaticConnectionRoutes,
} from '@/lib/connection-route-preferences'
import {
  createEmptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from '@/lib/history'
import type { InventoryConnection, ProjectState } from '@/types/inventory'

function connection(id: number, route?: InventoryConnection['route']): InventoryConnection {
  return {
    id,
    type: 'network',
    createdAt: '2026-07-29T00:00:00.000Z',
    from: { itemId: `server:${id}`, portId: 1 },
    to: { itemId: 'switch:1', portId: id },
    route,
  }
}

function project(connections: InventoryConnection[]): ProjectState {
  return {
    id: 'default',
    revision: 8,
    metadata: { name: 'Routes', version: 1, updatedAt: '2026-07-29T00:00:00.000Z' },
    items: {},
    placements: [],
    assignments: [],
    connections,
  }
}

describe('connection route preferences', () => {
  it('clears every manual bend while preserving route sides and collision preferences', () => {
    const current = project([
      connection(1, {
        sourceSide: 'top',
        targetSide: 'bottom',
        bendPoints: [{ x: 12, y: 24 }],
        avoidCableOverlap: true,
      }),
      connection(2, { bendPoints: [{ x: 48, y: 72 }] }),
      connection(3, { sourceSide: 'left' }),
    ])

    expect(countConnectionsWithManualBends(current)).toBe(2)
    const cleared = clearAllManualConnectionBends(current)

    expect(cleared.connections[0].route).toEqual({
      sourceSide: 'top',
      targetSide: 'bottom',
      avoidCableOverlap: true,
    })
    expect(cleared.connections[1].route).toBeUndefined()
    expect(cleared.connections[2]).toBe(current.connections[2])
    expect(countConnectionsWithManualBends(cleared)).toBe(0)
  })

  it('returns the original project when no manual bends exist', () => {
    const current = project([connection(1, { avoidCableOverlap: true })])

    expect(clearAllManualConnectionBends(current)).toBe(current)
  })

  it('restores all cleared bends with one undo and removes them again with one redo', () => {
    const current = project([
      connection(1, { bendPoints: [{ x: 12, y: 24 }] }),
      connection(2, { bendPoints: [{ x: 48, y: 72 }] }),
    ])
    const cleared = clearAllManualConnectionBends(current)
    const history = pushHistory(createEmptyHistory<ProjectState>(), current)
    const undone = undoHistory(history, cleared)
    const redone = undone ? redoHistory(undone.history, undone.project) : null

    expect(undone?.project.connections.map((item) => item.route?.bendPoints)).toEqual([
      [{ x: 12, y: 24 }],
      [{ x: 48, y: 72 }],
    ])
    expect(redone?.project.connections.every((item) => item.route === undefined)).toBe(true)
  })

  it('restores automatic sides and bends while preserving collision preferences', () => {
    const current = project([
      connection(1, {
        sourceSide: 'top',
        targetSide: 'bottom',
        bendPoints: [{ x: 12, y: 24 }],
        avoidCableOverlap: true,
      }),
      connection(2, { targetSide: 'left' }),
      connection(3, { avoidCableOverlap: true }),
    ])

    expect(countConnectionsWithManualRouteGeometry(current)).toBe(2)
    const restored = restoreAllAutomaticConnectionRoutes(current)

    expect(restored.connections[0].route).toEqual({ avoidCableOverlap: true })
    expect(restored.connections[1].route).toBeUndefined()
    expect(restored.connections[2]).toBe(current.connections[2])
    expect(countConnectionsWithManualRouteGeometry(restored)).toBe(0)
  })
})
