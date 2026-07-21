import { describe, expect, it } from 'vitest'
import {
  allocatePcBuildResource,
  motherboardResources,
  occupiedPositions,
  validatePersistedAllocation,
} from '@/lib/pc-build-resources'
import type { CompatibilityAllocation } from '@/types/compatibility'
import type { ComponentAssignment, ComponentType, InventoryItem } from '@/types/inventory'

function motherboard(): InventoryItem {
  return {
    id: 1,
    key: 'motherboard:1',
    type: 'motherboard',
    name: 'Example ATX board',
    specs: { cpuSocketCount: 2 },
    compatibility: {
      host: {
        cpu: {
          sockets: ['AM5'],
          generations: ['Zen 4', 'Zen 5'],
          maxTdpWatts: 170,
        },
        memory: {
          slots: 4,
          generations: ['DDR5'],
          maxCapacityGb: 192,
          maxModuleCapacityGb: 48,
          maxSpeedMt: 6400,
        },
        storageSlots: [
          {
            id: 1, key: 'm2',
            label: 'M.2 slots',
            count: 2,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
            pcieGeneration: 4,
          },
          {
            id: 2, key: 'sata',
            label: 'SATA ports',
            count: 4,
            interfaces: ['SATA'],
            formFactors: ['2.5', '3.5'],
          },
        ],
        expansionSlots: [
          {
            id: 3, key: 'pcie-x16',
            label: 'PCIe x16',
            count: 2,
            interfaceFamily: 'pcie',
            pcieGeneration: 4,
            mechanicalLanes: 16,
            electricalLanes: 16,
            acceptedHeights: ['full-height', 'low-profile'],
            maxSlotWidth: 3,
          },
        ],
      },
    },
  }
}

function assignmentUsing(
  type: ComponentType,
  resourceType: CompatibilityAllocation['resourceType'],
  groupId: number | undefined,
  positions: number[],
  id = (groupId ?? 0) * 10 + (positions[0] ?? 0) + 1,
): ComponentAssignment {
  return {
    id,
    serverId: 'pcBuild:1',
    itemId: `${type}:${id}`,
    type,
    assignedAt: '2026-07-20T00:00:00.000Z',
    allocation: {
      resourceType,
      ...(groupId ? { groupId } : {}),
      positions,
    },
  }
}

describe('PC Build motherboard resources', () => {
  it('normalizes ordered motherboard resources without mutating the item', () => {
    const item = motherboard()
    const before = structuredClone(item)

    expect(motherboardResources(item)).toEqual({
      cpuSockets: [{
        label: 'CPU sockets',
        count: 2,
        socket: 'AM5',
        supportedGenerations: ['Zen 4', 'Zen 5'],
        maxTdpWatts: 170,
      }],
      memorySlots: [{
        label: 'DIMM slots',
        count: 4,
        generations: ['DDR5'],
        maxCapacityGb: 192,
        maxModuleCapacityGb: 48,
        maxSpeedMt: 6400,
      }],
      storageSlots: item.compatibility?.host?.storageSlots,
      expansionSlots: item.compatibility?.host?.expansionSlots,
    })
    expect(item).toEqual(before)
  })

  it('collects occupied positions only from the exact resource group', () => {
    const assignments = [
      assignmentUsing('ram', 'memory', undefined, [0, 1]),
      assignmentUsing('storage', 'storage', 1, [0]),
      assignmentUsing('storage', 'storage', 2, [0, 1]),
    ]

    expect([...occupiedPositions(assignments, 'storage', 1)]).toEqual([0])
    expect([...occupiedPositions(assignments, 'storage', 2)]).toEqual([0, 1])
    expect([...occupiedPositions(assignments, 'memory', undefined)]).toEqual([0, 1])
  })
})

