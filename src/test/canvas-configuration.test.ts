import { describe, expect, it } from 'vitest'
import { copyCanvasHostConfiguration } from '@/lib/canvas-configuration'
import { createEmptyProject } from '@/lib/project'
import type { ComponentAssignment, InventoryConnection, InventoryItem, ProjectState } from '@/types/inventory'

const host: InventoryItem = {
  id: 7,
  inventoryId: 48,
  key: 'server:7',
  type: 'server',
  name: 'Shared host',
  compatibility: { host: { memory: { slots: 2, generations: ['DDR4'] } } },
  fixedComponents: [{
    id: 1,
    componentType: 'cpu',
    disposition: 'soldered',
    label: 'Fixed processor',
    item: { type: 'cpu', name: 'Soldered CPU' },
  }],
}

const secondHost: InventoryItem = {
  id: 8,
  inventoryId: 49,
  key: 'server:8',
  type: 'server',
  name: 'Second host',
  compatibility: { host: { memory: { slots: 2, generations: ['DDR4'] } } },
}

const memory: InventoryItem = {
  id: 2,
  inventoryId: 98,
  key: 'ram:2',
  type: 'ram',
  name: '16GB DDR4',
  specs: { capacityGb: 16, generation: 'DDR4' },
}

const alternativeMemory: InventoryItem = {
  id: 3,
  inventoryId: 99,
  key: 'ram:3',
  type: 'ram',
  name: 'Other DDR4',
  specs: { capacityGb: 16, generation: 'DDR4' },
}

const assignment: ComponentAssignment = {
  id: 12,
  serverId: 'server:7',
  itemId: 'ram:2',
  type: 'ram',
  assignedAt: '2026-08-25T00:00:00.000Z',
  allocation: { resourceType: 'memory', positions: [0] },
}

const connection: InventoryConnection = {
  id: 27,
  type: 'network',
  createdAt: '2026-08-25T00:00:00.000Z',
  from: { itemId: 'server:7', portId: 1 },
  to: { itemId: 'server:8', portId: 1 },
  route: { sourceSide: 'right', bendPoints: [{ x: 120, y: 84 }] },
}

function project(workspaceId: number, changes: Partial<ProjectState> = {}): ProjectState {
  const value = createEmptyProject([host, secondHost, memory, alternativeMemory])
  return {
    ...value,
    metadata: { ...value.metadata, projectId: 1, workspaceId },
    placements: [
      { serverId: 'server:7', x: 24, y: 36 },
      { serverId: 'server:8', x: 420, y: 36 },
    ],
    nextAssignmentId: 70,
    nextConnectionId: 90,
    ...changes,
  }
}

