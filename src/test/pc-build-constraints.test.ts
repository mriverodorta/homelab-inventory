import { describe, expect, it } from 'vitest'
import {
  tryAssignComponent,
  tryRemoveAssignedComponent,
} from '@/lib/constraints'
import { mergeInventoryWithProject } from '@/lib/inventory'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function inventory(): InventoryItem[] {
  return [
    { id: 1, type: 'pcBuild', name: 'Gaming PC' },
    {
      id: 1,
      type: 'motherboard',
      name: 'AM5 ATX board',
      specs: { cpuSocketCount: 1 },
      compatibility: {
        host: {
          cpu: { sockets: ['AM5'], generations: ['Zen 4'], maxTdpWatts: 170 },
          memory: {
            slots: 2,
            generations: ['DDR5'],
            maxCapacityGb: 96,
            maxModuleCapacityGb: 48,
            maxSpeedMt: 6400,
          },
          storageSlots: [{
            id: 1, key: 'm2',
            label: 'M.2 slot',
            count: 1,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
          }],
          expansionSlots: [{
            id: 3, key: 'pcie-x16',
            label: 'PCIe x16',
            count: 1,
            interfaceFamily: 'pcie',
            mechanicalLanes: 16,
            acceptedHeights: ['full-height'],
            maxSlotWidth: 3,
          }],
        },
      },
    },
    { id: 1, type: 'cpu', name: 'Ryzen CPU', specs: { socket: 'AM5', generation: 'Zen 4', tdpWatts: 120 } },
    { id: 1, type: 'cpuCooler', name: 'AM5 cooler', specs: { socket: 'AM5', maxTdpWatts: 180 } },
    { id: 1, type: 'ram', name: '32GB DDR5', specs: { capacityGb: 32, moduleCount: 2, generation: 'DDR5', speedMt: 6000 } },
    { id: 2, type: 'ram', name: 'Second 32GB DDR5', specs: { capacityGb: 32, moduleCount: 2, generation: 'DDR5', speedMt: 6000 } },
    { id: 1, type: 'storage', name: '1TB NVMe', specs: { interface: 'NVMe', formFactor: '2280' } },
    { id: 2, type: 'storage', name: 'Second NVMe', specs: { interface: 'NVMe', formFactor: '2280' } },
    { id: 1, type: 'powerSupply', name: '750W PSU' },
    { id: 1, type: 'powerAdapter', name: 'OEM adapter' },
    { id: 1, type: 'server', name: 'OEM server' },
    { id: 1, type: 'nas', name: 'NAS' },
  ]
}

function assign(project: ProjectState, hostId: string, itemId: string): ProjectState {
  const result = tryAssignComponent(project, hostId, itemId)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.project
}

describe('PC Build assignment constraints', () => {
  it('requires a motherboard before other components and persists physical allocations', () => {
    const empty = mergeInventoryWithProject(inventory(), null)
    expect(tryAssignComponent(empty, 'pcBuild:1', 'cpu:1')).toEqual({
      ok: false,
      message: 'Add a motherboard before assigning other PC components.',
    })

    const withBoard = assign(empty, 'pcBuild:1', 'motherboard:1')
    const withCpu = assign(withBoard, 'pcBuild:1', 'cpu:1')
    const withRam = assign(withCpu, 'pcBuild:1', 'ram:1')
    const withStorage = assign(withRam, 'pcBuild:1', 'storage:1')

    expect(withStorage.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'motherboard', allocation: { resourceType: 'motherboard', positions: [0] } }),
      expect.objectContaining({ type: 'cpu', allocation: { resourceType: 'cpu', positions: [0] } }),
      expect.objectContaining({ type: 'ram', allocation: { resourceType: 'memory', positions: [0, 1] } }),
      expect.objectContaining({ type: 'storage', allocation: { resourceType: 'storage', groupId: 1, positions: [0] } }),
    ]))
  })

  it('enforces motherboard capacity even when host compatibility checks are disabled', () => {
    const empty = mergeInventoryWithProject(inventory(), null)
    empty.compatibilityPolicy = {
      disabledHosts: [{ hostType: 'pcBuild', hostId: 1 }],
      ignoredWarningIds: [],
    }
    const withBoard = assign(empty, 'pcBuild:1', 'motherboard:1')
    const withRam = assign(withBoard, 'pcBuild:1', 'ram:1')
    const result = tryAssignComponent(withRam, 'pcBuild:1', 'ram:2')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe('No available memory positions can satisfy this component.')
  })

  it('enforces single logical components and storage capacity', () => {
    const empty = mergeInventoryWithProject(inventory(), null)
    const withBoard = assign(empty, 'pcBuild:1', 'motherboard:1')
    const withPsu = assign(withBoard, 'pcBuild:1', 'powerSupply:1')
    expect(tryAssignComponent(withPsu, 'pcBuild:1', 'motherboard:1').ok).toBe(false)

    const withStorage = assign(withPsu, 'pcBuild:1', 'storage:1')
    const secondStorage = tryAssignComponent(withStorage, 'pcBuild:1', 'storage:2')
    expect(secondStorage.ok).toBe(false)
    expect(secondStorage.ok ? '' : secondStorage.message).toBe('No available storage positions can satisfy this component.')
  })

  it('keeps OEM power adapters out of PC Builds while allowing them on Server and NAS hosts', () => {
    const project = mergeInventoryWithProject(inventory(), null)

    expect(tryAssignComponent(project, 'pcBuild:1', 'powerAdapter:1').ok).toBe(false)
    expect(tryAssignComponent(project, 'server:1', 'powerAdapter:1').ok).toBe(true)
    expect(tryAssignComponent(project, 'nas:1', 'powerAdapter:1').ok).toBe(true)
    expect(tryAssignComponent(project, 'server:1', 'powerSupply:1').ok).toBe(false)
  })

  it('blocks motherboard removal until dependent assignments are removed', () => {
    const empty = mergeInventoryWithProject(inventory(), null)
    const withBoard = assign(empty, 'pcBuild:1', 'motherboard:1')
    const withCpu = assign(withBoard, 'pcBuild:1', 'cpu:1')
    const boardAssignment = withCpu.assignments.find((assignment) => assignment.type === 'motherboard')
    const result = tryRemoveAssignedComponent(withCpu, boardAssignment?.id ?? '')

    expect(result).toEqual({
      ok: false,
      message: 'Remove the components assigned to this motherboard before removing the motherboard.',
    })
  })
})
