import { describe, expect, it } from 'vitest'
import { assignComponent } from '@/lib/constraints'
import {
  createEmptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from '@/lib/history'
import { mergeInventoryWithProject } from '@/lib/inventory'
import {
  applyInventoryItemInput,
  autoArrangeCanvasItems,
  createConnection,
  getCanvasItemHeight,
  getCanvasItemWidth,
  getNonCollidingPlacement,
  getReturnCanvasItemImpact,
  MONITOR_CARD_WIDTH,
  PC_BUILD_CARD_WIDTH,
  placementCollides,
  placementsCollide,
  POWER_EQUIPMENT_CARD_WIDTH,
  returnCanvasItemToInventory,
  removeConnection,
  SERVER_CARD_COLLISION_GAP,
  SERVER_CARD_WIDTH,
  updateConnectionLabel,
  updateConnectionRoute,
  upsertPlacements,
  upsertPlacement,
  validateConnection,
  VERTICAL_POWER_STRIP_CARD_WIDTH,
  VERTICAL_UPS_CARD_WIDTH,
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
  { id: 1, name: 'Server A', type: 'server' },
  { id: 2, name: 'Server B', type: 'server' },
  { id: 1, name: 'GPU A', type: 'gpu' },
  {
    id: 1,
    name: 'Patch Panel A',
    type: 'patchPanel',
    ports: Array.from({ length: 24 }, (_, index) => ({
      id: index + 1,
      kind: 'keystone',
      type: 'rj45',
      slotNumber: index + 1,
      endpoints: [
        { id: 1, side: 'back' },
        { id: 2, side: 'front' },
      ],
    })),
  },
  {
    id: 1,
    name: 'Switch A',
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

const newCanvasEquipmentInventory: InventoryItem[] = [
  {
    id: 1,
    name: 'PC Build A',
    type: 'pcBuild',
    specs: { operatingSystem: 'Linux' },
  },
  {
    id: 1,
    name: 'Motherboard A',
    type: 'motherboard',
    ports: [
      { id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '2.5G' },
    ],
  },
  {
    id: 1,
    name: 'GPU with ports',
    type: 'gpu',
    ports: [
      { id: 1, kind: 'server-port', type: 'displayport', slotNumber: 1 },
    ],
  },
  {
    id: 1,
    name: 'Monitor A',
    type: 'monitor',
    ports: [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        kind: 'server-port' as const,
        type: 'displayport' as const,
        slotNumber: index + 1,
      })),
      {
        id: 7,
        key: 'ac-input',
        kind: 'power-port',
        type: 'ac-input',
        slotNumber: 1,
      },
    ],
  },
  {
    id: 1,
    name: 'UPS A',
    type: 'ups',
    specs: { outlets: 12, batteryBackupOutlets: 6, surgeProtectedOutlets: 6 },
  },
  {
    id: 1,
    name: 'Power Strip A',
    type: 'powerStrip',
    specs: { outlets: 12 },
  },
]

