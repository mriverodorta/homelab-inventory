import { describe, expect, it } from 'vitest'
import {
  moveAssignedComponent,
  swapAssignedComponent,
  tryAssignComponent,
} from '@/lib/constraints'
import type {
  ComponentAssignment,
  InventoryItem,
  ProjectState,
} from '@/types/inventory'

function host(
  key: string,
  overrides: InventoryItem['compatibility'] = {},
  type: 'server' | 'nas' = 'server',
): InventoryItem {
  return {
    id: Number(key.split(':')[1]),
    key,
    name: key,
    type,
    compatibility: {
      host: {
        cpu: { sockets: ['LGA1200'], generations: ['10'], maxTdpWatts: 65 },
        memory: {
          generations: ['DDR4'],
          slots: 2,
          maxCapacityGb: 64,
          maxModuleCapacityGb: 32,
          maxSpeedMt: 3200,
        },
        storageSlots: [{
          id: 'm2',
          label: 'M.2',
          count: 1,
          interfaces: ['NVMe'],
          formFactors: ['2280'],
          pcieGeneration: 4,
        }],
        expansionSlots: [{
          id: 'pcie',
          label: 'PCIe',
          count: 1,
          interfaceFamily: 'pcie',
          pcieGeneration: 4,
          mechanicalLanes: 16,
          electricalLanes: 16,
          acceptedHeights: ['low-profile'],
          maxSlotWidth: 1,
          maxPowerWatts: 75,
        }],
        ...overrides.host,
      },
    },
  }
}

function cpu(
  key: string,
  socket?: string,
  generation = '10',
): InventoryItem {
  return {
    id: Number(key.split(':')[1]),
    key,
    name: key,
    type: 'cpu',
    compatibility: {
      requirements: { cpu: { socket, generation, tdpWatts: 35 } },
    },
  }
}

function ram(key: string, generation = 'DDR4'): InventoryItem {
  return {
    id: Number(key.split(':')[1]),
    key,
    name: key,
    type: 'ram',
    specs: { capacityGb: 32, moduleCount: 2, generation, speedMt: 3600 },
  }
}

function storage(
  key: string,
  formFactor?: string,
  pcie = 'PCIe 4.0 x4',
): InventoryItem {
  return {
    id: Number(key.split(':')[1]),
    key,
    name: key,
    type: 'storage',
    specs: {
      interface: 'NVMe',
      ...(formFactor ? { formFactor } : {}),
      pcie,
    },
  }
}

function network(key: string): InventoryItem {
  return {
    id: Number(key.split(':')[1]),
    key,
    name: key,
    type: 'network',
    compatibility: {
      requirements: {
        expansion: {
          interfaceFamily: 'pcie',
          pcieGeneration: 4,
          connectorLanes: 1,
          minimumElectricalLanes: 1,
          height: 'low-profile',
          slotWidth: 1,
          powerWatts: 10,
        },
      },
    },
  }
}

function assignment(
  id: string | number,
  serverId: string,
  item: InventoryItem,
  assignedAt = '2026-07-19T12:00:00.000Z',
  allocation?: ComponentAssignment['allocation'],
): ComponentAssignment {
  return {
    id,
    serverId,
    itemId: item.key!,
    type: item.type as ComponentAssignment['type'],
    assignedAt,
    allocation,
  }
}

function project(
  hosts: InventoryItem[],
  components: InventoryItem[],
  assignments: ComponentAssignment[] = [],
): ProjectState {
  return {
    id: 'default',
    metadata: {
      name: 'Compatibility workflows',
      version: 1,
      updatedAt: '2026-07-19T00:00:00.000Z',
    },
    items: Object.fromEntries([...hosts, ...components].map((item) => [item.key!, item])),
    placements: hosts.map((item, index) => ({ serverId: item.key!, x: index * 400, y: 0 })),
    assignments,
    connections: [],
  }
}