describe('cross-canvas host configuration copying', () => {
  it('copies the same physical components and slots using independent assignment identities', () => {
    const source = project(2, { assignments: [assignment] })
    const destination = project(3)

    const result = copyCanvasHostConfiguration({ source, destination, hostId: 'server:7' })

    expect(result.copiedAssignmentCount).toBe(1)
    expect(result.project.assignments).toEqual([expect.objectContaining({
      id: 70,
      serverId: 'server:7',
      itemId: 'ram:2',
      allocation: { resourceType: 'memory', positions: [0] },
    })])
    expect(result.project.items['server:7'].fixedComponents).toEqual(host.fixedComponents)
    expect(result.project.assignments.every((item) => item.type !== 'cpu')).toBe(true)
    expect(source.assignments).toEqual([assignment])
    expect(destination.assignments).toEqual([])
  })

  it('places the same physical host on an empty destination canvas before copying its configuration', () => {
    const source = project(2, { assignments: [assignment] })
    const destination = project(3, { placements: [] })

    const result = copyCanvasHostConfiguration({ source, destination, hostId: 'server:7' })

    expect(result.placedHost).toBe(true)
    expect(result.project.placements).toEqual([{ serverId: 'server:7', x: 24, y: 36 }])
    expect(result.project.assignments).toEqual([expect.objectContaining({
      id: 70,
      serverId: 'server:7',
      itemId: 'ram:2',
    })])
    expect(destination.placements).toEqual([])
    expect(source.placements).toHaveLength(2)
    expect(result.project.items['server:7'].inventoryId).toBe(host.inventoryId)
  })

  it('retains an existing destination placement and avoids occupied positions for new placements', () => {
    const source = project(2, { assignments: [assignment] })
    const existing = copyCanvasHostConfiguration({
      source,
      destination: project(3, { placements: [{ serverId: 'server:7', x: 960, y: 72 }] }),
      hostId: 'server:7',
    })
    expect(existing.placedHost).toBe(false)
    expect(existing.project.placements).toEqual([{ serverId: 'server:7', x: 960, y: 72 }])

    const occupied = copyCanvasHostConfiguration({
      source,
      destination: project(3, { placements: [{ serverId: 'server:8', x: 24, y: 36 }] }),
      hostId: 'server:7',
    })
    const placed = occupied.project.placements.find(({ serverId }) => serverId === 'server:7')
    expect(occupied.placedHost).toBe(true)
    expect(placed).toBeDefined()
    expect(placed).not.toMatchObject({ x: 24, y: 36 })
  })

  it('rejects occupied destination slots without changing either canvas', () => {
    const existing: ComponentAssignment = { ...assignment, id: 45, itemId: 'ram:3' }
    const source = project(2, { assignments: [assignment] })
    const destination = project(3, { assignments: [existing] })

    expect(() => copyCanvasHostConfiguration({ source, destination, hostId: 'server:7' }))
      .toThrow(/slot.*already occupied/iu)
    expect(destination.assignments).toEqual([existing])
    expect(source.assignments).toEqual([assignment])
  })

  it('rejects physical components already installed in another destination host', () => {
    const source = project(2, { assignments: [assignment] })
    const existing = { ...assignment, id: 45, serverId: 'server:8' }
    const destination = project(3, { assignments: [existing] })

    expect(() => copyCanvasHostConfiguration({ source, destination, hostId: 'server:7' }))
      .toThrow(/already installed in another host/iu)
    expect(destination.assignments).toEqual([existing])
  })

  it('rejects a matching physical component installed in a different destination slot', () => {
    const source = project(2, { assignments: [assignment] })
    const existing: ComponentAssignment = {
      ...assignment,
      id: 45,
      allocation: { resourceType: 'memory', positions: [1] },
    }
    const destination = project(3, { assignments: [existing] })

    expect(() => copyCanvasHostConfiguration({ source, destination, hostId: 'server:7' }))
      .toThrow(/already installed in a different slot/iu)
    expect(destination.assignments).toEqual([existing])
  })

  it('copies eligible connections and preserves manual bends only for matching placements', () => {
    const source = project(2, { connections: [connection] })
    const matching = copyCanvasHostConfiguration({
      source,
      destination: project(3),
      hostId: 'server:7',
      includeComponents: false,
      includeConnections: true,
    })
    expect(matching.project.connections).toEqual([expect.objectContaining({
      id: 90,
      route: { sourceSide: 'right', bendPoints: [{ x: 120, y: 84 }] },
    })])

    const relocated = copyCanvasHostConfiguration({
      source,
      destination: project(3, { placements: [
        { serverId: 'server:7', x: 48, y: 36 },
        { serverId: 'server:8', x: 420, y: 36 },
      ] }),
      hostId: 'server:7',
      includeComponents: false,
      includeConnections: true,
    })
    expect(relocated.project.connections[0].route).toEqual({ sourceSide: 'right' })
  })

  it('reports unavailable cable endpoints and occupied destination ports', () => {
    const source = project(2, { connections: [connection] })
    const missing = copyCanvasHostConfiguration({
      source,
      destination: project(3, { placements: [{ serverId: 'server:7', x: 24, y: 36 }] }),
      hostId: 'server:7',
      includeComponents: false,
      includeConnections: true,
    })
    expect(missing.unavailableConnections).toEqual([{ id: 27, reason: 'The other endpoint is not present on this canvas.' }])

    const occupied = copyCanvasHostConfiguration({
      source,
      destination: project(3, { connections: [{ ...connection, id: 45, to: { itemId: 'server:8', portId: 2 } }] }),
      hostId: 'server:7',
      includeComponents: false,
      includeConnections: true,
    })
    expect(occupied.unavailableConnections).toEqual([{ id: 27, reason: 'One of the destination ports is already connected.' }])
    expect(occupied.project.connections).toHaveLength(1)
  })

  it('rejects different projects, mismatched host identities, or an absent source placement', () => {
    const source = project(2)
    const wrongProject = project(3)
    wrongProject.metadata.projectId = 2
    expect(() => copyCanvasHostConfiguration({ source, destination: wrongProject, hostId: 'server:7' }))
      .toThrow(/same project/iu)

    const mismatched = project(3)
    mismatched.items['server:7'] = { ...host, inventoryId: 500 }
    expect(() => copyCanvasHostConfiguration({ source, destination: mismatched, hostId: 'server:7' }))
      .toThrow(/same physical host/iu)

    expect(() => copyCanvasHostConfiguration({
      source: project(2, { placements: [] }),
      destination: project(3),
      hostId: 'server:7',
    })).toThrow(/source canvas/iu)

    expect(() => copyCanvasHostConfiguration({ source, destination: project(2), hostId: 'server:7' }))
      .toThrow(/different destination canvas/iu)
  })
})
