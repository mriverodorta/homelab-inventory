import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/lib/project'
import { applyProjectPatch } from '../engine/project-patches'

describe('project engine patches', () => {
  it('changes only project metadata and revision references', () => {
    const project = createEmptyProject()
    const result = applyProjectPatch(
      project,
      { kind: 'set-project-name', payload: { name: 'Rack Lab' } },
      2,
    )

    expect(result).not.toBe(project)
    expect(result.metadata).not.toBe(project.metadata)
    expect(result.metadata.name).toBe('Rack Lab')
    expect(result.revision).toBe(2)
    expect(result.items).toBe(project.items)
    expect(result.placements).toBe(project.placements)
    expect(result.assignments).toBe(project.assignments)
    expect(result.connections).toBe(project.connections)
  })

  it('applies connection add, label, route, and remove patches without a reload', () => {
    const project = createEmptyProject()
    const connection = {
      id: 1,
      from: {
        item: { item_type: 'server', id: 1 },
        port_id: 1,
        endpoint_id: null,
        hosted_item: null,
      },
      to: {
        item: { item_type: 'switch', id: 1 },
        port_id: 2,
        endpoint_id: null,
        hosted_item: null,
      },
      connection_type: 'network',
      negotiated_speed_mbps: null,
      label: null,
      route: null,
      created_at: '2026-07-23T00:00:00.000Z',
    }

    const added = applyProjectPatch(
      project,
      {
        kind: 'batch',
        payload: {
          patches: [
            { kind: 'add-connection', payload: { connection } },
            {
              kind: 'set-connection-derived',
              payload: {
                states: [{
                  connection_id: 1,
                  connection_type: 'network',
                  negotiated_speed_mbps: 1000,
                }],
              },
            },
          ],
        },
      },
      2,
    )
    expect(added.connections).toEqual([{
      id: 1,
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 2 },
      type: 'network',
      negotiatedSpeedMbps: 1000,
      createdAt: '2026-07-23T00:00:00.000Z',
    }])

    const labeled = applyProjectPatch(added, {
      kind: 'set-connection-label',
      payload: { connection_id: 1, label: 'Uplink' },
    }, 3)
    expect(labeled.connections[0].label).toBe('Uplink')

    const routed = applyProjectPatch(labeled, {
      kind: 'set-connection-route',
      payload: {
        connection_id: 1,
        route: {
          source_side: 'right',
          target_side: 'left',
          bend_points: [{ x: 24, y: 48 }],
          avoid_cable_overlap: true,
        },
      },
    }, 4)
    expect(routed.connections[0].route).toEqual({
      sourceSide: 'right',
      targetSide: 'left',
      bendPoints: [{ x: 24, y: 48 }],
      avoidCableOverlap: true,
    })

    const removed = applyProjectPatch(routed, {
      kind: 'remove-connection',
      payload: { connection: { ...connection, label: 'Uplink' } },
    }, 5)
    expect(removed.connections).toEqual([])
    expect(removed.revision).toBe(5)
  })
})
