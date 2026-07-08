import { describe, expect, it } from 'vitest'
import { getConnectionRoute } from '@/lib/cable-routing'
import type { InventoryConnection, InventoryItem, ProjectState } from '@/types/inventory'

const items: InventoryItem[] = [
  { id: 'server-a', name: 'Server A', type: 'server' },
  { id: 'server-b', name: 'Server B', type: 'server' },
  { id: 'switch-a', name: 'Switch A', type: 'switch' },
]

const switchPortItems: InventoryItem[] = [
  {
    id: 'switch-omada-1',
    name: 'Omada ES210X-M2 #1',
    type: 'switch',
    ports: Array.from({ length: 10 }, (_, index) => ({
      id: index < 8
        ? `rj45-${String(index + 1).padStart(2, '0')}`
        : `sfp-plus-${String(index - 7).padStart(2, '0')}`,
      kind: 'switch-port',
      type: index < 8 ? 'rj45' : 'sfp-plus',
      slotNumber: index + 1,
      speed: index < 8 ? '2.5G' : '10G',
    })),
  },
  {
    id: 'switch-mikrotik',
    name: 'MikroTik CRS305-1G-4S+IN',
    type: 'switch',
    ports: [
      { id: 'rj45-01', kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '1G' },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `sfp-plus-${String(index + 1).padStart(2, '0')}`,
        kind: 'switch-port' as const,
        type: 'sfp-plus' as const,
        slotNumber: index + 2,
        speed: '10G',
      })),
    ],
  },
]

const stackedPortItems: InventoryItem[] = [
  {
    id: 'patch-rj45',
    name: 'VCELINK 24 Port Cat6A Patch Panel',
    type: 'patchPanel',
    ports: Array.from({ length: 24 }, (_, index) => ({
      id: `keystone-${String(index + 1).padStart(2, '0')}`,
      kind: 'keystone',
      type: 'rj45',
      slotNumber: index + 1,
      endpoints: [
        { id: `keystone-${String(index + 1).padStart(2, '0')}-back`, side: 'back' },
        { id: `keystone-${String(index + 1).padStart(2, '0')}-front`, side: 'front' },
      ],
    })),
  },
  {
    id: 'switch-omada-1',
    name: 'Omada ES210X-M2 #1',
    type: 'switch',
    ports: Array.from({ length: 10 }, (_, index) => ({
      id: index < 8
        ? `rj45-${String(index + 1).padStart(2, '0')}`
        : `sfp-plus-${String(index - 7).padStart(2, '0')}`,
      kind: 'switch-port',
      type: index < 8 ? 'rj45' : 'sfp-plus',
      slotNumber: index + 1,
      speed: index < 8 ? '2.5G' : '10G',
    })),
  },
]

function createProject(connection: InventoryConnection): ProjectState {
  return {
    id: 'test-project',
    metadata: {
      name: 'Test',
      version: 1,
      updatedAt: '2026-06-26T00:00:00.000Z',
    },
    items: Object.fromEntries(items.map((item) => [item.id, item])),
    placements: [
      { serverId: 'server-a', x: 0, y: 0 },
      { serverId: 'server-b', x: 480, y: 0 },
      { serverId: 'switch-a', x: 0, y: 360 },
    ],
    assignments: [],
    connections: [connection],
  }
}

function createSwitchPortProject(connection: InventoryConnection): ProjectState {
  return {
    id: 'test-project',
    metadata: {
      name: 'Test',
      version: 1,
      updatedAt: '2026-06-26T00:00:00.000Z',
    },
    items: Object.fromEntries(switchPortItems.map((item) => [item.id, item])),
    placements: [
      { serverId: 'switch-mikrotik', x: 936, y: -360 },
      { serverId: 'switch-omada-1', x: 360, y: -144 },
    ],
    assignments: [],
    connections: [connection],
  }
}

function createStackedPortProject(connection: InventoryConnection): ProjectState {
  return {
    id: 'test-project',
    metadata: {
      name: 'Test',
      version: 1,
      updatedAt: '2026-06-26T00:00:00.000Z',
    },
    items: Object.fromEntries(stackedPortItems.map((item) => [item.id, item])),
    placements: [
      { serverId: 'patch-rj45', x: 0, y: 0 },
      { serverId: 'switch-omada-1', x: 660, y: 360 },
    ],
    assignments: [],
    connections: [connection],
  }
}

describe('cable routing', () => {
  it('routes horizontal cables from right side to left side', () => {
    const connection: InventoryConnection = {
      id: 'conn-network',
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server-a', portId: 'lan-01' },
      to: { itemId: 'server-b', portId: 'lan-01' },
    }

    expect(getConnectionRoute(createProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-right-lan-01:port',
      targetHandle: 'target-left-lan-01:port',
      laneOffset: 24,
    })
  })

  it('routes vertical cables from bottom side to top side', () => {
    const connection: InventoryConnection = {
      id: 'conn-display',
      type: 'display',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server-a', portId: 'dp-01' },
      to: { itemId: 'switch-a', portId: 'hdmi-01' },
    }

    expect(getConnectionRoute(createProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-bottom-dp-01:port',
      targetHandle: 'target-top-hdmi-01:port',
      laneOffset: 42,
    })
  })

  it('adds small parallel offsets by connection index', () => {
    const connection: InventoryConnection = {
      id: 'conn-network',
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server-a', portId: 'lan-01' },
      to: { itemId: 'server-b', portId: 'lan-01' },
    }

    expect(getConnectionRoute(createProject(connection), connection, 2)?.laneOffset).toBe(40)
  })

  it('routes patch panel endpoint connections to endpoint-specific handles', () => {
    const connection: InventoryConnection = {
      id: 'conn-panel',
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server-a', portId: 'lan-01' },
      to: { itemId: 'server-b', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    }

    expect(getConnectionRoute(createProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-right-lan-01:port',
      targetHandle: 'target-left-keystone-01:keystone-01-back',
    })
  })

  it('routes switch uplinks to the physical port chip handles', () => {
    const connection: InventoryConnection = {
      id: 'conn-uplink',
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'switch-omada-1', portId: 'sfp-plus-02' },
      to: { itemId: 'switch-mikrotik', portId: 'sfp-plus-01' },
    }

    expect(getConnectionRoute(createSwitchPortProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-top-sfp-plus-02:port',
      targetHandle: 'target-bottom-sfp-plus-01:port',
    })
  })

  it('routes lower switch ports to upper patch panel keystones from top to bottom', () => {
    const connection: InventoryConnection = {
      id: 'conn-patch-uplink',
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'switch-omada-1', portId: 'rj45-02' },
      to: { itemId: 'patch-rj45', portId: 'keystone-12', endpointId: 'keystone-12-back' },
    }

    expect(getConnectionRoute(createStackedPortProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-top-rj45-02:port',
      targetHandle: 'target-bottom-keystone-12:keystone-12-back',
    })
  })

  it('uses saved route side preferences when present', () => {
    const connection: InventoryConnection = {
      id: 'conn-uplink',
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'switch-omada-1', portId: 'sfp-plus-02' },
      to: { itemId: 'switch-mikrotik', portId: 'sfp-plus-01' },
      route: {
        sourceSide: 'right',
        targetSide: 'left',
      },
    }

    expect(getConnectionRoute(createSwitchPortProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-right-sfp-plus-02:port',
      targetHandle: 'target-left-sfp-plus-01:port',
    })
  })
})
