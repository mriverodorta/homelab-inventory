import { describe, expect, it } from 'vitest'
import {
  getCompatibleDestinationGroups,
  getEndpointGroupForHost,
  getHostEndpointGroups,
} from '@/lib/connection-endpoints'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function archived(item: InventoryItem): InventoryItem {
  return {
    ...item,
    archivedAt: '2026-07-19T12:00:00.000Z',
  }
}

function port(
  id: string,
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
  id: 'server-a',
  name: 'Server A',
  type: 'server',
  ports: [port('board-rj45', 'rj45', 1, '1G'), port('board-dp', 'displayport', 2)],
}

const nic: InventoryItem = {
  id: 'nic-a',
  name: 'Intel I350-T4',
  type: 'network',
  ports: [port('nic-rj45-1', 'rj45', 1, '1G'), port('nic-rj45-2', 'rj45', 2, '1G')],
}

const gpu: InventoryItem = {
  id: 'gpu-a',
  name: 'AMD Radeon RX 640',
  type: 'gpu',
  ports: [port('gpu-mdp-1', 'mini-displayport', 1)],
}

const unassignedNic: InventoryItem = {
  id: 'nic-loose',
  name: 'Loose NIC',
  type: 'network',
  ports: [port('loose-rj45', 'rj45', 1, '2.5G')],
}

const unassignedGpu: InventoryItem = {
  id: 'gpu-loose',
  name: 'Loose GPU',
  type: 'gpu',
  ports: [port('loose-dp', 'displayport', 1)],
}

const switchItem: InventoryItem = {
  id: 'switch-a',
  name: 'Switch A',
  type: 'switch',
  ports: [
    { ...port('switch-rj45-1', 'rj45', 1, '2.5G'), kind: 'switch-port' },
    { ...port('switch-rj45-2', 'rj45', 2, '2.5G'), kind: 'switch-port' },
  ],
}

const patchPanel: InventoryItem = {
  id: 'patch-a',
  name: 'Patch Panel A',
  type: 'patchPanel',
  ports: [{
    id: 'keystone-7',
    kind: 'keystone',
    type: 'rj45',
    slotNumber: 7,
    endpoints: [
      { id: 'keystone-7-front', side: 'front' },
      { id: 'keystone-7-back', side: 'back' },
    ],
  }],
}

function makeProject(): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Test', version: 1, updatedAt: '2026-07-13T00:00:00.000Z' },
    items: {
      'server-a': server,
      'nic-a': nic,
      'gpu-a': gpu,
      'nic-loose': unassignedNic,
      'gpu-loose': unassignedGpu,
      'switch-a': switchItem,
      'patch-a': patchPanel,
    },
    placements: [
      { serverId: 'server-a', x: 0, y: 0 },
      { serverId: 'switch-a', x: 400, y: 0 },
      { serverId: 'patch-a', x: 800, y: 0 },
    ],
    assignments: [
      { id: 1, serverId: 'server-a', itemId: 'nic-a', type: 'network', assignedAt: '2026-07-13T00:00:00.000Z' },
      { id: 2, serverId: 'server-a', itemId: 'gpu-a', type: 'gpu', assignedAt: '2026-07-13T00:00:00.000Z' },
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
      itemId: 'server-a',
      hostedItemId: 'nic-a',
      portId: 'nic-rj45-1',
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
    project.items['switch-a'] = archived(project.items['switch-a'])
    project.items['nic-a'] = archived(project.items['nic-a'])

    expect(getHostEndpointGroups(project).map((group) => group.label)).toEqual([
      'Patch Panel A',
      'Server A',
    ])
    expect(getEndpointGroupForHost(project, project.items['server-a'])?.options.map((option) => option.owner.name)).toEqual([
      'Server A',
      'Server A',
      'AMD Radeon RX 640',
    ])
    expect(getEndpointGroupForHost(project, project.items['switch-a'])).toBeNull()
  })

  it('labels patch-panel front and back endpoints independently', () => {
    const group = getEndpointGroupForHost(makeProject(), patchPanel)

    expect(group?.options.map((option) => option.label)).toEqual([
      'Port 07 / Front / RJ45',
      'Port 07 / Back / RJ45',
    ])
  })

  it('keeps only compatible open endpoints and actionable hosts', () => {
    const project = makeProject()
    project.connections = [{
      id: 1,
      type: 'network',
      createdAt: '2026-07-13T00:00:00.000Z',
      from: { itemId: 'switch-a', portId: 'switch-rj45-1' },
      to: { itemId: 'patch-a', portId: 'keystone-7', endpointId: 'keystone-7-front' },
    }]
    const sourceGroup = getEndpointGroupForHost(project, server)
    const networkSource = sourceGroup?.options.find((option) => option.label === 'Board / RJ45 01 / 1G')
    const displaySource = sourceGroup?.options.find((option) => option.label === 'Board / DP 02')

    expect(networkSource).toBeDefined()
    expect(displaySource).toBeDefined()

    const networkGroups = getCompatibleDestinationGroups(project, networkSource!)
    expect(networkGroups.map((group) => group.label)).toEqual(['Patch Panel A', 'Switch A'])
    expect(networkGroups.find((group) => group.label === 'Switch A')?.options.map((option) => option.label)).toEqual([
      'Port 02 / RJ45 / 2.5G',
    ])
    expect(networkGroups.find((group) => group.label === 'Patch Panel A')?.options.map((option) => option.label)).toEqual([
      'Port 07 / Back / RJ45',
    ])

    expect(getCompatibleDestinationGroups(project, displaySource!)).toEqual([])
  })

  it('does not expose archived compatible destinations', () => {
    const project = makeProject()
    project.items['switch-a'] = archived(project.items['switch-a'])
    const source = getEndpointGroupForHost(project, project.items['server-a'])?.options[0]

    expect(source).toBeDefined()
    expect(getCompatibleDestinationGroups(project, source!).map((group) => group.label)).toEqual([
      'Patch Panel A',
    ])
  })
})
