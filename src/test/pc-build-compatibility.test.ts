import { describe, expect, it } from 'vitest'
import {
  evaluateAssignmentCompatibility,
  normalizeComponentRequirements,
  planHostAllocations,
} from '@/lib/compatibility'

const evaluate = evaluateAssignmentCompatibility as any
const normalize = normalizeComponentRequirements as any
const plan = planHostAllocations as any

const pcBuild = { id: 1, key: 'pcBuild:1', type: 'pcBuild', name: 'Workstation' }
const motherboard = {
  id: 1,
  key: 'motherboard:1',
  type: 'motherboard',
  name: 'AM5 ATX board',
  specs: { formFactor: 'ATX', cpuSocketCount: 1 },
  compatibility: {
    host: {
      cpu: { sockets: ['AM5'], generations: ['Zen 4'], maxTdpWatts: 170 },
      memory: {
        generations: ['DDR5'], slots: 4, maxCapacityGb: 192,
        maxModuleCapacityGb: 48, maxSpeedMt: 6400,
      },
      storageSlots: [{
        id: 'm2', count: 2, interfaces: ['NVMe'], formFactors: ['2280'], pcieGeneration: 4,
      }],
      expansionSlots: [{
        id: 'pcie', count: 1, interfaceFamily: 'pcie', pcieGeneration: 4,
        mechanicalLanes: 16, electricalLanes: 16, acceptedHeights: ['full-height'],
        maxSlotWidth: 3, maxPowerWatts: 300,
      }],
      maxExpansionPowerWatts: 300,
    },
  },
}
const cpu = {
  id: 1, key: 'cpu:1', type: 'cpu', name: 'Ryzen CPU',
  compatibility: { requirements: { cpu: { socket: 'AM5', generation: 'Zen 4', tdpWatts: 105 } } },
}
const cooler = {
  id: 1, key: 'cpuCooler:1', type: 'cpuCooler', name: 'Tower cooler',
  specs: { supportedSockets: ['AM5'], coolingCapacityWatts: 180, heightMm: 155 },
}
const compatibleCase = {
  id: 1, key: 'case:1', type: 'case', name: 'ATX case',
  specs: {
    supportedMotherboardFormFactors: ['ATX'], supportedPsuFormFactors: ['ATX'],
    maxCoolerHeightMm: 165, maxExpansionLengthMm: 340, maxExpansionSlotWidth: 4,
  },
}
const psu = {
  id: 1, key: 'powerSupply:1', type: 'powerSupply', name: '650W PSU',
  specs: { wattageWatts: 650, formFactor: 'ATX' },
}
const gpu = {
  id: 1, key: 'gpu:1', type: 'gpu', name: 'GPU', specs: { lengthMm: 300 },
  compatibility: { requirements: { expansion: {
    interfaceFamily: 'pcie', pcieGeneration: 4, connectorLanes: 16,
    minimumElectricalLanes: 8, height: 'full-height', slotWidth: 3, powerWatts: 250,
  } } },
}

function assigned(item: { key: string, type: string }, id: number) {
  return { id, serverId: pcBuild.key, itemId: item.key, type: item.type, assignedAt: `2026-07-20T00:00:0${id}Z` }
}

function items(...values: any[]) {
  return Object.fromEntries([pcBuild, ...values].map((item) => [item.key, item]))
}

describe('PC Build compatibility', () => {
  it('normalizes sound and wireless cards as expansion hardware', () => {
    for (const type of ['soundCard', 'wireless']) {
      expect(normalize({
        type,
        specs: { interface: 'PCIe 3.0 x1', powerWatts: 8 },
      })).toMatchObject({ type, interfaceFamily: 'pcie', pcieGeneration: 3, connectorLanes: 1 })
    }
  })

  it('uses the assigned motherboard capabilities for compatible CPU and cooler checks', () => {
    const allItems = items(motherboard, cpu, cooler)
    const assignments = [assigned(motherboard, 1), assigned(cpu, 2), assigned(cooler, 3)]
    expect(evaluate({ host: pcBuild, component: cpu, assignments, items: allItems }))
      .toEqual({ status: 'compatible', findings: [] })
    expect(evaluate({ host: pcBuild, component: cooler, assignments, items: allItems }))
      .toEqual({ status: 'compatible', findings: [] })
  })

  it('reports incompatible cooler, PSU, and case constraints', () => {
    const badCooler = { ...cooler, specs: { supportedSockets: ['LGA1700'], coolingCapacityWatts: 65, heightMm: 180 } }
    const weakPsu = { ...psu, specs: { wattageWatts: 300, formFactor: 'SFX' } }
    const allItems = items(motherboard, cpu, badCooler, weakPsu, compatibleCase, gpu)
    const assignments = [
      assigned(motherboard, 1), assigned(cpu, 2), assigned(badCooler, 3),
      assigned(weakPsu, 4), assigned(compatibleCase, 5), assigned(gpu, 6),
    ]
    const coolerResult = evaluate({ host: pcBuild, component: badCooler, assignments, items: allItems })
    expect(coolerResult.status).toBe('incompatible')
    expect(coolerResult.findings.map((finding: any) => finding.code)).toEqual(expect.arrayContaining([
      'cooling.socket.mismatch', 'cooling.capacity.insufficient', 'case.cooler-height.exceeded',
    ]))
    const psuResult = evaluate({ host: pcBuild, component: weakPsu, assignments, items: allItems })
    expect(psuResult.findings.map((finding: any) => finding.code)).toEqual(expect.arrayContaining([
      'power.capacity.exceeded', 'case.psu-form-factor.mismatch',
    ]))
  })

  it('returns unknown when cooler compatibility data is missing', () => {
    const unknownCooler = { ...cooler, specs: {} }
    const allItems = items(motherboard, cpu, unknownCooler)
    const assignments = [assigned(motherboard, 1), assigned(cpu, 2), assigned(unknownCooler, 3)]
    const result = evaluate({ host: pcBuild, component: unknownCooler, assignments, items: allItems })
    expect(result.status).toBe('unknown')
    expect(result.findings.some((finding: any) => finding.code === 'compatibility.data.missing')).toBe(true)
  })

  it('enforces physical expansion capacity when compatibility policy is disabled', () => {
    const secondGpu = { ...gpu, id: 2, key: 'gpu:2', name: 'Second GPU' }
    const allItems = items(motherboard, gpu, secondGpu)
    const project = {
      id: 'default', items: allItems,
      assignments: [assigned(motherboard, 1), assigned(gpu, 2), assigned(secondGpu, 3)],
      compatibilityPolicy: { disabledHostIds: [pcBuild.key], ignoredWarningIds: [] },
    }
    const allocationPlan = plan(project, pcBuild.key)
    const second = allocationPlan.results.find((result: any) => result.itemId === secondGpu.key)
    expect(second.status).toBe('incompatible')
    expect(second.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'compatibility.resource.exhausted', severity: 'error' }),
    ]))
    expect(allocationPlan.assignments.find((entry: any) => entry.itemId === secondGpu.key)?.allocation).toBeUndefined()
  })
})
