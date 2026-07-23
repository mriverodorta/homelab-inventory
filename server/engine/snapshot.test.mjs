import { describe, expect, it } from 'vitest'
import { createEngineSnapshot } from './snapshot.mjs'

function project() {
  return {
    revision: 8,
    metadata: { name: 'Topology Test' },
    items: {
      'server:1': {
        id: 1,
        type: 'server',
        name: 'Host',
        specs: { powerConfiguration: 'external-adapter' },
        ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G' }],
      },
      'network:1': {
        id: 1,
        type: 'network',
        name: 'NIC',
        ports: [{ id: 4, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '2.5G' }],
      },
      'patchPanel:1': {
        id: 1,
        type: 'patchPanel',
        name: 'Panel',
        ports: [{
          id: 9,
          kind: 'keystone',
          type: 'rj45',
          slotNumber: 9,
          endpoints: [{ id: 1, side: 'front' }, { id: 2, side: 'back' }],
        }],
      },
    },
    assignments: [{
      id: 1,
      serverId: 'server:1',
      itemId: 'network:1',
      type: 'network',
      assignedAt: '2026-07-23T00:00:00.000Z',
      allocation: { resourceType: 'expansion', groupId: 1, positions: [0] },
    }],
    placements: [{ serverId: 'server:1', x: 0, y: 0 }],
    connections: [{
      id: 3,
      from: { itemId: 'server:1', hostedItemId: 'network:1', portId: 4 },
      to: { itemId: 'patchPanel:1', portId: 9, endpointId: 2 },
      type: 'network',
      negotiatedSpeedMbps: 2500,
      createdAt: '2026-01-01T00:00:00.000Z',
      route: {
        sourceSide: 'right',
        targetSide: 'bottom',
        bendPoints: [{ x: 12, y: 24 }],
        avoidCableOverlap: true,
      },
    }],
  }
}

describe('engine topology snapshot', () => {
  it('projects runtime keys into category-scoped numeric relationships', () => {
    const snapshot = createEngineSnapshot(project())

    expect(snapshot).toMatchObject({
      revision: 8,
      project_name: 'Topology Test',
      topology: {
        assignments: [{
          id: 1,
          host: { item_type: 'server', id: 1 },
          item: { item_type: 'network', id: 1 },
          component_type: 'network',
          assigned_at: '2026-07-23T00:00:00.000Z',
          allocation: { resource_type: 'expansion', group_id: 1, positions: [0] },
        }],
        placements: [{ item_type: 'server', id: 1 }],
        connections: [{
          id: 3,
          from: {
            item: { item_type: 'server', id: 1 },
            hosted_item: { item_type: 'network', id: 1 },
            port_id: 4,
          },
          to: {
            item: { item_type: 'patchPanel', id: 1 },
            endpoint_id: 2,
            port_id: 9,
          },
          negotiated_speed_mbps: 2500,
          route: {
            source_side: 'right',
            target_side: 'bottom',
            bend_points: [{ x: 12, y: 24 }],
            avoid_cable_overlap: true,
          },
        }],
      },
    })
    expect(snapshot.topology.items.find(
      (item) => item.item.item_type === 'server',
    )?.power_configuration).toBe('external-adapter')
  })

  it('rejects relationships whose runtime key does not resolve', () => {
    const input = project()
    input.connections[0].from.itemId = 'server:99'
    expect(() => createEngineSnapshot(input)).toThrow(
      'connections[0].from.itemId references missing inventory item server:99.',
    )
  })
})