const connectionInventory: InventoryItem[] = [
  {
    id: 1,
    name: 'Display Server',
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
    name: 'RJ45 Patch Panel',
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
  },
  {
    id: 2,
    name: 'HDMI Patch Panel',
    type: 'patchPanel',
    ports: [
      {
        id: 1,
        kind: 'keystone',
        type: 'hdmi',
        slotNumber: 1,
        endpoints: [
          { id: 1, side: 'front' },
          { id: 2, side: 'back' },
        ],
      },
    ],
  },
  {
    id: 1,
    name: 'Quad NIC',
    type: 'network',
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
      id: 1,
      serverId: 'server:7',
      itemId: 'cpu:8',
      type: 'cpu' as const,
      assignedAt: '2026-07-14T12:00:00.000Z',
    }
    const connection = {
      id: 1,
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
            { id: 1, kind: 'server-port', type: 'displayport', slotNumber: 1 },
            { id: 2, kind: 'server-port', type: 'displayport', slotNumber: 2 },
          ],
        },
      },
      placements: [],
      assignments: [],
      connections: [{
        id: 1,
        from: { itemId: 'gpu:7', portId: 2 },
        to: { itemId: 'server:8', portId: 1 },
        type: 'display',
        createdAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    const input: InventoryItemInput = {
      type: 'gpu',
      name: 'GPU',
      ports: [{ id: 1, kind: 'server-port', type: 'displayport', slotNumber: 1 }],
    }

    expect(() => applyInventoryItemInput(project, 'gpu:7', input)).toThrow(/connected port 2/i)
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
            { id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1 },
            { id: 2, kind: 'server-port', type: 'rj45', slotNumber: 2 },
          ],
        },
      },
      placements: [],
      assignments: [{
        id: 1,
        serverId: 'server:7',
        itemId: 'network:8',
        type: 'network',
        assignedAt: '2026-07-14T12:00:00.000Z',
      }],
      connections: [{
        id: 1,
        from: { itemId: 'switch:9', portId: 1 },
        to: { itemId: 'server:7', hostedItemId: 'network:8', portId: 2 },
        type: 'network',
        createdAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    const input: InventoryItemInput = {
      type: 'network',
      name: 'NIC',
      ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1 }],
    }

    expect(() => applyInventoryItemInput(project, 'network:8', input)).toThrow(/connected port 2/i)
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
            id: 1,
            kind: 'keystone',
            type: 'rj45',
            slotNumber: 1,
            endpoints: [
              { id: 1, side: 'front' },
              { id: 2, side: 'back' },
            ],
          }],
        },
      },
      placements: [],
      assignments: [],
      connections: [{
        id: 1,
        from: { itemId: 'patchPanel:7', portId: 1, endpointId: 2 },
        to: { itemId: 'switch:8', portId: 1 },
        type: 'network',
        createdAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    const input: InventoryItemInput = {
      type: 'patchPanel',
      name: 'Patch panel',
      ports: [{
        id: 1,
        kind: 'keystone',
        type: 'rj45',
        slotNumber: 1,
        endpoints: [{ id: 1, side: 'front' }],
      }],
    }

    expect(() => applyInventoryItemInput(project, 'patchPanel:7', input)).toThrow(
      /connected endpoint 2/i,
    )
  })
})

describe('server placement collisions', () => {
  it('rejects overlapping server placements', () => {
    const project = upsertPlacement(mergeInventoryWithProject(inventory, null), {
      serverId: 'server:1',
      x: 0,
      y: 0,
    })

    expect(getNonCollidingPlacement(project, { serverId: 'server:2', x: 96, y: 48 })).toBeNull()
  })

  it('allows separated server placements', () => {
    const project = upsertPlacement(mergeInventoryWithProject(inventory, null), {
      serverId: 'server:1',
      x: 0,
      y: 0,
    })
    const nextPlacement = {
      serverId: 'server:2',
      x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP,
      y: 0,
    }

    expect(getNonCollidingPlacement(project, nextPlacement)).toEqual(nextPlacement)
  })

  it('ignores a server colliding with its own saved placement while moving', () => {
    const project = upsertPlacement(mergeInventoryWithProject(inventory, null), {
      serverId: 'server:1',
      x: 0,
      y: 0,
    })

    expect(placementCollides(project, { serverId: 'server:1', x: 48, y: 48 })).toBe(false)
  })

  it('detects collisions caused by a server growing after component assignment', () => {
    const project = upsertPlacement(
      upsertPlacement(mergeInventoryWithProject(inventory, null), {
        serverId: 'server:1',
        x: 0,
        y: 0,
      }),
      {
        serverId: 'server:2',
        x: 0,
        y: 208,
      },
    )
    const expandedProject = assignComponent(project, 'server:1', 'gpu:1')
    const expandedPlacement = expandedProject.placements.find(
      (placement) => placement.serverId === 'server:1',
    )

    expect(expandedPlacement).toBeDefined()
    expect(placementCollides(expandedProject, expandedPlacement!)).toBe(true)
  })

  it('allows a selected group to move together without colliding with its own old positions', () => {
    const project = upsertPlacements(mergeInventoryWithProject(inventory, null), [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'server:2', x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP, y: 0 },
    ])
    const movedPlacements = [
      { serverId: 'server:1', x: 0, y: 24 },
      { serverId: 'server:2', x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP, y: 24 },
    ]

    expect(placementsCollide(project, movedPlacements)).toBe(false)
  })

  it('rejects a selected group move that intersects a non-selected canvas item', () => {
    const project = upsertPlacements(mergeInventoryWithProject(inventory, null), [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'server:2', x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP, y: 0 },
      { serverId: 'switch:1', x: 0, y: 220 },
    ])

    expect(placementsCollide(project, [
      { serverId: 'server:1', x: 0, y: 180 },
      { serverId: 'server:2', x: SERVER_CARD_WIDTH + SERVER_CARD_COLLISION_GAP, y: 180 },
    ])).toBe(true)
  })
})

