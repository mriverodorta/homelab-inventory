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
    items: Object.fromEntries(items.map((item) => [item.key, item])),
    placements: [],
    assignments: [],
    connections: [],
  }
}

const server: InventoryItem = {
  id: 1,
  key: 'server:1',
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
  ],
}

const patchPanel: InventoryItem = {
  id: 1,
  key: 'patchPanel:1',
  name: 'Patch Panel',
  type: 'patchPanel',
  ports: [
    {
      id: 1,
      kind: 'keystone',
      type: 'rj45',
      slotNumber: 1,
      endpoints: [
        { id: 1, side: 'front' },
        { id: 2, side: 'back' },
      ],
    },
  ],
}

const switchItem: InventoryItem = {
  id: 1,
  key: 'switch:1',
  name: 'Switch',
  type: 'switch',
  ports: [
    {
      id: 1,
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
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )
    expect(first.ok).toBe(true)

    const second = createConnection(
      first.ok ? first.project : project,
      { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
      { itemId: 'switch:1', portId: 1 },
    )
    expect(second.ok).toBe(true)

    const trace = traceNetworkPath(second.ok ? second.project : project, {
      itemId: 'server:1',
      portId: 1,
    })

    expect(trace?.complete).toBe(true)
    expect(trace?.steps.map((step) => step.endpoint.itemId)).toEqual([
      'server:1',
      'patchPanel:1',
      'patchPanel:1',
      'switch:1',
    ])
  })

  it('marks an open server LAN trace as incomplete', () => {
    const project = createProject([server])
    const trace = traceNetworkPath(project, {
      itemId: 'server:1',
      portId: 1,
    })

    expect(trace?.complete).toBe(false)
    expect(trace?.steps).toHaveLength(1)
    expect(trace?.steps[0].state).toBe('open')
  })

  it('resolves hosted NIC ports before colliding server board port ids', () => {
    const project: ProjectState = {
      ...createProject([
        {
          id: 1,
          key: 'server:1',
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
          id: 1,
          key: 'network:1',
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
          id: 1,
          serverId: 'server:1',
          itemId: 'network:1',
          type: 'network',
          assignedAt: '2026-06-26T00:00:00.000Z',
        },
      ],
    }
    const endpoint = { itemId: 'server:1', hostedItemId: 'network:1', portId: 2 }

    expect(getConnectionPort(project, endpoint)?.type).toBe('rj45')
    expect(traceNetworkPath(project, endpoint)?.steps[0].state).toBe('open')
  })
})
