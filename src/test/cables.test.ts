import { describe, expect, it } from 'vitest'
import { CABLE_COLORS, describeConnectionEndpoint, getCableAppearance } from '@/lib/cables'
import { createConnection } from '@/lib/project'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function projectWithPorts(items: InventoryItem[]): ProjectState {
  const now = '2026-06-26T00:00:00.000Z'

  return {
    id: 'test',
    metadata: {
      name: 'Test',
      version: 1,
      updatedAt: now,
    },
    items: Object.fromEntries(items.map((item) => [item.id, item])),
    placements: [],
    assignments: [],
    connections: [],
  }
}

const basePorts: InventoryItem[] = [
  {
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
      {
        id: 'dp-01',
        kind: 'server-port',
        type: 'displayport',
        slotNumber: 2,
      },
    ],
  },
  {
    id: 'switch-25',
    name: '2.5G Switch',
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
  },
  {
    id: 'switch-10',
    name: '10G Switch',
    type: 'switch',
    ports: [
      {
        id: 'sfp-01',
        kind: 'switch-port',
        type: 'sfp-plus',
        slotNumber: 1,
        speed: '10G',
      },
    ],
  },
  {
    id: 'patch-hdmi',
    name: 'HDMI Patch Panel',
    type: 'patchPanel',
    ports: [
      {
        id: 'keystone-01',
        kind: 'keystone',
        type: 'hdmi',
        slotNumber: 1,
        endpoints: [
          { id: 'keystone-01-back', side: 'back' },
          { id: 'keystone-01-front', side: 'front' },
        ],
      },
    ],
  },
]

describe('cable appearance', () => {
  const networkConnection = (negotiatedSpeedMbps?: number) => ({
    id: `network-${negotiatedSpeedMbps ?? 'unknown'}`,
    type: 'network' as const,
    negotiatedSpeedMbps,
    createdAt: '2026-06-26T00:00:00.000Z',
    from: { itemId: 'server', portId: 'lan-01' },
    to: { itemId: 'switch-25', portId: 'rj45-01' },
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
    const result = createConnection(
      project,
      { itemId: 'server', portId: 'dp-01' },
      { itemId: 'patch-hdmi', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? getCableAppearance(result.project, result.connection) : null).toEqual({
      color: CABLE_COLORS.display,
      label: 'HDMI',
    })
  })

  it('describes hosted server card ports with the card name', () => {
    const project: ProjectState = {
      ...projectWithPorts([
        basePorts[0],
        {
          id: 'nic-quad',
          name: 'Intel I350-T4 Quad Port 1G NIC',
          type: 'network',
          ports: [
            {
              id: 'rj45-02',
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
          serverId: 'server',
          itemId: 'nic-quad',
          type: 'network',
          assignedAt: '2026-06-26T00:00:00.000Z',
        },
      ],
    }

    expect(describeConnectionEndpoint(project, {
      itemId: 'server',
      hostedItemId: 'nic-quad',
      portId: 'rj45-02',
    })).toBe('Server / Intel I350-T4 Quad Port 1G NIC / RJ45 2 / RJ45 1G / Access')
  })
})
