import { describe, expect, it } from 'vitest'
import {
  canRemovePcBuildAssignment,
  PC_BUILD_COMPONENT_ORDER,
  requiredPcBuildPositions,
  visiblePcBuildSlotTypes,
} from '@/lib/pc-build'
import { mergeInventoryWithProject } from '@/lib/inventory'
import type { ComponentAssignment, InventoryItem } from '@/types/inventory'

describe('PC Build slots', () => {
  it('uses the approved component order and required rows', () => {
    expect(PC_BUILD_COMPONENT_ORDER).toEqual([
      'motherboard', 'cpu', 'cpuCooler', 'ram', 'storage', 'gpu', 'soundCard',
      'network', 'wireless', 'case', 'powerSupply',
    ])

    const project = mergeInventoryWithProject([
      { id: 1, type: 'pcBuild', name: 'Gaming PC' },
      { id: 1, type: 'gpu', name: 'GPU' },
    ], null)
    project.assignments = [{
      id: 1,
      serverId: 'pcBuild:1',
      itemId: 'gpu:1',
      type: 'gpu',
      assignedAt: '2026-07-20T00:00:00.000Z',
    }]

    expect(visiblePcBuildSlotTypes(project, 'pcBuild:1')).toEqual([
      'motherboard', 'cpu', 'cpuCooler', 'ram', 'storage', 'gpu', 'powerSupply',
    ])
  })

  it('uses the physical RAM module count', () => {
    const ram = {
      id: 1,
      type: 'ram',
      name: '32GB DDR5',
      specs: { capacityGb: 32, module: '2x16GB' },
    } satisfies InventoryItem

    expect(requiredPcBuildPositions(ram)).toBe(2)
  })

  it('blocks motherboard removal while dependent assignments remain', () => {
    const project = mergeInventoryWithProject([
      { id: 1, type: 'pcBuild', name: 'Gaming PC' },
      { id: 1, type: 'motherboard', name: 'Board' },
      { id: 1, type: 'cpu', name: 'CPU' },
    ], null)
    const boardAssignment: ComponentAssignment = {
      id: 1,
      serverId: 'pcBuild:1',
      itemId: 'motherboard:1',
      type: 'motherboard',
      assignedAt: '2026-07-20T00:00:00.000Z',
    }
    project.assignments = [
      boardAssignment,
      {
        id: 2,
        serverId: 'pcBuild:1',
        itemId: 'cpu:1',
        type: 'cpu',
        assignedAt: '2026-07-20T00:00:01.000Z',
      },
    ]

    expect(canRemovePcBuildAssignment(project, boardAssignment)).toEqual({
      ok: false,
      message: 'Remove the components assigned to this motherboard before removing the motherboard.',
    })
  })
})
