import { describe, expect, it } from 'vitest'
import {
  getEndpointGroupForHost,
  getHostEndpointGroups,
} from '@/lib/connection-endpoints'
import { topologyQueryFixture } from '@/test/topology-query-fixture'
import type { InventoryItem, ProjectState } from '@/types/inventory'
import { migrateSchema10To11 } from '../../server/db/migrate-schema-11.mjs'
import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'

function archived(item: InventoryItem): InventoryItem {
  return {
    ...item,
    archivedAt: '2026-07-19T12:00:00.000Z',
  }
}

function port(
  id: number,
  type: 'rj45' | 'displayport' | 'mini-displayport',
  slotNumber: number,
  speed?: string,
) {
  return {
    id,
    kind: 'server-port' as const,
    type,
    slotNumber,
    ...(speed ? { speed } : {}),
  }
}

const server: InventoryItem = {
  id: 1,
  key: 'server:1',
  name: 'Server A',
  type: 'server',
  ports: [port(1, 'rj45', 1, '1G'), port(2, 'displayport', 2)],
}

const nic: InventoryItem = {
  id: 1,
  key: 'network:1',
  name: 'Intel I350-T4',
  type: 'network',
  ports: [port(1, 'rj45', 1, '1G'), port(2, 'rj45', 2, '1G')],
}

const gpu: InventoryItem = {
  id: 1,
  key: 'gpu:1',
  name: 'AMD Radeon RX 640',
  type: 'gpu',
  ports: [port(1, 'mini-displayport', 1)],
}

const unassignedNic: InventoryItem = {
  id: 2,
  key: 'network:2',
  name: 'Loose NIC',
  type: 'network',
  ports: [port(1, 'rj45', 1, '2.5G')],
}

const unassignedGpu: InventoryItem = {
  id: 2,
  key: 'gpu:2',
  name: 'Loose GPU',
  type: 'gpu',
  ports: [port(1, 'displayport', 1)],
}

const switchItem: InventoryItem = {
  id: 1,
  key: 'switch:1',
  name: 'Switch A',
  type: 'switch',
  ports: [
    { ...port(1, 'rj45', 1, '2.5G'), kind: 'switch-port' },
    { ...port(2, 'rj45', 2, '2.5G'), kind: 'switch-port' },
  ],
}

const patchPanel: InventoryItem = {
  id: 1,
  key: 'patchPanel:1',
  name: 'Patch Panel A',
  type: 'patchPanel',
  ports: [{
    id: 1,
    kind: 'keystone',
    type: 'rj45',
    slotNumber: 7,
    endpoints: [
      { id: 1, side: 'front' },
      { id: 2, side: 'back' },
    ],
  }],
}

function makeProject(): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Test', version: 1, updatedAt: '2026-07-13T00:00:00.000Z' },
    items: {
      'server:1': server,
      'network:1': nic,
      'gpu:1': gpu,
      'network:2': unassignedNic,
      'gpu:2': unassignedGpu,
      'switch:1': switchItem,
      'patchPanel:1': patchPanel,
    },
    placements: [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'switch:1', x: 400, y: 0 },
      { serverId: 'patchPanel:1', x: 800, y: 0 },
    ],
    assignments: [
      { id: 1, serverId: 'server:1', itemId: 'network:1', type: 'network', assignedAt: '2026-07-13T00:00:00.000Z' },
      { id: 2, serverId: 'server:1', itemId: 'gpu:1', type: 'gpu', assignedAt: '2026-07-13T00:00:00.000Z' },
    ],
    connections: [],
  }
}

