import { describe, expect, it } from 'vitest'
import { assignComponent } from '@/lib/constraints'
import { mergeInventoryWithProject } from '@/lib/inventory'
import {
  autoArrangeCanvasItems,
  createConnection,
  getCanvasItemHeight,
  getCanvasItemWidth,
  getNonCollidingPlacement,
  placementCollides,
  placementsCollide,
  removeConnection,
  SERVER_CARD_COLLISION_GAP,
  SERVER_CARD_WIDTH,
  updateConnectionLabel,
  updateConnectionRoute,
  upsertPlacements,
  upsertPlacement,
  validateConnection,
} from '@/lib/project'
import type { InventoryItem } from '@/types/inventory'

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
