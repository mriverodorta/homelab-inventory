import { describe, expect, it } from 'vitest'
import { assignComponent } from '@/lib/constraints'
import { mergeInventoryWithProject } from '@/lib/inventory'
import {
  applyInventoryItemInput,
  autoArrangeCanvasItems,
  createConnection,
  getCanvasItemHeight,
  getCanvasItemWidth,
  getNonCollidingPlacement,
  MONITOR_CARD_WIDTH,
  PC_BUILD_CARD_WIDTH,
  placementCollides,
  placementsCollide,
  POWER_EQUIPMENT_CARD_WIDTH,
  removeConnection,
  SERVER_CARD_COLLISION_GAP,
  SERVER_CARD_WIDTH,
  updateConnectionLabel,
  updateConnectionRoute,
  upsertPlacements,
  upsertPlacement,
  validateConnection,
} from '@/lib/project'
import type { InventoryItemInput } from '@/lib/db'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function archived(item: InventoryItem): InventoryItem {
  return {
    ...item,
    archivedAt: '2026-07-19T12:00:00.000Z',
  }
}

const inventory: InventoryItem[] = [
  { id: 'server-a', name: 'Server A', type: 'server' },
  { id: 'server-b', name: 'Server B', type: 'server' },
  { id: 'gpu-a', name: 'GPU A', type: 'gpu' },
  {
    id: 'patch-a',
    name: 'Patch Panel A',
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
    id: 'switch-a',
    name: 'Switch A',
    type: 'switch',
    ports: Array.from({ length: 10 }, (_, index) => ({
      id: `port-${String(index + 1).padStart(2, '0')}`,
      kind: 'switch-port',
      type: index < 8 ? 'rj45' : 'sfp-plus',
      slotNumber: index + 1,
      speed: index < 8 ? '2.5G' : '10G',
    })),
  },
]

const newCanvasEquipmentInventory: InventoryItem[] = [
  {
    id: 'pc-build-a',
    name: 'PC Build A',
    type: 'pcBuild',
    specs: { operatingSystem: 'Linux' },
  },
  {
    id: 'motherboard-a',
    name: 'Motherboard A',
    type: 'motherboard',
    ports: [
      { id: 'lan-01', kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '2.5G' },
    ],
  },
  {
    id: 'gpu-ports-a',
    name: 'GPU with ports',
    type: 'gpu',
    ports: [
      { id: 'dp-01', kind: 'server-port', type: 'displayport', slotNumber: 1 },
    ],
  },
  {
    id: 'monitor-a',
    name: 'Monitor A',
    type: 'monitor',
    ports: [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `display-${index + 1}`,
        kind: 'server-port' as const,
        type: 'displayport' as const,
        slotNumber: index + 1,
      })),
      { id: 'power-1', kind: 'server-port', type: 'barrel', slotNumber: 7 },
    ],
  },
  {
    id: 'ups-a',
    name: 'UPS A',
    type: 'ups',
    specs: { outlets: 12, batteryBackupOutlets: 6, surgeProtectedOutlets: 6 },
  },
  {
    id: 'power-strip-a',
    name: 'Power Strip A',
    type: 'powerStrip',
    specs: { outlets: 12 },
  },
]

const connectionInventory: InventoryItem[] = [
  {
    id: 'server-display',
    name: 'Display Server',
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
    id: 'patch-rj45',
    name: 'RJ45 Patch Panel',
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
          { id: 'keystone-01-front', side: 'front' },
          { id: 'keystone-01-back', side: 'back' },
        ],
      },
    ],
  },
  {
    id: 'nic-quad',
    name: 'Quad NIC',
    type: 'network',
    ports: [
      {
        id: 'rj45-01',
        kind: 'server-port',
        type: 'rj45',
        slotNumber: 1,
        speed: '1G',
      },
      {
        id: 'rj45-02',
        kind: 'server-port',
        type: 'rj45',
        slotNumber: 2,
        speed: '1G',
      },
    ],
  },
]