describe('transactional compatibility workflows', () => {
  it('rejects a known incompatible CPU with the exact socket reason and preserves input', () => {
    const server = host('server:1')
    const incompatible = cpu('cpu:1', 'AM5', 'Zen 4')
    const input = project([server], [incompatible])
    const before = structuredClone(input)
    const beforeJson = JSON.stringify(input)

    const result = tryAssignComponent(input, server.key!, incompatible.key!)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('CPU socket AM5 is not supported by this host')
    expect(input).toEqual(before)
    expect(JSON.stringify(input)).toBe(beforeJson)
  })

  it('accepts an unknown CPU and exposes its unknown compatibility result', () => {
    const server = host('server:1')
    const unknown = cpu('cpu:1', undefined)
    const result = tryAssignComponent(project([server], [unknown]), server.key!, unknown.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.compatibility.some((entry) => entry.status === 'unknown')).toBe(true)
    expect(result.project.assignments).toHaveLength(1)
  })

  it('persists a successful allocation and warning-only negotiated matches', () => {
    const server = host('server:1', {
      host: {
        storageSlots: [{
          id: 'm2',
          label: 'M.2',
          count: 1,
          interfaces: ['NVMe'],
          formFactors: ['2280'],
          pcieGeneration: 3,
        }],
      },
    })
    const drive = storage('storage:1', '2280', 'PCIe 4.0 x4')
    const result = tryAssignComponent(project([server], [drive]), server.key!, drive.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.assignments[0].allocation).toEqual({
      resourceType: 'storage',
      groupId: 'm2',
      positions: [0],
    })
    expect(result.compatibility[0].findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'warning' })]),
    )
  })

  it('moves storage atomically, preserving identity while releasing source and reserving target', () => {
    const source = host('server:1')
    const target = host('server:2')
    const drive = storage('storage:1', '2280')
    const originalAssignment = assignment(1, source.key!, drive, undefined, {
      resourceType: 'storage',
      groupId: 'm2',
      positions: [0],
    })
    const input = project([source, target], [drive], [originalAssignment])

    const result = moveAssignedComponent(input, '1', target.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.assignments).toEqual([
      expect.objectContaining({
        id: 1,
        assignedAt: originalAssignment.assignedAt,
        serverId: target.key,
        itemId: drive.key,
        allocation: { resourceType: 'storage', groupId: 'm2', positions: [0] },
      }),
    ])
  })

  it('uses the resolved assignment rather than stale drag item or source host metadata', () => {
    const source = host('server:1')
    const target = host('server:2')
    const actual = storage('storage:1', '2280')
    const stale = storage('storage:2', '2280')
    const input = project([source, target], [actual, stale], [assignment(7, source.key!, actual)])

    const result = moveAssignedComponent(input, '7', target.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.assignments[0]).toEqual(
      expect.objectContaining({ itemId: actual.key, serverId: target.key }),
    )
  })

  it('keeps numeric and string assignment IDs distinct while allowing an unambiguous mixed lookup', () => {
    const source = host('server:1', {
      host: {
        storageSlots: [{ id: 'm2', label: 'M.2', count: 2, interfaces: ['NVMe'], formFactors: ['2280'] }],
      },
    })
    const target = host('server:2', {
      host: {
        storageSlots: [{ id: 'm2', label: 'M.2', count: 2, interfaces: ['NVMe'], formFactors: ['2280'] }],
      },
    })
    const first = storage('storage:1', '2280')
    const second = storage('storage:2', '2280')
    const ambiguous = project(
      [source, target],
      [first, second],
      [assignment(1, source.key!, first), assignment('1', source.key!, second)],
    )

    const exact = moveAssignedComponent(ambiguous, 1, target.key!)
    expect(exact.ok).toBe(true)
    if (!exact.ok) return
    expect(exact.project.assignments.find((entry) => entry.id === 1)?.serverId).toBe(target.key)
    expect(exact.project.assignments.find((entry) => entry.id === '1')?.serverId).toBe(source.key)

    const unambiguous = project([source, target], [first], [assignment(2, source.key!, first)])
    const mixed = moveAssignedComponent(unambiguous, '2', target.key!)
    expect(mixed.ok).toBe(true)
    if (!mixed.ok) return
    expect(mixed.project.assignments[0].id).toBe(2)
  })

  it('returns the original project for a same-host no-op', () => {
    const server = host('server:1')
    const drive = storage('storage:1', '2280')
    const input = project([server], [drive], [assignment(1, server.key!, drive)])
    const result = moveAssignedComponent(input, 1, server.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).toBe(input)
  })

  it('moves a CPU to an empty target while preserving identity and recalculating allocations', () => {
    const source = host('server:1')
    const target = host('server:2')
    const processor = cpu('cpu:1', 'LGA1200')
    const original = assignment(9, source.key!, processor, '2026-07-19T03:00:00.000Z')
    const input = project([source, target], [processor], [original])

    const result = moveAssignedComponent(input, '9', target.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.assignments).toEqual([
      expect.objectContaining({
        id: 9,
        itemId: processor.key,
        serverId: target.key,
        assignedAt: original.assignedAt,
      }),
    ])
    expect(result.project.assignments[0].allocation).toBeUndefined()
  })

  it('accepts unknown resource matches without fabricating an allocation', () => {
    const server = host('server:1')
    const drive = storage('storage:1', undefined)
    const result = tryAssignComponent(project([server], [drive]), server.key!, drive.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.compatibility[0].status).toBe('unknown')
    expect(result.project.assignments[0].allocation).toBeUndefined()
  })

  it('does not block a new compatible assignment for an unchanged legacy incompatibility', () => {
    const server = host('server:1', {
      host: {
        storageSlots: [{
          id: 'm2',
          label: 'M.2',
          count: 2,
          interfaces: ['NVMe'],
          formFactors: ['2280'],
        }],
      },
    })
    const legacy = storage('storage:1', '2230')
    const compatible = storage('storage:2', '2280')
    const input = project([server], [legacy, compatible], [assignment(1, server.key!, legacy)])

    const result = tryAssignComponent(input, server.key!, compatible.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.assignments.find((entry) => entry.itemId === compatible.key)?.allocation)
      .toEqual({ resourceType: 'storage', groupId: 'm2', positions: [0] })
  })

  it('rejects an incompatible CPU swap atomically when either resulting host fails', () => {
    const intelHost = host('server:1')
    const amdHost = host('server:2', {
      host: { cpu: { sockets: ['AM4'], generations: ['Zen 3'], maxTdpWatts: 65 } },
    })
    const intel = cpu('cpu:1', 'LGA1200', '10')
    const amd = cpu('cpu:2', 'AM4', 'Zen 3')
    const input = project(
      [intelHost, amdHost],
      [intel, amd],
      [assignment(1, intelHost.key!, intel), assignment(2, amdHost.key!, amd)],
    )
    const before = structuredClone(input)
    const beforeJson = JSON.stringify(input)

    const result = swapAssignedComponent(input, 1, amdHost.key!)

    expect(result.ok).toBe(false)
    expect(input).toEqual(before)
    expect(JSON.stringify(input)).toBe(beforeJson)
  })

  it('performs valid RAM swaps atomically and recalculates allocations on both hosts', () => {
    const firstHost = host('server:1')
    const secondHost = host('server:2')
    const firstRam = ram('ram:1')
    const secondRam = ram('ram:2')
    const input = project(
      [firstHost, secondHost],
      [firstRam, secondRam],
      [
        assignment(1, firstHost.key!, firstRam, '2026-07-19T01:00:00.000Z', {
          resourceType: 'memory',
          positions: [9, 10],
        }),
        assignment(2, secondHost.key!, secondRam, '2026-07-19T02:00:00.000Z'),
      ],
    )

    const result = swapAssignedComponent(input, 1, secondHost.key!)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, serverId: secondHost.key, allocation: { resourceType: 'memory', positions: [0, 1] } }),
      expect.objectContaining({ id: 2, serverId: firstHost.key, allocation: { resourceType: 'memory', positions: [0, 1] } }),
    ]))
  })

  it('rejects a resource-exhausting move without changing the input', () => {
    const source = host('server:1')
    const target = host('server:2')
    const first = storage('storage:1', '2280')
    const second = storage('storage:2', '2280')
    const input = project(
      [source, target],
      [first, second],
      [assignment(1, source.key!, first), assignment(2, target.key!, second)],
    )
    const before = structuredClone(input)
    const beforeJson = JSON.stringify(input)

    const result = moveAssignedComponent(input, 1, target.key!)

    expect(result.ok).toBe(false)
    expect(input).toEqual(before)
    expect(JSON.stringify(input)).toBe(beforeJson)
  })

  it('allows CPU, RAM, storage, and network on NAS while rejecting GPU', () => {
    const nas = host('nas:1', {}, 'nas')
    const components = [cpu('cpu:1', 'LGA1200'), ram('ram:1'), storage('storage:1', '2280'), network('network:1')]
    let current = project([nas], [...components, { id: 1, key: 'gpu:1', name: 'GPU', type: 'gpu' }])

    for (const item of components) {
      const result = tryAssignComponent(current, nas.key!, item.key!)
      expect(result.ok).toBe(true)
      if (result.ok) current = result.project
    }

    const rejected = tryAssignComponent(current, nas.key!, 'gpu:1')
    expect(rejected.ok).toBe(false)
    expect(rejected.ok ? '' : rejected.message).toContain('CPU, RAM, storage drives, and network cards')
  })
})
