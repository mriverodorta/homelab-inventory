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
            id: 'm2',
            label: 'M.2 slots',
            count: 2,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
            pcieGeneration: 4,
          },
          {
            id: 'sata',
            label: 'SATA ports',
            count: 4,
            interfaces: ['SATA'],
            formFactors: ['2.5', '3.5'],
          },
        ],
        expansionSlots: [
          {
            id: 'pcie-x16',
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
  groupId: string | undefined,
  positions: number[],
  id = positions.join('-') || 'single',
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
        id: 'cpu',
        label: 'CPU sockets',
        count: 2,
        socket: 'AM5',
        supportedGenerations: ['Zen 4', 'Zen 5'],
        maxTdpWatts: 170,
      }],
      memorySlots: [{
        id: 'dimm',
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
      assignmentUsing('ram', 'memory', 'dimm', [0, 1]),
      assignmentUsing('storage', 'storage', 'm2', [0]),
      assignmentUsing('storage', 'storage', 'sata', [0, 1]),
    ]

    expect([...occupiedPositions(assignments, 'storage', 'm2')]).toEqual([0])
    expect([...occupiedPositions(assignments, 'storage', 'sata')]).toEqual([0, 1])
    expect([...occupiedPositions(assignments, 'memory', 'dimm')]).toEqual([0, 1])
  })
})

describe('allocatePcBuildResource', () => {
  it('allocates the first compatible free CPU socket', () => {
    expect(allocatePcBuildResource({
      componentType: 'cpu',
      requiredPositions: 1,
      motherboard: motherboard(),
      requirements: { socket: 'AM5', generation: 'Zen 4', tdpWatts: 120 },
      assignments: [assignmentUsing('cpu', 'cpu', 'cpu', [0])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'cpu', groupId: 'cpu', positions: [1] },
    })
  })

  it('allocates one cooler position per physical CPU socket', () => {
    expect(allocatePcBuildResource({
      componentType: 'cpuCooler',
      requiredPositions: 1,
      motherboard: motherboard(),
      assignments: [assignmentUsing('cpuCooler', 'cooling', 'cpu', [0])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'cooling', groupId: 'cpu', positions: [1] },
    })
  })

  it('allocates the first compatible free DIMM positions', () => {
    expect(allocatePcBuildResource({
      componentType: 'ram',
      requiredPositions: 2,
      motherboard: motherboard(),
      requirements: { generation: 'DDR5', moduleCapacityGb: 16, speedMt: 6000 },
      assignments: [assignmentUsing('ram', 'memory', 'dimm', [0, 1])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'memory', groupId: 'dimm', positions: [2, 3] },
    })
  })

  it('allocates storage and expansion groups independently', () => {
    expect(allocatePcBuildResource({
      componentType: 'storage',
      requiredPositions: 1,
      motherboard: motherboard(),
      requirements: { interfaces: ['NVMe'], formFactors: ['2280'] },
      assignments: [assignmentUsing('gpu', 'expansion', 'pcie-x16', [0])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'storage', groupId: 'm2', positions: [0] },
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
      assignments: [assignmentUsing('storage', 'storage', 'm2', [0])],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'expansion', groupId: 'pcie-x16', positions: [0] },
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
      assignments: [assignmentUsing('ram', 'memory', 'dimm', [0, 1, 2])],
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
    const first = assignmentUsing('storage', 'storage', 'm2', [0])
    const second = assignmentUsing('storage', 'storage', 'm2', [1])

    expect(allocatePcBuildResource({
      componentType: 'storage',
      requiredPositions: 1,
      motherboard: motherboard(),
      requirements: { interfaces: ['NVMe'], formFactors: ['2280'] },
      assignments: [second],
    })).toEqual({
      ok: true,
      allocation: { resourceType: 'storage', groupId: 'm2', positions: [0] },
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
      groupId: 'm2',
      positions: [1],
    })).toBe(true)
  })

  it.each([
    { resourceType: 'memory', groupId: 'm2', positions: [0] },
    { resourceType: 'storage', groupId: 'missing', positions: [0] },
    { resourceType: 'storage', groupId: 'm2', positions: [2] },
    { resourceType: 'storage', groupId: 'm2', positions: [0, 0] },
  ] as CompatibilityAllocation[])('rejects malformed or out-of-range allocation %o', (allocation) => {
    expect(validatePersistedAllocation(request, allocation)).toBe(false)
  })

  it('rejects occupied and incompatible persisted positions', () => {
    expect(validatePersistedAllocation({
      ...request,
      assignments: [assignmentUsing('storage', 'storage', 'm2', [0])],
    }, {
      resourceType: 'storage',
      groupId: 'm2',
      positions: [0],
    })).toBe(false)

    expect(validatePersistedAllocation({
      ...request,
      requirements: { interfaces: ['SATA'], formFactors: ['2280'] },
    }, {
      resourceType: 'storage',
      groupId: 'm2',
      positions: [0],
    })).toBe(false)
  })
})
