import { describe, expect, it } from 'vitest'
import { buildCanvasHandleIndex, getRequiredCanvasHandles } from '@/lib/canvas-handle-index'
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
  it('keeps only handles required by persisted cable routes', () => {
    const index = buildCanvasHandleIndex(project())

    expect([...getRequiredCanvasHandles(index, 'server:1')]).toEqual(['source-right-1:port'])
    expect([...getRequiredCanvasHandles(index, 'server:2')]).toEqual(['target-left-1:port'])
    expect(getRequiredCanvasHandles(index, 'server:3').size).toBe(0)
  })
})