describe('canvas item geometry', () => {
  it('sizes switches and patch panels from visible physical ports', () => {
    const project = mergeInventoryWithProject(inventory, null)

    expect(getCanvasItemWidth(project, 'switch:1')).toBeGreaterThan(SERVER_CARD_WIDTH)
    expect(getCanvasItemWidth(project, 'patchPanel:1')).toBeGreaterThan(getCanvasItemWidth(project, 'switch:1'))
    expect(getCanvasItemHeight(project, 'patchPanel:1')).toBeGreaterThan(getCanvasItemHeight(project, 'switch:1'))
  })

  it('uses the rendered widths for new canvas equipment', () => {
    const project = mergeInventoryWithProject(newCanvasEquipmentInventory, null)

    expect(getCanvasItemWidth(project, 'pcBuild:1')).toBe(PC_BUILD_CARD_WIDTH)
    expect(PC_BUILD_CARD_WIDTH).toBe(318)
    expect(getCanvasItemWidth(project, 'monitor:1')).toBe(MONITOR_CARD_WIDTH)
    expect(MONITOR_CARD_WIDTH).toBe(360)
    expect(getCanvasItemWidth(project, 'ups:1')).toBe(POWER_EQUIPMENT_CARD_WIDTH)
    expect(getCanvasItemWidth(project, 'powerStrip:1')).toBe(POWER_EQUIPMENT_CARD_WIDTH)
    expect(POWER_EQUIPMENT_CARD_WIDTH).toBe(420)
  })

  it('uses exact measured geometry for horizontal power strips', () => {
    const project = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const sixOutletProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        'powerStrip:1': {
          ...project.items['powerStrip:1'],
          specs: { outlets: 6 },
        },
      },
    }

    expect(getCanvasItemHeight(sixOutletProject, 'powerStrip:1')).toBe(219)
    expect(getCanvasItemHeight(project, 'powerStrip:1')).toBe(269)
  })

  it('uses exact measured geometry for a two-group horizontal UPS', () => {
    const project = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const tenOutletProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        'ups:1': {
          ...project.items['ups:1'],
          specs: {
            outlets: 10,
            batteryBackupOutlets: 6,
            surgeProtectedOutlets: 4,
          },
        },
      },
    }

    expect(getCanvasItemHeight(tenOutletProject, 'ups:1')).toBe(307)
  })

  it('uses narrow persisted widths for vertical power equipment', () => {
    const project = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const verticalProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        'ups:1': {
          ...project.items['ups:1'],
          properties: { canvasOrientation: 'vertical' },
        },
        'powerStrip:1': {
          ...project.items['powerStrip:1'],
          properties: { canvasOrientation: 'vertical' },
        },
      },
    }

    expect(getCanvasItemWidth(verticalProject, 'ups:1')).toBe(VERTICAL_UPS_CARD_WIDTH)
    expect(getCanvasItemWidth(verticalProject, 'powerStrip:1')).toBe(
      VERTICAL_POWER_STRIP_CARD_WIDTH,
    )
    expect(getCanvasItemHeight(verticalProject, 'ups:1')).toBe(461)
    expect(getCanvasItemHeight(verticalProject, 'powerStrip:1')).toBe(769)
  })

  it('does not count the power-strip AC input as a vertical outlet', () => {
    const project = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const outletPorts = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      kind: 'power-port' as const,
      type: 'ac-outlet' as const,
      slotNumber: index + 1,
    }))
    const verticalWithInput: ProjectState = {
      ...project,
      items: {
        ...project.items,
        'powerStrip:1': {
          ...project.items['powerStrip:1'],
          properties: { canvasOrientation: 'vertical' },
          ports: [
            { id: 7, kind: 'power-port', type: 'ac-input', slotNumber: 1 },
            ...outletPorts,
          ],
        },
      },
    }
    const verticalWithoutInput: ProjectState = {
      ...verticalWithInput,
      items: {
        ...verticalWithInput.items,
        'powerStrip:1': {
          ...verticalWithInput.items['powerStrip:1'],
          ports: outletPorts,
        },
      },
    }

    expect(getCanvasItemHeight(verticalWithInput, 'powerStrip:1')).toBe(
      getCanvasItemHeight(verticalWithoutInput, 'powerStrip:1'),
    )
  })

  it('grows PC build geometry for visible assignments, hosted ports, and the operating system', () => {
    const emptyProject = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const populatedProject: ProjectState = {
      ...emptyProject,
      assignments: [
        {
          id: 1,
          serverId: 'pcBuild:1',
          itemId: 'motherboard:1',
          type: 'motherboard',
          assignedAt: '2026-07-20T12:00:00.000Z',
        },
        {
          id: 2,
          serverId: 'pcBuild:1',
          itemId: 'gpu:1',
          type: 'gpu',
          assignedAt: '2026-07-20T12:00:00.000Z',
        },
      ],
    }
    const withoutOperatingSystem: ProjectState = {
      ...populatedProject,
      items: {
        ...populatedProject.items,
        'pcBuild:1': {
          ...populatedProject.items['pcBuild:1'],
          specs: {},
        },
      },
    }

    expect(getCanvasItemHeight(populatedProject, 'pcBuild:1')).toBeGreaterThan(
      getCanvasItemHeight(emptyProject, 'pcBuild:1'),
    )
    expect(getCanvasItemHeight(populatedProject, 'pcBuild:1')).toBeGreaterThan(
      getCanvasItemHeight(withoutOperatingSystem, 'pcBuild:1'),
    )
  })

  it('accounts for wrapped monitor and power-equipment port groups', () => {
    const project = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const compactProject: ProjectState = {
      ...project,
      items: {
        ...project.items,
        'monitor:1': {
          ...project.items['monitor:1'],
          ports: [
            ...(project.items['monitor:1'].ports?.slice(0, 2) ?? []),
            project.items['monitor:1'].ports?.at(-1),
          ].filter((port): port is NonNullable<typeof port> => Boolean(port)),
        },
        'powerStrip:1': {
          ...project.items['powerStrip:1'],
          specs: { outlets: 6 },
        },
      },
    }

    expect(getCanvasItemHeight(project, 'monitor:1')).toBe(357)
    expect(getCanvasItemHeight(compactProject, 'monitor:1')).toBe(307)
    expect(getCanvasItemHeight(project, 'powerStrip:1')).toBe(269)
    expect(getCanvasItemHeight(compactProject, 'powerStrip:1')).toBe(219)
    expect(getCanvasItemHeight(project, 'ups:1')).toBeGreaterThan(0)
  })

  it('prevents overlap using the new equipment dimensions', () => {
    const project = upsertPlacement(
      mergeInventoryWithProject(newCanvasEquipmentInventory, null),
      { serverId: 'pcBuild:1', x: 0, y: 0 },
    )

    expect(placementCollides(project, {
      serverId: 'monitor:1',
      x: PC_BUILD_CARD_WIDTH + SERVER_CARD_COLLISION_GAP - 1,
      y: 0,
    })).toBe(true)
    expect(placementCollides(project, {
      serverId: 'monitor:1',
      x: PC_BUILD_CARD_WIDTH + SERVER_CARD_COLLISION_GAP,
      y: 0,
    })).toBe(false)
  })

  it('uses vertical dimensions when rejecting power-equipment overlap', () => {
    const base = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const vertical: ProjectState = {
      ...base,
      items: {
        ...base.items,
        'powerStrip:1': {
          ...base.items['powerStrip:1'],
          properties: { canvasOrientation: 'vertical' },
        },
      },
      placements: [{ serverId: 'powerStrip:1', x: 0, y: 0 }],
    }

    expect(placementCollides(vertical, {
      serverId: 'monitor:1',
      x: VERTICAL_POWER_STRIP_CARD_WIDTH + SERVER_CARD_COLLISION_GAP - 1,
      y: 0,
    })).toBe(true)
    expect(placementCollides(vertical, {
      serverId: 'monitor:1',
      x: VERTICAL_POWER_STRIP_CARD_WIDTH + SERVER_CARD_COLLISION_GAP,
      y: 0,
    })).toBe(false)
  })
})