describe('inventory item input updates', () => {
  it('replaces editable fields without retaining removed optional values', () => {
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'Inventory', version: 1, updatedAt: '2026-07-14T12:00:00.000Z' },
      items: {
        'server:7': {
          id: 7,
          key: 'server:7',
          type: 'server',
          name: 'Old server',
          manufacturer: 'Old manufacturer',
          secondaryManufacturer: 'Old secondary manufacturer',
          model: 'Old model',
          family: 'Old family',
          number: 'Old number',
          subtype: 'Old subtype',
          specs: { formFactor: 'Tower', staleSpec: true },
          properties: { displayName: 'Old display name' },
          ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1 }],
          notes: 'Old notes',
        },
      },
      placements: [],
      assignments: [],
      connections: [],
    }
    const input: InventoryItemInput = {
      type: 'server',
      name: 'Updated server',
      specs: { formFactor: 'Mini' },
    }

    const updated = applyInventoryItemInput(project, 'server:7', input)

    expect(updated.items['server:7']).toEqual({
      ...input,
      id: 7,
      key: 'server:7',
    })
  })

  it('preserves runtime identity and project relationships', () => {
    const relatedItem: InventoryItem = { id: 8, key: 'cpu:8', type: 'cpu', name: 'CPU' }
    const placement = { serverId: 'server:7', x: 24, y: 48 }
    const assignment = {
      id: 'assignment-1',
      serverId: 'server:7',
      itemId: 'cpu:8',
      type: 'cpu' as const,
      assignedAt: '2026-07-14T12:00:00.000Z',
    }
    const connection = {
      id: 'connection-1',
      from: { itemId: 'server:7', portId: 1 },
      to: { itemId: 'switch:9', portId: 1 },
      type: 'network' as const,
      createdAt: '2026-07-14T12:00:00.000Z',
    }
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'Inventory', version: 1, updatedAt: '2026-07-14T12:00:00.000Z' },
      items: {
        'server:7': { id: 7, key: 'server:7', type: 'server', name: 'Old server' },
        'cpu:8': relatedItem,
      },
      placements: [placement],
      assignments: [assignment],
      connections: [connection],
    }
    const input: InventoryItemInput = {
      type: 'server',
      name: 'Updated server',
      ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1 }],
    }

    const updated = applyInventoryItemInput(project, 'server:7', input)

    expect(updated.items['server:7']).toEqual({ ...input, id: 7, key: 'server:7' })
    expect(updated.items['cpu:8']).toBe(relatedItem)
    expect(updated.placements).toBe(project.placements)
    expect(updated.assignments).toBe(project.assignments)
    expect(updated.connections).toBe(project.connections)
  })

  it('rejects removing a directly connected item port', () => {
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'Inventory', version: 1, updatedAt: '2026-07-14T12:00:00.000Z' },
      items: {
        'gpu:7': {
          id: 7,
          key: 'gpu:7',
          type: 'gpu',
          name: 'GPU',
          ports: [
            { id: 'dp-1', kind: 'server-port', type: 'displayport', slotNumber: 1 },
            { id: 'dp-2', kind: 'server-port', type: 'displayport', slotNumber: 2 },
          ],
        },
      },
      placements: [],
      assignments: [],
      connections: [{
        id: 'display-1',
        from: { itemId: 'gpu:7', portId: 'dp-2' },
        to: { itemId: 'server:8', portId: 'dp-1' },
        type: 'display',
        createdAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    const input: InventoryItemInput = {
      type: 'gpu',
      name: 'GPU',
      ports: [{ id: 'dp-1', kind: 'server-port', type: 'displayport', slotNumber: 1 }],
    }

    expect(() => applyInventoryItemInput(project, 'gpu:7', input)).toThrow(/connected port dp-2/i)
  })

  it('rejects removing a connected hosted component port', () => {
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'Inventory', version: 1, updatedAt: '2026-07-14T12:00:00.000Z' },
      items: {
        'server:7': { id: 7, key: 'server:7', type: 'server', name: 'Server' },
        'network:8': {
          id: 8,
          key: 'network:8',
          type: 'network',
          name: 'NIC',
          ports: [
            { id: 'lan-1', kind: 'server-port', type: 'rj45', slotNumber: 1 },
            { id: 'lan-2', kind: 'server-port', type: 'rj45', slotNumber: 2 },
          ],
        },
      },
      placements: [],
      assignments: [{
        id: 'assignment-1',
        serverId: 'server:7',
        itemId: 'network:8',
        type: 'network',
        assignedAt: '2026-07-14T12:00:00.000Z',
      }],
      connections: [{
        id: 'network-1',
        from: { itemId: 'switch:9', portId: 'lan-1' },
        to: { itemId: 'server:7', hostedItemId: 'network:8', portId: 'lan-2' },
        type: 'network',
        createdAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    const input: InventoryItemInput = {
      type: 'network',
      name: 'NIC',
      ports: [{ id: 'lan-1', kind: 'server-port', type: 'rj45', slotNumber: 1 }],
    }

    expect(() => applyInventoryItemInput(project, 'network:8', input)).toThrow(/connected port lan-2/i)
  })

  it('rejects removing a connected patch-panel endpoint', () => {
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'Inventory', version: 1, updatedAt: '2026-07-14T12:00:00.000Z' },
      items: {
        'patchPanel:7': {
          id: 7,
          key: 'patchPanel:7',
          type: 'patchPanel',
          name: 'Patch panel',
          ports: [{
            id: 'keystone-1',
            kind: 'keystone',
            type: 'rj45',
            slotNumber: 1,
            endpoints: [
              { id: 'front', side: 'front' },
              { id: 'back', side: 'back' },
            ],
          }],
        },
      },
      placements: [],
      assignments: [],
      connections: [{
        id: 'network-1',
        from: { itemId: 'patchPanel:7', portId: 'keystone-1', endpointId: 'back' },
        to: { itemId: 'switch:8', portId: 'lan-1' },
        type: 'network',
        createdAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    const input: InventoryItemInput = {
      type: 'patchPanel',
      name: 'Patch panel',
      ports: [{
        id: 'keystone-1',
        kind: 'keystone',
        type: 'rj45',
        slotNumber: 1,
        endpoints: [{ id: 'front', side: 'front' }],
      }],
    }

    expect(() => applyInventoryItemInput(project, 'patchPanel:7', input)).toThrow(
      /connected endpoint back/i,
    )
  })
})

describe('server placement collisions', () => {
  it('rejects overlapping server placements', () => {
    const project = upsertPlacement(mergeInventoryWithProject(inventory, null), {
      serverId: 'server-a',
      x: 0,
      y: 0,
    })

    expect(getNonCollidingPlacement(project, { serverId: 'server-b', x: 96, y: 48 })).toBeNull()
  })

  it('allows separated server placements', () => {
    const project = upsertPlacement(mergeInventoryWithProject(inventory, null), {
      serverId: 'server-a',
      x: 0,
      y: 0,
    })
    const nextPlacement = {
      serverId: 'server-b',
      x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP,
      y: 0,
    }

    expect(getNonCollidingPlacement(project, nextPlacement)).toEqual(nextPlacement)
  })

  it('ignores a server colliding with its own saved placement while moving', () => {
    const project = upsertPlacement(mergeInventoryWithProject(inventory, null), {
      serverId: 'server-a',
      x: 0,
      y: 0,
    })

    expect(placementCollides(project, { serverId: 'server-a', x: 48, y: 48 })).toBe(false)
  })

  it('detects collisions caused by a server growing after component assignment', () => {
    const project = upsertPlacement(
      upsertPlacement(mergeInventoryWithProject(inventory, null), {
        serverId: 'server-a',
        x: 0,
        y: 0,
      }),
      {
        serverId: 'server-b',
        x: 0,
        y: 208,
      },
    )
    const expandedProject = assignComponent(project, 'server-a', 'gpu-a')
    const expandedPlacement = expandedProject.placements.find(
      (placement) => placement.serverId === 'server-a',
    )

    expect(expandedPlacement).toBeDefined()
    expect(placementCollides(expandedProject, expandedPlacement!)).toBe(true)
  })

  it('allows a selected group to move together without colliding with its own old positions', () => {
    const project = upsertPlacements(mergeInventoryWithProject(inventory, null), [
      { serverId: 'server-a', x: 0, y: 0 },
      { serverId: 'server-b', x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP, y: 0 },
    ])
    const movedPlacements = [
      { serverId: 'server-a', x: 0, y: 24 },
      { serverId: 'server-b', x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP, y: 24 },
    ]

    expect(placementsCollide(project, movedPlacements)).toBe(false)
  })

  it('rejects a selected group move that intersects a non-selected canvas item', () => {
    const project = upsertPlacements(mergeInventoryWithProject(inventory, null), [
      { serverId: 'server-a', x: 0, y: 0 },
      { serverId: 'server-b', x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP, y: 0 },
      { serverId: 'switch-a', x: 0, y: 220 },
    ])

    expect(placementsCollide(project, [
      { serverId: 'server-a', x: 0, y: 180 },
      { serverId: 'server-b', x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP, y: 180 },
    ])).toBe(true)
  })
})

describe('canvas item geometry', () => {
  it('sizes switches and patch panels from visible physical ports', () => {
    const project = mergeInventoryWithProject(inventory, null)

    expect(getCanvasItemWidth(project, 'switch-a')).toBeGreaterThan(SERVER_CARD_WIDTH)
    expect(getCanvasItemWidth(project, 'patch-a')).toBeGreaterThan(getCanvasItemWidth(project, 'switch-a'))
    expect(getCanvasItemHeight(project, 'patch-a')).toBeGreaterThan(getCanvasItemHeight(project, 'switch-a'))
  })

  it('uses the rendered widths for new canvas equipment', () => {
    const project = mergeInventoryWithProject(newCanvasEquipmentInventory, null)

    expect(getCanvasItemWidth(project, 'pc-build-a')).toBe(PC_BUILD_CARD_WIDTH)
    expect(PC_BUILD_CARD_WIDTH).toBe(318)
    expect(getCanvasItemWidth(project, 'monitor-a')).toBe(MONITOR_CARD_WIDTH)
    expect(MONITOR_CARD_WIDTH).toBe(360)
    expect(getCanvasItemWidth(project, 'ups-a')).toBe(POWER_EQUIPMENT_CARD_WIDTH)
    expect(getCanvasItemWidth(project, 'power-strip-a')).toBe(POWER_EQUIPMENT_CARD_WIDTH)
    expect(POWER_EQUIPMENT_CARD_WIDTH).toBe(420)
  })

  it('grows PC build geometry for visible assignments, hosted ports, and the operating system', () => {
    const emptyProject = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const populatedProject: ProjectState = {
      ...emptyProject,
      assignments: [
        {
          id: 'motherboard-assignment',
          serverId: 'pc-build-a',
          itemId: 'motherboard-a',
          type: 'motherboard',
          assignedAt: '2026-07-20T12:00:00.000Z',
        },
        {
          id: 'gpu-assignment',
          serverId: 'pc-build-a',
          itemId: 'gpu-ports-a',
          type: 'gpu',
          assignedAt: '2026-07-20T12:00:00.000Z',
        },
      ],
    }
    const withoutOperatingSystem: ProjectState = {
      ...populatedProject,
      items: {
        ...populatedProject.items,
        'pc-build-a': {
          ...populatedProject.items['pc-build-a'],
          specs: {},
        },
      },
    }

    expect(getCanvasItemHeight(populatedProject, 'pc-build-a')).toBeGreaterThan(
      getCanvasItemHeight(emptyProject, 'pc-build-a'),
    )
    expect(getCanvasItemHeight(populatedProject, 'pc-build-a')).toBeGreaterThan(
      getCanvasItemHeight(withoutOperatingSystem, 'pc-build-a'),
    )
  })

  it('accounts for wrapped monitor and power-equipment port groups', () => {
    const project = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const compactProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        'monitor-a': {
          ...project.items['monitor-a'],
          ports: project.items['monitor-a'].ports?.slice(0, 2),
        },
        'power-strip-a': {
          ...project.items['power-strip-a'],
          specs: { outlets: 6 },
        },
      },
    }

    expect(getCanvasItemHeight(project, 'monitor-a')).toBeGreaterThan(
      getCanvasItemHeight(compactProject, 'monitor-a'),
    )
    expect(getCanvasItemHeight(project, 'power-strip-a')).toBeGreaterThan(
      getCanvasItemHeight(compactProject, 'power-strip-a'),
    )
    expect(getCanvasItemHeight(project, 'ups-a')).toBeGreaterThan(0)
  })

  it('prevents overlap using the new equipment dimensions', () => {
    const project = upsertPlacement(
      mergeInventoryWithProject(newCanvasEquipmentInventory, null),
      { serverId: 'pc-build-a', x: 0, y: 0 },
    )

    expect(placementCollides(project, {
      serverId: 'monitor-a',
      x: PC_BUILD_CARD_WIDTH + SERVER_CARD_COLLISION_GAP - 1,
      y: 0,
    })).toBe(true)
    expect(placementCollides(project, {
      serverId: 'monitor-a',
      x: PC_BUILD_CARD_WIDTH + SERVER_CARD_COLLISION_GAP,
      y: 0,
    })).toBe(false)
  })
})