describe('connection endpoint catalog', () => {
  it('groups board and assigned component ports beneath their host', () => {
    const project = makeProject()
    const group = getEndpointGroupForHost(project, server)

    expect(group?.options.map((option) => option.label)).toEqual([
      'Board / RJ45 01 / 1G',
      'Board / DP 02',
      'Intel I350-T4 / RJ45 01 / 1G',
      'Intel I350-T4 / RJ45 02 / 1G',
      'AMD Radeon RX 640 / MiniDP 01',
    ])
    expect(group?.options[2].endpoint).toEqual({
      itemId: 'server:1',
      hostedItemId: 'network:1',
      portId: 1,
    })
  })

  it('excludes unassigned expansion cards from canvas host groups', () => {
    const groupLabels = getHostEndpointGroups(makeProject()).map((group) => group.label)

    expect(groupLabels).toEqual(['Patch Panel A', 'Server A', 'Switch A'])
    expect(groupLabels).not.toContain('Loose NIC')
    expect(groupLabels).not.toContain('Loose GPU')
  })

  it('excludes archived hosts and archived assigned cards from endpoint groups', () => {
    const project = makeProject()
    project.items['switch:1'] = archived(project.items['switch:1'])
    project.items['network:1'] = archived(project.items['network:1'])

    expect(getHostEndpointGroups(project).map((group) => group.label)).toEqual([
      'Patch Panel A',
      'Server A',
    ])
    expect(getEndpointGroupForHost(project, project.items['server:1'])?.options.map((option) => option.owner.name)).toEqual([
      'Server A',
      'Server A',
      'AMD Radeon RX 640',
    ])
    expect(getEndpointGroupForHost(project, project.items['switch:1'])).toBeNull()
  })

  it('labels patch-panel front and back endpoints independently', () => {
    const group = getEndpointGroupForHost(makeProject(), patchPanel)

    expect(group?.options.map((option) => option.label)).toEqual([
      'Port 07 / Front / RJ45',
      'Port 07 / Back / RJ45',
    ])
  })

  it('presents engine-owned power endpoints beneath their canvas hosts', () => {
    const project = makeProject()
    const ups = withCanonicalPowerPorts({
      id: 1,
      key: 'ups:1',
      name: 'UPS A',
      type: 'ups',
      specs: { outlets: 2, batteryBackupOutlets: 2, surgeProtectedOutlets: 0 },
    } satisfies InventoryItem)
    const monitor = withCanonicalPowerPorts({
      id: 1,
      key: 'monitor:1',
      name: 'Monitor A',
      type: 'monitor',
    } satisfies InventoryItem)
    const powerStrip = withCanonicalPowerPorts({
      id: 1,
      key: 'powerStrip:1',
      name: 'Strip A',
      type: 'powerStrip',
      specs: { outlets: 4 },
    } satisfies InventoryItem)
    project.items['ups:1'] = ups
    project.items['monitor:1'] = monitor
    project.items['powerStrip:1'] = powerStrip
    project.placements.push(
      { serverId: 'ups:1', x: 0, y: 400 },
      { serverId: 'monitor:1', x: 400, y: 400 },
      { serverId: 'powerStrip:1', x: 800, y: 400 },
    )

    const powerEndpoints = topologyQueryFixture(project).power.endpoints
    const upsGroup = getEndpointGroupForHost(project, ups, powerEndpoints)
    const monitorGroup = getEndpointGroupForHost(project, monitor, powerEndpoints)
    const stripGroup = getEndpointGroupForHost(project, powerStrip, powerEndpoints)
    const upsPowerOptions = upsGroup?.options.filter((option) => option.powerEndpoint)
    const monitorPowerOptions = monitorGroup?.options.filter((option) => option.powerEndpoint)
    const stripPowerOptions = stripGroup?.options.filter((option) => option.powerEndpoint)
    expect(upsPowerOptions?.map((option) => option.endpoint.portId)).toEqual([1, 2])
    expect(monitorPowerOptions?.map((option) => option.endpoint.portId)).toEqual([1])
    expect(stripPowerOptions?.map((option) => option.endpoint.portId)).toEqual([
      1,
      2,
      3,
      4,
      5,
    ])

  })

  it('includes a power-strip input for a migrated schema-10 UPS battery outlet', () => {
    const migrated = migrateSchema10To11({
      upsSystems: [{
        id: 1,
        name: 'CyberPower CP1500PFCLCD',
        specs: {
          outlets: 10,
          batteryBackupOutlets: 5,
          surgeProtectedOutlets: 5,
        },
      }],
      powerStrips: [withCanonicalPowerPorts({
        id: 1,
        name: 'Kasa HS300',
        type: 'powerStrip',
        specs: { outlets: 6, surgeProtectedOutlets: 6 },
      })],
    })
    const ups = {
      ...migrated.upsSystems[0],
      key: 'ups:1',
      type: 'ups',
    } satisfies InventoryItem
    const powerStrip = {
      ...migrated.powerStrips[0],
      key: 'powerStrip:1',
      type: 'powerStrip',
    } satisfies InventoryItem
    const project = makeProject()
    project.items['ups:1'] = ups
    project.items['powerStrip:1'] = powerStrip
    project.placements.push(
      { serverId: 'ups:1', x: 0, y: 400 },
      { serverId: 'powerStrip:1', x: 400, y: 400 },
    )

    const powerEndpoints = topologyQueryFixture(project).power.endpoints
    const batteryOutlet = getEndpointGroupForHost(project, ups, powerEndpoints)?.options.find(
      (option) => option.endpoint.portId === 1 && option.powerEndpoint?.direction === 'output',
    )

    expect(batteryOutlet).toMatchObject({
      endpoint: { itemId: 'ups:1', portId: 1 },
      powerEndpoint: { direction: 'output' },
    })
    expect(getEndpointGroupForHost(project, powerStrip, powerEndpoints)?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint: { itemId: 'powerStrip:1', portId: 1 },
          powerEndpoint: expect.objectContaining({ direction: 'input' }),
        }),
      ]),
    )
  })
})