describe('canvas auto arrange', () => {
  it('places canvas equipment into server, patch panel, and switch columns', () => {
    const project = {
      ...mergeInventoryWithProject(inventory, null),
      placements: [
        { serverId: 'switch:1', x: 24, y: 48 },
        { serverId: 'server:1', x: 720, y: 96 },
        { serverId: 'patchPanel:1', x: 360, y: 144 },
      ],
    }
    const arranged = autoArrangeCanvasItems(project)

    expect(arranged.placements).toEqual([
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'patchPanel:1', x: 360, y: 0 },
      { serverId: 'switch:1', x: 1320, y: 0 },
    ])
  })

  it('arranges PC builds with hosts and stacks standalone equipment without overlap', () => {
    const project: ProjectState = {
      ...mergeInventoryWithProject(newCanvasEquipmentInventory, null),
      placements: [
        { serverId: 'ups:1', x: 0, y: 0 },
        { serverId: 'pcBuild:1', x: 0, y: 0 },
        { serverId: 'monitor:1', x: 0, y: 0 },
        { serverId: 'powerStrip:1', x: 0, y: 0 },
      ],
    }
    const arranged = autoArrangeCanvasItems(project)
    const pcBuildPlacement = arranged.placements.find(
      (placement) => placement.serverId === 'pcBuild:1',
    )
    const standalonePlacements = arranged.placements.filter(
      (placement) => placement.serverId !== 'pcBuild:1',
    )

    expect(pcBuildPlacement?.x).toBe(0)
    expect(new Set(standalonePlacements.map((placement) => placement.x)).size).toBe(1)
    expect(placementsCollide(arranged, arranged.placements)).toBe(false)
  })

  it('auto-arranges mixed power-equipment orientations without overlap', () => {
    const base = mergeInventoryWithProject(newCanvasEquipmentInventory, null)
    const project: ProjectState = {
      ...base,
      items: {
        ...base.items,
        'ups:1': {
          ...base.items['ups:1'],
          properties: { canvasOrientation: 'vertical' },
        },
      },
      placements: [
        { serverId: 'ups:1', x: 0, y: 0 },
        { serverId: 'powerStrip:1', x: 0, y: 0 },
      ],
    }
    const arranged = autoArrangeCanvasItems(project)

    expect(placementsCollide(arranged, arranged.placements)).toBe(false)
  })
})

