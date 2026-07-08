import { describe, expect, it } from 'vitest'
import { traceNetworkPath } from '@/lib/network-trace'
import { createConnection, getConnectionPort } from '@/lib/project'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function createProject(items: InventoryItem[]): ProjectState {
  return {
    id: 'test-project',
    metadata: {
      name: 'Test Project',
      version: 1,
      updatedAt: '2026-06-26T00:00:00.000Z',
    },
    items: Object.fromEntries(items.map((item) => [item.id, item])),
    placements: [],
    assignments: [],
    connections: [],
  }
}

const server: InventoryItem = {
  id: 'server',
  name: 'Server',
  type: 'server',
  ports: [
    {
      id: 'lan-01',
      kind: 'server-port',
      type: 'rj45',
      slotNumber: 1,
      speed: '1G',
    },
  ],
}

const patchPanel: InventoryItem = {
  id: 'patch',
  name: 'Patch Panel',
  type: 'patchPanel',
  ports: [
    {
      id: 'keystone-01',
      kind: 'keystone',
      type: 'rj45',
      slotNumber: 1,
      endpoints: [
        { id: 'keystone-01-front', side: 'front' },
        { id: 'keystone-01-back', side: 'back' },
      ],
    },
  ],
}

const switchItem: InventoryItem = {
  id: 'switch',
  name: 'Switch',
  type: 'switch',
  ports: [
    {
      id: 'rj45-01',
      kind: 'switch-port',
      type: 'rj45',
      slotNumber: 1,
      speed: '2.5G',
    },
  ],
}

describe('network tracing', () => {
  it('traces a server LAN path through a patch panel to a switch', () => {
    const project = createProject([server, patchPanel, switchItem])
    const first = createConnection(
      project,
      { itemId: 'server', portId: 'lan-01' },
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )
    expect(first.ok).toBe(true)

    const second = createConnection(
      first.ok ? first.project : project,
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-front' },
      { itemId: 'switch', portId: 'rj45-01' },
    )
    expect(second.ok).toBe(true)

    const trace = traceNetworkPath(second.ok ? second.project : project, {
      itemId: 'server',
      portId: 'lan-01',
    })

    expect(trace?.complete).toBe(true)
    expect(trace?.steps.map((step) => step.endpoint.itemId)).toEqual([
      'server',
      'patch',
      'patch',
      'switch',
    ])
  })

  it('marks an open server LAN trace as incomplete', () => {
    const project = createProject([server])
    const trace = traceNetworkPath(project, {
      itemId: 'server',
      portId: 'lan-01',
    })

    expect(trace?.complete).toBe(false)
    expect(trace?.steps).toHaveLength(1)
    expect(trace?.steps[0].state).toBe('open')
  })

  it('resolves hosted NIC ports before colliding server board port ids', () => {
    const project: ProjectState = {
      ...createProject([
        {
          id: 'server',
          name: 'Server',
          type: 'server',
          ports: [
            {
              id: 1,
              kind: 'server-port',
              type: 'rj45',
              slotNumber: 1,
              speed: '1G',
            },
            {
              id: 2,
              kind: 'server-port',
              type: 'displayport',
              slotNumber: 2,
            },
          ],
        },
        {
          id: 'nic',
          name: 'Quad NIC',
          type: 'network',
          ports: [
            {
              id: 2,
              kind: 'server-port',
              type: 'rj45',
              slotNumber: 2,
              speed: '1G',
            },
          ],
        },
      ]),
      assignments: [
        {
          id: 'assign-nic',
          serverId: 'server',
          itemId: 'nic',
          type: 'network',
          assignedAt: '2026-06-26T00:00:00.000Z',
        },
      ],
    }
    const endpoint = { itemId: 'server', hostedItemId: 'nic', portId: 2 }

    expect(getConnectionPort(project, endpoint)?.type).toBe('rj45')
    expect(traceNetworkPath(project, endpoint)?.steps[0].state).toBe('open')
  })
})