describe('allocatePcBuildResource', () => {
  it('allocates the first compatible free CPU socket', () => {
    expect(allocatePcBuildResource({
      componentType: 'cpu',
      requiredPositions: 1,
      motherboard: motherboard(),
      requirements: { socket: 'AM5', generation: 'Zen 4', tdpWatts: 120 },
      assignments: [assignmentUsing('cpu', 'cpu', undefined, [0])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'cpu', positions: [1] },
    })
  })

  it('allocates one cooler position per physical CPU socket', () => {
    expect(allocatePcBuildResource({
      componentType: 'cpuCooler',
      requiredPositions: 1,
      motherboard: motherboard(),
      assignments: [assignmentUsing('cpuCooler', 'cooling', undefined, [0])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'cooling', positions: [1] },
    })
  })

  it('allocates the first compatible free DIMM positions', () => {
    expect(allocatePcBuildResource({
      componentType: 'ram',
      requiredPositions: 2,
      motherboard: motherboard(),
      requirements: { generation: 'DDR5', moduleCapacityGb: 16, speedMt: 6000 },
      assignments: [assignmentUsing('ram', 'memory', undefined, [0, 1])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'memory', positions: [2, 3] },
    })
  })

  it('allocates storage and expansion groups independently', () => {
    expect(allocatePcBuildResource({
      componentType: 'storage',
      requiredPositions: 1,
      motherboard: motherboard(),
      requirements: { interfaces: ['NVMe'], formFactors: ['2280'] },
      assignments: [assignmentUsing('gpu', 'expansion', 3, [0])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
    })

    expect(allocatePcBuildResource({
      componentType: 'gpu',
      requiredPositions: 1,
      motherboard: motherboard(),
      requirements: {
        interfaceFamily: 'pcie',
        connectorLanes: 16,
        height: 'full-height',
        slotWidth: 2,
      },
      assignments: [assignmentUsing('storage', 'storage', 1, [0])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'expansion', groupId: 3, positions: [0] },
    })
  })

  it('allocates the motherboard as a single logical position', () => {
    expect(allocatePcBuildResource({
      componentType: 'motherboard',
      requiredPositions: 1,
      motherboard: motherboard(),
      assignments: [],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'motherboard', positions: [0] },
    })
  })

  it('returns clear no-capacity results', () => {
    expect(allocatePcBuildResource({
      componentType: 'ram',
      requiredPositions: 2,
      motherboard: motherboard(),
      assignments: [assignmentUsing('ram', 'memory', undefined, [0, 1, 2])],
    })).toEqual({
      ok: false,
      message: 'No available memory positions can satisfy this component.',
    })

    expect(allocatePcBuildResource({
      componentType: 'motherboard',
      requiredPositions: 1,
      motherboard: motherboard(),
      assignments: [assignmentUsing('motherboard', 'motherboard', undefined, [0])],
    })).toEqual({
      ok: false,
      message: 'No available motherboard positions can satisfy this component.',
    })
  })

  it('deterministically reuses the first position after an assignment is removed', () => {
    const first = assignmentUsing('storage', 'storage', 1, [0])
    const second = assignmentUsing('storage', 'storage', 1, [1])

    expect(allocatePcBuildResource({
      componentType: 'storage',
      requiredPositions: 1,
      motherboard: motherboard(),
      requirements: { interfaces: ['NVMe'], formFactors: ['2280'] },
      assignments: [second],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
    })
    expect(first.allocation?.positions).toEqual([0])
  })
})

describe('validatePersistedAllocation', () => {
  const request = {
    componentType: 'storage' as const,
    requiredPositions: 1,
    motherboard: motherboard(),
    requirements: { interfaces: ['NVMe'], formFactors: ['2280'] },
    assignments: [] as ComponentAssignment[],
  }

  it('accepts an exact compatible, unoccupied allocation', () => {
    expect(validatePersistedAllocation(request, {
      resourceType: 'storage',
      groupId: 1,
      positions: [1],
    })).toBe(true)
  })

  it.each([
    { resourceType: 'memory', positions: [0] },
    { resourceType: 'storage', groupId: 999, positions: [0] },
    { resourceType: 'storage', groupId: 1, positions: [2] },
    { resourceType: 'storage', groupId: 1, positions: [0, 0] },
  ] as CompatibilityAllocation[])('rejects malformed or out-of-range allocation %o', (allocation) => {
    expect(validatePersistedAllocation(request, allocation)).toBe(false)
  })

  it('rejects occupied and incompatible persisted positions', () => {
    expect(validatePersistedAllocation({
      ...request,
      assignments: [assignmentUsing('storage', 'storage', 1, [0])],
    }, {
      resourceType: 'storage',
      groupId: 1,
      positions: [0],
    })).toBe(false)

    expect(validatePersistedAllocation({
      ...request,
      requirements: { interfaces: ['SATA'], formFactors: ['2280'] },
    }, {
      resourceType: 'storage',
      groupId: 1,
      positions: [0],
    })).toBe(false)
  })
})