describe('canvas auto arrange', () => {
  it('places canvas equipment into server, patch panel, and switch columns', () => {
    const project = {
      ...mergeInventoryWithProject(inventory, null),
      placements: [
        { serverId: 'switch-a', x: 24, y: 48 },
        { serverId: 'server-a', x: 720, y: 96 },
        { serverId: 'patch-a', x: 360, y: 144 },
      ],
    }
    const arranged = autoArrangeCanvasItems(project)

    expect(arranged.placements).toEqual([
      { serverId: 'server-a', x: 0, y: 0 },
      { serverId: 'patch-a', x: 360, y: 0 },
      { serverId: 'switch-a', x: 1320, y: 0 },
    ])
  })

  it('arranges PC builds with hosts and stacks standalone equipment without overlap', () => {
    const project: ProjectState = {
      ...mergeInventoryWithProject(newCanvasEquipmentInventory, null),
      placements: [
        { serverId: 'ups-a', x: 0, y: 0 },
        { serverId: 'pc-build-a', x: 0, y: 0 },
        { serverId: 'monitor-a', x: 0, y: 0 },
        { serverId: 'power-strip-a', x: 0, y: 0 },
      ],
    }
    const arranged = autoArrangeCanvasItems(project)
    const pcBuildPlacement = arranged.placements.find(
      (placement) => placement.serverId === 'pc-build-a',
    )
    const standalonePlacements = arranged.placements.filter(
      (placement) => placement.serverId !== 'pc-build-a',
    )

    expect(pcBuildPlacement?.x).toBe(0)
    expect(new Set(standalonePlacements.map((placement) => placement.x)).size).toBe(1)
    expect(placementsCollide(arranged, arranged.placements)).toBe(false)
  })
})