describe('inventory connections', () => {
  it('allows displayport to hdmi connections for adapter cables', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server:1', portId: 2 },
      { itemId: 'patchPanel:2', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.connection.type : null).toBe('display')
  })

  it('allows rj45 connections to one side of a keystone', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.connection.type : null).toBe('network')
  })

  it('allows installed server network card ports to connect as hosted endpoints', () => {
    const project = assignComponent(
      mergeInventoryWithProject(connectionInventory, null),
      'server:1',
      'network:1',
    )
    const result = createConnection(
      project,
      { itemId: 'server:1', hostedItemId: 'network:1', portId: 2 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.connection.type : null).toBe('network')
  })

  it('classifies sfp plus switch links as network connections', () => {
    const project = mergeInventoryWithProject([
      {
        id: 1,
        name: 'Switch A',
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
        id: 2,
        name: 'Switch B',
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
    ], null)
    const result = createConnection(
      project,
      { itemId: 'switch:1', portId: 1 },
      { itemId: 'switch:2', portId: 1 },
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.connection.type : null).toBe('network')
  })

  it('rejects incompatible rj45 to hdmi connections', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)

    expect(
      validateConnection(
        project,
        { itemId: 'server:1', portId: 1 },
        { itemId: 'patchPanel:2', portId: 1, endpointId: 2 },
      ),
    ).toEqual({ ok: false, message: 'Those port types cannot be connected.' })
  })

  it('prevents two connections from using the same endpoint', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const first = createConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )

    expect(first.ok).toBe(true)

    const second = createConnection(
      first.ok ? first.project : project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
    )

    expect(second).toEqual({ ok: false, message: 'The source port is already connected.' })
  })

  it('removes saved connections by id', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)

    const nextProject = removeConnection(
      result.ok ? result.project : project,
      result.ok ? result.connection.id : 999,
    )

    expect(nextProject.connections).toEqual([])
  })

  it('updates saved connection labels', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)

    const nextProject = updateConnectionLabel(
      result.ok ? result.project : project,
      result.ok ? result.connection.id : 999,
      'LAN uplink',
    )

    expect(nextProject.connections[0].label).toBe('LAN uplink')
  })

  it('updates saved connection route preferences and clears empty route metadata', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    const result = createConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)

    const routedProject = updateConnectionRoute(
      result.ok ? result.project : project,
      result.ok ? result.connection.id : 999,
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
      result.ok ? result.connection.id : 999,
      {},
    )

    expect(clearedProject.connections[0].route).toBeUndefined()
  })
})

