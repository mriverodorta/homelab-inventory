import { describe, expect, it } from 'vitest'
import { CABLE_COLORS, describeConnectionEndpoint, getCableAppearance } from '@/lib/cables'
import type { InventoryConnection, InventoryItem, ProjectState } from '@/types/inventory'

function projectWithPorts(items: InventoryItem[]): ProjectState {
  const now = '2026-06-26T00:00:00.000Z'

  return {
    id: 'test',
    metadata: {
      name: 'Test',
      version: 1,
      updatedAt: now,
    },
    items: Object.fromEntries(items.map((item) => [item.key, item])),
    placements: [],
    assignments: [],
    connections: [],
  }
}

const basePorts: InventoryItem[] = [
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
    key: 'switch:1',
    name: '2.5G Switch',
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
  },
  {
    id: 2,
    key: 'switch:2',
    name: '10G Switch',
    type: 'switch',
    ports: [
      {
        id: 1,
        kind: 'switch-port',
        type: 'sfp-plus',
        slotNumber: 1,
        speed: '10G',
      },
    ],
  },
  {
    id: 1,
    key: 'patchPanel:1',
    name: 'HDMI Patch Panel',
    type: 'patchPanel',
    ports: [
      {
        id: 1,
        kind: 'keystone',
        type: 'hdmi',
        slotNumber: 1,
        endpoints: [
          { id: 1, side: 'back' },
          { id: 2, side: 'front' },
        ],
      },
    ],
  },
]

describe('cable appearance', () => {
  const networkConnection = (negotiatedSpeedMbps?: number) => ({
    id: ({ 1000: 1, 2500: 2, 5000: 3, 10000: 4 }[negotiatedSpeedMbps ?? 0] ?? 5),
    type: 'network' as const,
    negotiatedSpeedMbps,
    createdAt: '2026-06-26T00:00:00.000Z',
    from: { itemId: 'server:1', portId: 1 },
    to: { itemId: 'switch:1', portId: 1 },
  })

  const project = projectWithPorts([basePorts[0], basePorts[1], basePorts[2]])

  it('colors persisted 1g negotiated connections orange', () => {
    expect(getCableAppearance(project, networkConnection(1000))).toEqual({
      color: CABLE_COLORS.oneGig,
      label: '1G',
    })
  })

  it('colors persisted 2.5g negotiated connections green', () => {
    expect(getCableAppearance(project, networkConnection(2500))).toEqual({
      color: CABLE_COLORS.twoPointFiveGig,
      label: '2.5G',
    })
  })

  it('colors persisted 5g negotiated connections light purple', () => {
    expect(getCableAppearance(project, networkConnection(5000))).toEqual({
      color: CABLE_COLORS.fiveGig,
      label: '5G',
    })
  })

  it('colors persisted 10g negotiated connections blue', () => {
    expect(getCableAppearance(project, networkConnection(10000))).toEqual({
      color: CABLE_COLORS.tenGig,
      label: '10G',
    })
  })

  it('uses a neutral appearance when a network connection has no negotiated speed', () => {
    expect(getCableAppearance(project, networkConnection())).toEqual({
      color: CABLE_COLORS.other,
      label: 'network',
    })
  })

  it('colors display cables black across displayport and hdmi', () => {
    const project = projectWithPorts([basePorts[0], basePorts[3]])
    const connection: InventoryConnection = {
      id: 1,
      type: 'display',
      createdAt: '2026-07-22T00:00:00.000Z',
      from: { itemId: 'server:1', portId: 2 },
      to: { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
    }

    expect(getCableAppearance(project, connection)).toEqual({
      color: CABLE_COLORS.display,
      label: 'HDMI',
    })
  })

  it('describes hosted server card ports with the card name', () => {
    const project: ProjectState = {
      ...projectWithPorts([
        basePorts[0],
        {
          id: 1,
          key: 'network:1',
          name: 'Intel I350-T4 Quad Port 1G NIC',
          type: 'network',
          ports: [
            {
              id: 2,
              kind: 'server-port',
              type: 'rj45',
              slotNumber: 2,
              label: 'RJ45 2',
              speed: '1G',
              role: 'access',
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

    expect(describeConnectionEndpoint(project, {
      itemId: 'server:1',
      hostedItemId: 'network:1',
      portId: 2,
    })).toBe('Server / Intel I350-T4 Quad Port 1G NIC / RJ45 2 / RJ45 1G / Access')
  })
})
