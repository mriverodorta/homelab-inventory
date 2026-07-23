import { describe, expect, it } from 'vitest'
import { getConnectionRoute } from '@/lib/cable-routing'
import type { InventoryConnection, InventoryItem, ProjectState } from '@/types/inventory'

const items: InventoryItem[] = [
  { id: 1, key: 'server:1', name: 'Server A', type: 'server' },
  { id: 2, key: 'server:2', name: 'Server B', type: 'server' },
  { id: 1, key: 'switch:1', name: 'Switch A', type: 'switch' },
]

const switchPortItems: InventoryItem[] = [
  {
    id: 1,
    key: 'switch:1',
    name: 'Omada ES210X-M2 #1',
    type: 'switch',
    ports: Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      kind: 'switch-port',
      type: index < 8 ? 'rj45' : 'sfp-plus',
      slotNumber: index + 1,
      speed: index < 8 ? '2.5G' : '10G',
    })),
  },
  {
    id: 2,
    key: 'switch:2',
    name: 'MikroTik CRS305-1G-4S+IN',
    type: 'switch',
    ports: [
      { id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '1G' },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: index + 2,
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
    id: 1,
    key: 'patchPanel:1',
    name: 'VCELINK 24 Port Cat6A Patch Panel',
    type: 'patchPanel',
    ports: Array.from({ length: 24 }, (_, index) => ({
      id: index + 1,
      kind: 'keystone',
      type: 'rj45',
      slotNumber: index + 1,
      endpoints: [
        { id: index * 2 + 1, side: 'back' },
        { id: index * 2 + 2, side: 'front' },
      ],
    })),
  },
  {
    id: 1,
    key: 'switch:1',
    name: 'Omada ES210X-M2 #1',
    type: 'switch',
    ports: Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
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
    items: Object.fromEntries(items.map((item) => [item.key, item])),
    placements: [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'server:2', x: 480, y: 0 },
      { serverId: 'switch:1', x: 0, y: 360 },
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
    items: Object.fromEntries(switchPortItems.map((item) => [item.key, item])),
    placements: [
      { serverId: 'switch:2', x: 936, y: -360 },
      { serverId: 'switch:1', x: 360, y: -144 },
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
    items: Object.fromEntries(stackedPortItems.map((item) => [item.key, item])),
    placements: [
      { serverId: 'patchPanel:1', x: 0, y: 0 },
      { serverId: 'switch:1', x: 660, y: 360 },
    ],
    assignments: [],
    connections: [connection],
  }
}

function createNasPowerProject(connection: InventoryConnection): ProjectState {
  const nas: InventoryItem = {
    id: 1,
    key: 'nas:1',
    name: 'Synology DS620slim',
    type: 'nas',
    specs: { powerConfiguration: 'external-adapter' },
    ports: [
      { id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1 },
    ],
  }
  const adapter: InventoryItem = {
    id: 22,
    key: 'powerAdapter:22',
    name: 'Synology 65W',
    type: 'powerAdapter',
    ports: [
      { id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1 },
    ],
  }
  const powerStrip: InventoryItem = {
    id: 1,
    key: 'powerStrip:1',
    name: 'Power strip',
    type: 'powerStrip',
    ports: [
      { id: 1, key: 'outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 1 },
    ],
  }

  return {
    id: 'test-project',
    metadata: {
      name: 'Test',
      version: 1,
      updatedAt: '2026-06-26T00:00:00.000Z',
    },
    items: {
      [nas.key!]: nas,
      [adapter.key!]: adapter,
      [powerStrip.key!]: powerStrip,
    },
    placements: [
      { serverId: 'nas:1', x: 0, y: 0 },
      { serverId: 'powerStrip:1', x: 480, y: 360 },
    ],
    assignments: [{
      id: 95,
      serverId: 'nas:1',
      itemId: 'powerAdapter:22',
      type: 'powerAdapter',
      assignedAt: '2026-07-22T22:54:46.803Z',
    }],
    connections: [connection],
  }
}

describe('cable routing', () => {
  it('routes horizontal cables from right side to left side', () => {
    const connection: InventoryConnection = {
      id: 1,
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'server:2', portId: 1 },
    }

    expect(getConnectionRoute(createProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-right-1:port',
      targetHandle: 'target-left-1:port',
      laneOffset: 24,
    })
  })

  it('routes vertical cables from bottom side to top side', () => {
    const connection: InventoryConnection = {
      id: 1,
      type: 'display',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server:1', portId: 2 },
      to: { itemId: 'switch:1', portId: 2 },
    }

    expect(getConnectionRoute(createProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-bottom-2:port',
      targetHandle: 'target-top-2:port',
      laneOffset: 42,
    })
  })

  it('adds small parallel offsets by connection index', () => {
    const connection: InventoryConnection = {
      id: 1,
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'server:2', portId: 1 },
    }

    expect(getConnectionRoute(createProject(connection), connection, 2)?.laneOffset).toBe(40)
  })

  it('routes patch panel endpoint connections to endpoint-specific handles', () => {
    const connection: InventoryConnection = {
      id: 1,
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'server:2', portId: 1, endpointId: 1 },
    }

    expect(getConnectionRoute(createProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-right-1:port',
      targetHandle: 'target-left-1:1',
    })
  })

  it('routes switch uplinks to the physical port chip handles', () => {
    const connection: InventoryConnection = {
      id: 1,
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'switch:1', portId: 10 },
      to: { itemId: 'switch:2', portId: 2 },
    }

    expect(getConnectionRoute(createSwitchPortProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-top-10:port',
      targetHandle: 'target-bottom-2:port',
    })
  })

  it('routes lower switch ports to upper patch panel keystones from top to bottom', () => {
    const connection: InventoryConnection = {
      id: 1,
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'switch:1', portId: 2 },
      to: { itemId: 'patchPanel:1', portId: 12, endpointId: 23 },
    }

    expect(getConnectionRoute(createStackedPortProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-top-2:port',
      targetHandle: 'target-bottom-12:23',
    })
  })

  it('uses saved route side preferences when present', () => {
    const connection: InventoryConnection = {
      id: 1,
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'switch:1', portId: 10 },
      to: { itemId: 'switch:2', portId: 2 },
      route: {
        sourceSide: 'right',
        targetSide: 'left',
      },
    }

    expect(getConnectionRoute(createSwitchPortProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-right-10:port',
      targetHandle: 'target-left-2:port',
    })
  })

  it('routes an external NAS power cable to the assigned adapter port chip', () => {
    const connection: InventoryConnection = {
      id: 66,
      type: 'power',
      createdAt: '2026-07-22T22:55:00.000Z',
      from: { itemId: 'powerStrip:1', portId: 1 },
      to: {
        itemId: 'nas:1',
        hostedItemId: 'powerAdapter:22',
        portId: 1,
      },
      route: {
        sourceSide: 'top',
        targetSide: 'bottom',
      },
    }

    expect(getConnectionRoute(createNasPowerProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-top-1:port',
      targetHandle: 'target-bottom-powerAdapter:22:1:port',
    })
  })

  it('routes an internal NAS power cable to the direct header port chip', () => {
    const connection: InventoryConnection = {
      id: 67,
      type: 'power',
      createdAt: '2026-07-22T22:55:00.000Z',
      from: { itemId: 'powerStrip:1', portId: 1 },
      to: { itemId: 'nas:1', portId: 1 },
      route: {
        sourceSide: 'top',
        targetSide: 'left',
      },
    }

    expect(getConnectionRoute(createNasPowerProject(connection), connection)).toMatchObject({
      sourceHandle: 'source-top-1:port',
      targetHandle: 'target-left-1:port',
    })
  })
})