describe('inventory connections', () => {
  it('allows displayport to hdmi connections for adapter cables', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server-display', portId: 'dp-01' },
      { itemId: 'patch-hdmi', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.connection.type : null).toBe('display')
  })

  it('allows rj45 connections to one side of a keystone', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server-display', portId: 'lan-01' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.connection.type : null).toBe('network')
  })

  it('allows installed server network card ports to connect as hosted endpoints', () => {
    const project = assignComponent(
      mergeInventoryWithProject(connectionInventory, null),
      'server-display',
      'nic-quad',
    )
    const result = createConnection(
      project,
      { itemId: 'server-display', hostedItemId: 'nic-quad', portId: 'rj45-02' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.connection.type : null).toBe('network')
  })

  it('classifies sfp plus switch links as network connections', () => {
    const project = mergeInventoryWithProject([
      {
        id: 'switch-a',
        name: 'Switch A',
        type: 'switch',
        ports: [
          {
            id: 'sfp-plus-01',
            kind: 'switch-port',
            type: 'sfp-plus',
            slotNumber: 1,
            speed: '10G',
          },
        ],
      },
      {
        id: 'switch-b',
        name: 'Switch B',
        type: 'switch',
        ports: [
          {
            id: 'sfp-plus-01',
            kind: 'switch-port',
            type: 'sfp-plus',
            slotNumber: 1,
            speed: '10G',
          },
        ],
      },
    ], null)
    const result = createConnection(
      project,
      { itemId: 'switch-a', portId: 'sfp-plus-01' },
      { itemId: 'switch-b', portId: 'sfp-plus-01' },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.connection.type : null).toBe('network')
  })

  it('rejects incompatible rj45 to hdmi connections', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)

    expect(
      validateConnection(
        project,
        { itemId: 'server-display', portId: 'lan-01' },
        { itemId: 'patch-hdmi', portId: 'keystone-01', endpointId: 'keystone-01-back' },
      ),
    ).toEqual({ ok: false, message: 'Those port types cannot be connected.' })
  })

  it('prevents two connections from using the same endpoint', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const first = createConnection(
      project,
      { itemId: 'server-display', portId: 'lan-01' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(first.ok).toBe(true)

    const second = createConnection(
      first.ok ? first.project : project,
      { itemId: 'server-display', portId: 'lan-01' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-front' },
    )

    expect(second).toEqual({ ok: false, message: 'The source port is already connected.' })
  })

  it('removes saved connections by id', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server-display', portId: 'lan-01' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)

    const nextProject = removeConnection(
      result.ok ? result.project : project,
      result.ok ? result.connection.id : 'missing',
    )

    expect(nextProject.connections).toEqual([])
  })

  it('updates saved connection labels', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server-display', portId: 'lan-01' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)

    const nextProject = updateConnectionLabel(
      result.ok ? result.project : project,
      result.ok ? result.connection.id : 'missing',
      'LAN uplink',
    )

    expect(nextProject.connections[0].label).toBe('LAN uplink')
  })

  it('updates saved connection route preferences and clears empty route metadata', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server-display', portId: 'lan-01' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)

    const routedProject = updateConnectionRoute(
      result.ok ? result.project : project,
      result.ok ? result.connection.id : 'missing',
      {
        sourceSide: 'top',
        targetSide: 'bottom',
        bendPoints: [{ x: 160, y: 240 }],
      },
    )

    expect(routedProject.connections[0].route).toEqual({
      sourceSide: 'top',
      targetSide: 'bottom',
      bendPoints: [{ x: 160, y: 240 }],
    })

    const clearedProject = updateConnectionRoute(
      routedProject,
      result.ok ? result.connection.id : 'missing',
      {},
    )

    expect(clearedProject.connections[0].route).toBeUndefined()
  })
})

