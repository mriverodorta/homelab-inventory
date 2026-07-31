import { describe, expect, it } from 'vitest'
import {
  buildCanvasHandleIndex,
  getChangedCanvasHandleItemIds,
  getRequiredCanvasHandles,
} from '@/lib/canvas-handle-index'
import type { ProjectState } from '@/types/inventory'

function project(): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Handle test', version: 1, updatedAt: '2026-07-21T00:00:00.000Z' },
    items: {
      'server:1': { id: 1, key: 'server:1', type: 'server', name: 'Server A' },
      'server:2': { id: 2, key: 'server:2', type: 'server', name: 'Server B' },
      'server:3': { id: 3, key: 'server:3', type: 'server', name: 'Unconnected' },
    },
    placements: [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'server:2', x: 480, y: 0 },
      { serverId: 'server:3', x: 960, y: 0 },
    ],
    assignments: [],
    connections: [{
      id: 1,
      type: 'network',
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'server:2', portId: 1 },
      createdAt: '2026-07-21T00:00:00.000Z',
    }],
  }
}

describe('canvas handle index', () => {
  it('keeps all candidate sides for connected endpoints only', () => {
    const index = buildCanvasHandleIndex(project())

    expect([...getRequiredCanvasHandles(index, 'server:1')]).toEqual([
      'source-top-1:port',
      'source-right-1:port',
      'source-bottom-1:port',
      'source-left-1:port',
    ])
    expect([...getRequiredCanvasHandles(index, 'server:2')]).toEqual([
      'target-top-1:port',
      'target-right-1:port',
      'target-bottom-1:port',
      'target-left-1:port',
    ])
    expect(getRequiredCanvasHandles(index, 'server:3').size).toBe(0)
  })

  it('does not churn mounted handles when equipment movement changes the selected side', () => {
    const before = project()
    const beforeIndex = buildCanvasHandleIndex(before)
    const after = {
      ...before,
      placements: before.placements.map((placement) => (
        placement.serverId === 'server:2'
          ? { ...placement, x: 0, y: -480 }
          : placement
      )),
    }
    const afterIndex = buildCanvasHandleIndex(after)

    expect([...getRequiredCanvasHandles(afterIndex, 'server:1')]).toEqual([
      'source-top-1:port',
      'source-right-1:port',
      'source-bottom-1:port',
      'source-left-1:port',
    ])
    expect([...getRequiredCanvasHandles(afterIndex, 'server:2')]).toEqual([
      'target-top-1:port',
      'target-right-1:port',
      'target-bottom-1:port',
      'target-left-1:port',
    ])
    expect(getChangedCanvasHandleItemIds(beforeIndex, afterIndex)).toEqual(new Set())
  })

  it('does not invalidate handles when placement changes preserve cable sides', () => {
    const before = project()
    const after = {
      ...before,
      placements: before.placements.map((placement) => (
        placement.serverId === 'server:2'
          ? { ...placement, x: placement.x + 24 }
          : placement
      )),
    }

    expect(getChangedCanvasHandleItemIds(
      buildCanvasHandleIndex(before),
      buildCanvasHandleIndex(after),
    )).toEqual(new Set())
  })
})
