import { describe, expect, it } from 'vitest'
import {
  buildCanvasProjectIndex,
  canvasEndpointAvailable,
  canvasEndpointConnected,
  canvasEndpointsCompatible,
} from '@/lib/canvas-project-index'
import type { InventoryItem, ProjectState } from '@/types/inventory'

const server: InventoryItem = {
  id: 1,
  key: 'server:1',
  type: 'server',
  name: 'Server',
  ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G' }],
}

const networkCard: InventoryItem = {
  id: 1,
  key: 'network:1',
  type: 'network',
  name: 'Network card',
  ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '2.5G' }],
}

const switchItem: InventoryItem = {
  id: 1,
  key: 'switch:1',
  type: 'switch',
  name: 'Switch',
  ports: [
    { id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '2.5G' },
    { id: 2, kind: 'switch-port', type: 'sfp-plus', slotNumber: 2, speed: '10G' },
  ],
}

function project(): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Index test', version: 1, updatedAt: '2026-07-21T00:00:00.000Z' },
    items: {
      'server:1': server,
      'network:1': networkCard,
      'switch:1': switchItem,
    },
    placements: [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'switch:1', x: 480, y: 0 },
    ],
    assignments: [{
      id: 1,
      serverId: 'server:1',
      itemId: 'network:1',
      type: 'network',
      assignedAt: '2026-07-21T00:00:00.000Z',
    }],
    connections: [{
      id: 1,
      type: 'network',
      from: { itemId: 'server:1', hostedItemId: 'network:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 1 },
      createdAt: '2026-07-21T00:00:00.000Z',
    }],
  }
}

describe('canvas project index', () => {
  it('indexes assigned hosts, hosted ports, and connection occupancy once', () => {
    const index = buildCanvasProjectIndex(project())
    const hostedEndpoint = { itemId: 'server:1', hostedItemId: 'network:1', portId: 1 }

    expect(index.assignedHostByItemId.get('network:1')).toBe('server:1')
    expect(canvasEndpointConnected(index, hostedEndpoint)).toBe(true)
    expect(canvasEndpointAvailable(index, hostedEndpoint)).toBe(false)
  })

  it('checks compatibility from indexed port metadata', () => {
    const index = buildCanvasProjectIndex(project())

    expect(canvasEndpointsCompatible(
      index,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'switch:1', portId: 1 },
    )).toBe(true)
    expect(canvasEndpointsCompatible(
      index,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'switch:1', portId: 2 },
    )).toBe(false)
  })
})