describe('archived inventory domain guards', () => {
  it('does not create or preview placements for archived canvas equipment', () => {
    const base = mergeInventoryWithProject([
      archived({ id: 'server-archived', name: 'Archived Server', type: 'server' }),
      { id: 'server-active', name: 'Active Server', type: 'server' },
    ], null)
    const archivedPlacement = { serverId: 'server-archived', x: 0, y: 0 }
    const activePlacement = { serverId: 'server-active', x: 400, y: 0 }

    expect(getNonCollidingPlacement(base, archivedPlacement)).toBeNull()
    expect(upsertPlacement(base, archivedPlacement)).toBe(base)
    expect(upsertPlacements(base, [activePlacement, archivedPlacement])).toBe(base)
  })

  it('rejects connections whose direct host is archived', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    project.items['server-display'] = archived(project.items['server-display'])

    expect(validateConnection(
      project,
      { itemId: 'server-display', portId: 'lan-01' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )).toEqual({ ok: false, message: 'One of the selected ports is no longer available.' })
  })

  it('rejects connections whose assigned expansion card is archived', () => {
    const assigned = assignComponent(
      mergeInventoryWithProject(connectionInventory, null),
      'server-display',
      'nic-quad',
    )
    const project: ProjectState = {
      ...assigned,
      items: {
        ...assigned.items,
        'nic-quad': archived(assigned.items['nic-quad']),
      },
    }

    expect(validateConnection(
      project,
      { itemId: 'server-display', hostedItemId: 'nic-quad', portId: 'rj45-01' },
      { itemId: 'patch-rj45', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )).toEqual({ ok: false, message: 'One of the selected ports is no longer available.' })
  })
})
