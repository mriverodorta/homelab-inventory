import { describe, expect, it } from 'vitest'
import {
  getAffectedCanvasItemIds,
  reconcileCanvasNodeProjectSnapshots,
} from '@/lib/canvas-node-dependencies'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function item(id: number, type: InventoryItem['type'], name: string): InventoryItem {
  return { id, type, name }
}

function project(): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Lab', version: 1, updatedAt: '2026-07-23T00:00:00.000Z' },
    items: {
      'server:1': item(1, 'server', 'Server One'),
      'server:2': item(2, 'server', 'Server Two'),
      'powerAdapter:1': item(1, 'powerAdapter', 'Adapter'),
      'switch:1': item(1, 'switch', 'Switch'),
    },
    placements: [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'server:2', x: 400, y: 0 },
      { serverId: 'switch:1', x: 0, y: 400 },
    ],
    assignments: [],
    connections: [],
  }
}

describe('canvas node dependencies', () => {
  it('invalidates only the assigned component and destination host', () => {
    const before = project()
    const after = {
      ...before,
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'powerAdapter:1',
        type: 'powerAdapter' as const,
        assignedAt: '2026-07-23T00:01:00.000Z',
      }],
    }

    expect(getAffectedCanvasItemIds(before, after)).toEqual(
      new Set(['server:1', 'powerAdapter:1']),
    )
  })

  it('invalidates the source and destination when an assignment moves', () => {
    const base = project()
    const before = {
      ...base,
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'powerAdapter:1',
        type: 'powerAdapter' as const,
        assignedAt: '2026-07-23T00:01:00.000Z',
      }],
    }
    const after = {
      ...before,
      assignments: [{ ...before.assignments[0], serverId: 'server:2' }],
    }

    expect(getAffectedCanvasItemIds(before, after)).toEqual(
      new Set(['server:1', 'server:2', 'powerAdapter:1']),
    )
  })

  it('invalidates an edited item and its assigned host', () => {
    const base = project()
    const before = {
      ...base,
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'powerAdapter:1',
        type: 'powerAdapter' as const,
        assignedAt: '2026-07-23T00:01:00.000Z',
      }],
    }
    const after = {
      ...before,
      items: {
        ...before.items,
        'powerAdapter:1': { ...before.items['powerAdapter:1'], name: 'Updated Adapter' },
      },
    }

    expect(getAffectedCanvasItemIds(before, after)).toEqual(
      new Set(['powerAdapter:1', 'server:1']),
    )
  })

  it('invalidates direct and hosted connection endpoint owners', () => {
    const before = project()
    const after = {
      ...before,
      connections: [{
        id: 1,
        type: 'power' as const,
        createdAt: '2026-07-23T00:02:00.000Z',
        from: { itemId: 'server:1', hostedItemId: 'powerAdapter:1', portId: 1 },
        to: { itemId: 'switch:1', portId: 1 },
      }],
    }

    expect(getAffectedCanvasItemIds(before, after)).toEqual(
      new Set(['server:1', 'powerAdapter:1', 'switch:1']),
    )
  })

  it('ignores route bends and placement coordinates but tracks route sides and membership', () => {
    const base = project()
    const before = {
      ...base,
      connections: [{
        id: 1,
        type: 'network' as const,
        createdAt: '2026-07-23T00:02:00.000Z',
        from: { itemId: 'server:1', portId: 1 },
        to: { itemId: 'switch:1', portId: 1 },
        route: { bendPoints: [{ x: 24, y: 48 }] },
      }],
    }
    const routeAndPlacementMoved = {
      ...before,
      placements: before.placements.map((placement) => (
        placement.serverId === 'server:1' ? { ...placement, x: 24 } : placement
      )),
      connections: [{
        ...before.connections[0],
        route: { bendPoints: [{ x: 72, y: 96 }], avoidCableOverlap: true },
      }],
    }
    const sideChanged = {
      ...routeAndPlacementMoved,
      connections: [{
        ...routeAndPlacementMoved.connections[0],
        route: { ...routeAndPlacementMoved.connections[0].route, sourceSide: 'top' as const },
      }],
    }
    const membershipChanged = {
      ...before,
      placements: before.placements.filter((placement) => placement.serverId !== 'server:2'),
    }

    expect(getAffectedCanvasItemIds(before, routeAndPlacementMoved)).toEqual(new Set())
    expect(getAffectedCanvasItemIds(routeAndPlacementMoved, sideChanged)).toEqual(
      new Set(['server:1', 'switch:1']),
    )
    expect(getAffectedCanvasItemIds(before, membershipChanged)).toEqual(new Set(['server:2']))
  })

  it('invalidates every placed card when compatibility policy changes', () => {
    const before = project()
    const after = {
      ...before,
      compatibilityPolicy: {
        disabledHosts: [{ hostType: 'server' as const, hostId: 1 }],
        ignoredWarningIds: [],
      },
    }

    expect(getAffectedCanvasItemIds(before, after)).toEqual(
      new Set(before.placements.map((placement) => placement.serverId)),
    )
  })

  it('retains snapshots for unrelated canvas items', () => {
    const before = project()
    const priorServerOne = { ...before, metadata: { ...before.metadata, name: 'Server One View' } }
    const priorServerTwo = { ...before, metadata: { ...before.metadata, name: 'Server Two View' } }
    const previousSnapshots = new Map([
      ['server:1', priorServerOne],
      ['server:2', priorServerTwo],
      ['switch:1', before],
    ])
    const after = {
      ...before,
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'powerAdapter:1',
        type: 'powerAdapter' as const,
        assignedAt: '2026-07-23T00:01:00.000Z',
      }],
    }

    const snapshots = reconcileCanvasNodeProjectSnapshots(before, after, previousSnapshots)

    expect(snapshots.get('server:1')).toBe(after)
    expect(snapshots.get('server:2')).toBe(priorServerTwo)
    expect(snapshots.get('switch:1')).toBe(before)
  })

  it('retains the snapshot map for metadata and coordinate-only changes', () => {
    const before = project()
    const previousSnapshots = new Map(
      before.placements.map((placement) => [placement.serverId, before]),
    )
    const after = {
      ...before,
      metadata: { ...before.metadata, updatedAt: '2026-07-23T00:03:00.000Z' },
      placements: before.placements.map((placement) => ({ ...placement, x: placement.x + 24 })),
    }

    expect(reconcileCanvasNodeProjectSnapshots(before, after, previousSnapshots)).toBe(
      previousSnapshots,
    )
  })
})