describe('archived inventory domain guards', () => {
  it('does not create or preview placements for archived canvas equipment', () => {
    const base = mergeInventoryWithProject([
      archived({ id: 1, name: 'Archived Server', type: 'server' }),
      { id: 2, name: 'Active Server', type: 'server' },
    ], null)
    const archivedPlacement = { serverId: 'server:1', x: 0, y: 0 }
    const activePlacement = { serverId: 'server:2', x: 400, y: 0 }

    expect(getNonCollidingPlacement(base, archivedPlacement)).toBeNull()
    expect(upsertPlacement(base, archivedPlacement)).toBe(base)
    expect(upsertPlacements(base, [activePlacement, archivedPlacement])).toBe(base)
  })

  it('rejects connections whose direct host is archived', () => {
    const project = mergeInventoryWithProject(connectionInventory, null)
    project.items['server:1'] = archived(project.items['server:1'])

    expect(validateConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )).toEqual({ ok: false, message: 'One of the selected ports is no longer available.' })
  })

  it('rejects connections whose assigned expansion card is archived', () => {
    const assigned = assignComponent(
      mergeInventoryWithProject(connectionInventory, null),
      'server:1',
      'network:1',
    )
    const project: ProjectState = {
      ...assigned,
      items: {
        ...assigned.items,
        'network:1': archived(assigned.items['network:1']),
      },
    }

    expect(validateConnection(
      project,
      { itemId: 'server:1', hostedItemId: 'network:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )).toEqual({ ok: false, message: 'One of the selected ports is no longer available.' })
  })
})

function createReturnCanvasItemProject(): ProjectState {
  return {
    id: 'default',
    metadata: {
      name: 'Inventory',
      version: 1,
      updatedAt: '2026-07-20T12:00:00.000Z',
    },
    items: {
      'server:1': { id: 1, key: 'server:1', type: 'server', name: 'Host server' },
      'switch:1': { id: 1, key: 'switch:1', type: 'switch', name: 'Switch' },
      'monitor:1': { id: 1, key: 'monitor:1', type: 'monitor', name: 'Monitor' },
      'server:2': { id: 2, key: 'server:2', type: 'server', name: 'Other server' },
      'network:1': { id: 1, key: 'network:1', type: 'network', name: 'Hosted NIC' },
      'gpu:1': { id: 1, key: 'gpu:1', type: 'gpu', name: 'Hosted GPU' },
      'network:2': { id: 2, key: 'network:2', type: 'network', name: 'Other NIC' },
    },
    placements: [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'switch:1', x: 400, y: 0 },
      { serverId: 'monitor:1', x: 800, y: 0 },
      { serverId: 'server:2', x: 0, y: 400 },
    ],
    assignments: [
      {
        id: 1,
        serverId: 'server:1',
        itemId: 'network:1',
        type: 'network',
        assignedAt: '2026-07-20T12:00:00.000Z',
      },
      {
        id: 2,
        serverId: 'server:1',
        itemId: 'gpu:1',
        type: 'gpu',
        assignedAt: '2026-07-20T12:00:00.000Z',
      },
      {
        id: 3,
        serverId: 'server:2',
        itemId: 'network:2',
        type: 'network',
        assignedAt: '2026-07-20T12:00:00.000Z',
      },
    ],
    connections: [
      {
        id: 1,
        from: {
          itemId: 'server:1',
          hostedItemId: 'network:1',
          portId: 1,
        },
        to: { itemId: 'switch:1', portId: 1 },
        type: 'network',
        createdAt: '2026-07-20T12:00:00.000Z',
      },
      {
        id: 2,
        from: {
          itemId: 'server:1',
          hostedItemId: 'gpu:1',
          portId: 1,
        },
        to: { itemId: 'monitor:1', portId: 1 },
        type: 'display',
        createdAt: '2026-07-20T12:00:00.000Z',
      },
      {
        id: 3,
        from: { itemId: 'server:1', portId: 1 },
        to: { itemId: 'switch:1', portId: 2 },
        type: 'network',
        createdAt: '2026-07-20T12:00:00.000Z',
      },
      {
        id: 4,
        from: {
          itemId: 'server:2',
          hostedItemId: 'network:2',
          portId: 1,
        },
        to: { itemId: 'switch:1', portId: 3 },
        type: 'network',
        createdAt: '2026-07-20T12:00:00.000Z',
      },
      {
        id: 5,
        from: {
          itemId: 'server:1',
          hostedItemId: 'network:stale',
          portId: 1,
        },
        to: { itemId: 'switch:1', portId: 4 },
        type: 'network',
        createdAt: '2026-07-20T12:00:00.000Z',
      },
    ],
  }
}

describe('returning canvas items to inventory', () => {
  it('reports and applies the complete host impact while preserving unrelated graph state', () => {
    const project = createReturnCanvasItemProject()

    expect(getReturnCanvasItemImpact(project, 'server:1')).toEqual({
      placementsRemoved: 1,
      assignmentsReleased: 2,
      connectionsRemoved: 4,
    })

    const result = returnCanvasItemToInventory(project, 'server:1')

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.impact).toEqual({
      placementsRemoved: 1,
      assignmentsReleased: 2,
      connectionsRemoved: 4,
    })
    expect(result.project.placements.map((placement) => placement.serverId)).toEqual([
      'switch:1',
      'monitor:1',
      'server:2',
    ])
    expect(result.project.assignments.map((assignment) => assignment.id)).toEqual([3])
    expect(result.project.connections.map((connection) => connection.id)).toEqual([4])
    expect(result.project.items).toEqual(project.items)
    expect(result.project.metadata.updatedAt).not.toBe(project.metadata.updatedAt)
  })

  it('returns a standalone canvas item and removes only its attached cable', () => {
    const project = createReturnCanvasItemProject()

    expect(getReturnCanvasItemImpact(project, 'monitor:1')).toEqual({
      placementsRemoved: 1,
      assignmentsReleased: 0,
      connectionsRemoved: 1,
    })

    const result = returnCanvasItemToInventory(project, 'monitor:1')

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.project.placements.some(
      (placement) => placement.serverId === 'monitor:1',
    )).toBe(false)
    expect(result.project.assignments).toEqual(project.assignments)
    expect(result.project.connections.map((connection) => connection.id)).toEqual([1, 3, 4, 5])
    expect(result.project.items['monitor:1']).toEqual(project.items['monitor:1'])
  })

  it('fails safely when the item is missing or no longer placed', () => {
    const project = createReturnCanvasItemProject()
    const expected = {
      ok: false,
      message: 'This item is no longer placed on the canvas.',
    }

    expect(getReturnCanvasItemImpact(project, 'network:1')).toBeNull()
    expect(returnCanvasItemToInventory(project, 'network:1')).toEqual(expected)
    expect(getReturnCanvasItemImpact(project, 'server:missing')).toBeNull()
    expect(returnCanvasItemToInventory(project, 'server:missing')).toEqual(expected)
  })

  it('restores the atomic return transition with one undo and redo snapshot', () => {
    const project = createReturnCanvasItemProject()
    const result = returnCanvasItemToInventory(project, 'server:1')

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const history = pushHistory(createEmptyHistory<ProjectState>(), project)
    const undo = undoHistory(history, result.project)

    expect(undo?.project).toEqual(project)
    expect(undo?.history.past).toEqual([])

    const redo = undo ? redoHistory(undo.history, undo.project) : null

    expect(redo?.project).toEqual(result.project)
    expect(redo?.history.past).toEqual([project])
  })
})
