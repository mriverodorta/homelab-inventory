import { describe, expect, it } from 'vitest'
import {
  evaluateAssignmentCompatibility,
  evaluateProjectCompatibility,
  normalizeComponentRequirements,
  normalizeHostCapabilities,
  planHostAllocations,
} from '@/lib/compatibility'
import type { InventoryItem, ProjectState } from '@/types/inventory'

type EvaluationInput = {
  host: InventoryItem
  component: InventoryItem
}

const host = (capabilities: Record<string, unknown>): InventoryItem => ({
  id: 1,
  key: 'server:1',
  type: 'server',
  name: 'Invariant host',
  compatibility: { host: capabilities },
})

const component = (
  type: InventoryItem['type'],
  compatibility?: InventoryItem['compatibility'],
  specs?: InventoryItem['specs'],
): InventoryItem => ({
  id: 1,
  key: `${type}:1`,
  type,
  name: `Invariant ${type}`,
  compatibility,
  specs,
})

const evaluate = ({ host: hostItem, component: item }: EvaluationInput) => (
  evaluateAssignmentCompatibility({ host: hostItem, component: item })
)

const cpuPair = (actual?: string, accepted: string[] = ['12th Gen']): EvaluationInput => ({
  host: host({ cpu: { sockets: ['LGA1700'], generations: accepted, maxTdpWatts: 65 } }),
  component: component('cpu', { requirements: { cpu: {
    socket: 'LGA1700',
    ...(actual ? { generation: actual } : {}),
    tdpWatts: 35,
  } } }),
})

const memoryPair = (actual?: string, accepted: string[] = ['DDR4']): EvaluationInput => ({
  host: host({ memory: {
    generations: accepted,
    slots: 2,
    maxCapacityGb: 64,
    maxModuleCapacityGb: 32,
    maxSpeedMt: 3200,
    formFactors: ['SO-DIMM'],
    moduleTypes: ['UDIMM'],
    eccSupport: 'unsupported',
  } }),
  component: component('ram', { requirements: { memory: {
    capacityGb: 16,
    ...(actual ? { generation: actual } : {}),
    speedMt: 3200,
    formFactor: 'SO-DIMM',
    moduleType: 'UDIMM',
    ecc: false,
  } } }),
})

const storagePair = (actual?: string, accepted: string[] = ['NVMe']): EvaluationInput => ({
  host: host({ storageSlots: [{
    id: 1,
    key: 'm2-storage',
    label: 'M.2 storage',
    count: 1,
    interfaces: accepted,
    formFactors: ['2280'],
    pcieGeneration: 4,
  }] }),
  component: component('storage', undefined, {
    ...(actual ? { interface: actual } : {}),
    formFactor: '2280',
    pcie: 'PCIe 4.0 x4',
  }),
})

const expansionPair = (actual?: string, accepted = 'pcie'): EvaluationInput => ({
  host: host({
    expansionSlots: [{
      id: 1,
      key: 'expansion-slot',
      label: 'Expansion slot',
      count: 1,
      interfaceFamily: accepted,
      pcieGeneration: 4,
      mechanicalLanes: 16,
      electricalLanes: 8,
      acceptedHeights: ['low-profile'],
      maxSlotWidth: 1,
      maxPowerWatts: 75,
    }],
    maxExpansionPowerWatts: 75,
  }),
  component: component('network', { requirements: { expansion: {
    ...(actual ? { interfaceFamily: actual } : {}),
    pcieGeneration: 3,
    connectorLanes: 4,
    minimumElectricalLanes: 4,
    height: 'low-profile',
    slotWidth: 1,
    powerWatts: 10,
  } } }),
})

const optionalModulePair = (
  socketKeys?: string[],
  moduleKey = 'A+E',
): EvaluationInput => ({
  host: host({ optionalModuleSlots: [{
    id: 1,
    key: 'm2-ae-slot',
    label: 'M.2 Key E slot',
    count: 1,
    interfaceFamily: 'm2-ae',
    ...(socketKeys ? { socketKeys } : {}),
    moduleSizes: ['2230'],
    availableBuses: [{ family: 'pcie', lanes: 1, pcieGeneration: 3 }],
  }] }),
  component: component('network', { requirements: { expansion: {
    interfaceFamily: 'm2-ae',
    key: moduleKey,
    moduleSize: '2230',
    requiredBuses: [{ family: 'pcie', minimumLanes: 1, minimumPcieGeneration: 2 }],
  } } }),
})

describe('compatibility evaluator invariants', () => {
  const ruleCases = [
    {
      label: 'CPU generation',
      compatible: cpuPair('12th Gen'),
      incompatible: cpuPair('14th Gen'),
      unknown: cpuPair(undefined),
    },
    {
      label: 'memory generation',
      compatible: memoryPair('DDR4'),
      incompatible: memoryPair('DDR5'),
      unknown: memoryPair(undefined),
    },
    {
      label: 'storage interface',
      compatible: storagePair('NVMe'),
      incompatible: storagePair('SAS'),
      unknown: storagePair(undefined),
    },
    {
      label: 'expansion family',
      compatible: expansionPair('pcie'),
      incompatible: expansionPair('ocp'),
      unknown: expansionPair(undefined),
    },
    {
      label: 'optional-module socket key',
      compatible: optionalModulePair(['E']),
      incompatible: optionalModulePair(['B']),
      unknown: optionalModulePair(undefined),
    },
  ]

  it.each(ruleCases)('$label preserves compatible, incompatible, and unknown states', ({
    compatible,
    incompatible,
    unknown,
  }) => {
    expect(evaluate(compatible).status).toBe('compatible')
    expect(evaluate(incompatible).status).toBe('incompatible')

    const unknownResult = evaluate(unknown)
    expect(unknownResult.status).toBe('unknown')
    expect(unknownResult.findings).not.toHaveLength(0)
    expect(unknownResult.findings.every(
      (finding) => finding.classification === 'informational',
    )).toBe(true)
  })

  it('does not mutate source objects or fabricate malformed numeric evidence', () => {
    const hostItem = host({
      cpu: { sockets: ['LGA1700'], generations: ['12th Gen'], maxTdpWatts: 'unknown' },
      memory: { slots: 'two', maxCapacityGb: false },
    })
    const item = component('cpu', { requirements: { cpu: {
      socket: 'LGA1700',
      generation: '12th Gen',
      tdpWatts: '35 watts',
    } } } as InventoryItem['compatibility'])
    const hostSnapshot = structuredClone(hostItem)
    const componentSnapshot = structuredClone(item)

    expect(normalizeHostCapabilities(hostItem).cpu?.maxTdpWatts).toBeUndefined()
    expect(normalizeComponentRequirements(item)).not.toHaveProperty('tdpWatts')
    expect(evaluateAssignmentCompatibility({ host: hostItem, component: item })).toMatchObject({
      status: 'unknown',
      findings: expect.arrayContaining([
        expect.objectContaining({ field: 'host.cpu.maxTdpWatts', severity: 'unknown' }),
      ]),
    })
    expect(hostItem).toEqual(hostSnapshot)
    expect(item).toEqual(componentSnapshot)
  })

  it('uses an assigned resource even when a compatible sibling exists', () => {
    const drive = component('storage', undefined, { interface: 'NVMe', formFactor: '2280' })
    const hostItem = host({ storageSlots: [
      { id: 1, key: 'sata', label: 'SATA', count: 1, interfaces: ['SATA'], formFactors: ['2.5-inch'] },
      { id: 2, key: 'nvme', label: 'NVMe', count: 1, interfaces: ['NVMe'], formFactors: ['2280'] },
    ] })

    const assigned = evaluateAssignmentCompatibility({
      host: hostItem,
      component: drive,
      assignedAllocation: { resourceType: 'storage', groupId: 1, positions: [0] },
    })
    const unassigned = evaluateAssignmentCompatibility({ host: hostItem, component: drive })

    expect(assigned).toMatchObject({
      status: 'incompatible',
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'storage.interface.mismatch', resourceId: 1 }),
      ]),
    })
    expect(unassigned.status).toBe('compatible')
  })

  it('selects compatible candidates before unknown and incompatible candidates', () => {
    const drive = component('storage', undefined, { interface: 'NVMe', formFactor: '2280' })
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'Invariant project', version: 1, updatedAt: '2026-08-19T00:00:00Z' },
      items: {
        'server:1': host({ storageSlots: [
          { id: 1, key: 'sata', label: 'SATA', count: 1, interfaces: ['SATA'], formFactors: ['2.5-inch'] },
          { id: 2, key: 'unknown', label: 'Unknown', count: 1 },
          { id: 3, key: 'nvme', label: 'NVMe', count: 1, interfaces: ['NVMe'], formFactors: ['2280'] },
        ] }),
        'storage:1': drive,
      },
      placements: [],
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:1',
        type: 'storage',
        assignedAt: '2026-08-19T00:00:00Z',
      }],
      connections: [],
    }

    expect(planHostAllocations(project, 'server:1')).toMatchObject({
      assignments: [expect.objectContaining({
        allocation: { resourceType: 'storage', groupId: 3, positions: [0] },
      })],
      results: [expect.objectContaining({ status: 'compatible' })],
    })
  })

  it('is deterministic and leaves project state byte-identical', () => {
    const cpu = cpuPair('12th Gen').component
    cpu.key = 'cpu:1'
    const project: ProjectState = {
      id: 'default',
      metadata: { name: 'Invariant project', version: 1, updatedAt: '2026-08-19T00:00:00Z' },
      items: { 'server:1': cpuPair('12th Gen').host, 'cpu:1': cpu },
      placements: [{ serverId: 'server:1', x: 12, y: 24 }],
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'cpu:1',
        type: 'cpu',
        assignedAt: '2026-08-19T00:00:00Z',
      }],
      connections: [],
    }
    const snapshot = structuredClone(project)

    expect(evaluateProjectCompatibility(project)).toEqual(evaluateProjectCompatibility(project))
    expect(planHostAllocations(project, 'server:1')).toEqual(planHostAllocations(project, 'server:1'))
    expect(project).toEqual(snapshot)
  })
})
