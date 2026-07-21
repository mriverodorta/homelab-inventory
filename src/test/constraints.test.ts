import { describe, expect, it } from 'vitest'
import {
  assignComponent,
  getVisibleServerSlotTypes,
  sortAssignmentsForDisplay,
  swapAssignedComponent,
  validateAssignment,
} from '@/lib/constraints'
import { mergeInventoryWithProject } from '@/lib/inventory'
import { removeAssignment } from '@/lib/project'
import type { InventoryItem } from '@/types/inventory'

function archived(item: InventoryItem): InventoryItem {
  return {
    ...item,
    archivedAt: '2026-07-19T12:00:00.000Z',
  }
}

const items: InventoryItem[] = [
  { id: 1, key: 'server:1', name: 'Server', type: 'server' },
  { id: 2, key: 'server:2', name: 'Server Two', type: 'server' },
  { id: 1, key: 'nas:1', name: 'NAS', type: 'nas' },
  { id: 1, key: 'cpu:1', name: 'CPU A', type: 'cpu' },
  { id: 2, key: 'cpu:2', name: 'CPU B', type: 'cpu' },
  { id: 1, key: 'ram:1', name: 'RAM', type: 'ram' },
  { id: 2, key: 'ram:2', name: 'RAM B', type: 'ram' },
  { id: 1, key: 'storage:1', name: 'Storage A', type: 'storage' },
  { id: 2, key: 'storage:2', name: 'Storage B', type: 'storage' },
  { id: 1, key: 'gpu:1', name: 'GPU', type: 'gpu' },
  { id: 1, key: 'network:1', name: 'Wi-Fi', type: 'network', subtype: 'wifi' },
  { id: 2, key: 'network:2', name: 'A+E 2.5GbE', type: 'network', subtype: 'ethernet' },
  { id: 1, key: 'switch:1', name: 'Switch', type: 'switch' },
]

describe('slot constraints', () => {
  it('rejects a duplicate CPU', () => {
    const project = assignComponent(mergeInventoryWithProject(items, null), 'server:1', 'cpu:1')
    const result = validateAssignment(project, 'server:1', 'cpu:2')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toMatch(/already has a CPU/i)
  })

  it('allows multiple storage items', () => {
    const first = assignComponent(mergeInventoryWithProject(items, null), 'server:1', 'storage:1')
    const second = assignComponent(first, 'server:1', 'storage:2')

    expect(second.assignments.filter((assignment) => assignment.type === 'storage')).toHaveLength(2)
  })

  it('treats Wi-Fi and A+E 2.5GbE as the same network slot', () => {
    const project = assignComponent(mergeInventoryWithProject(items, null), 'server:1', 'network:1')
    const result = validateAssignment(project, 'server:1', 'network:2')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toMatch(/network card/i)
  })

  it('rejects canvas equipment as server components', () => {
    const result = validateAssignment(mergeInventoryWithProject(items, null), 'server:1', 'switch:1')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toMatch(/canvas equipment/i)
  })

  it('allows CPU, RAM, storage, and one network card on a NAS', () => {
    const base = mergeInventoryWithProject(items, null)
    const withCpu = assignComponent(base, 'nas:1', 'cpu:1')
    const withRam = assignComponent(withCpu, 'nas:1', 'ram:1')
    const withStorage = assignComponent(withRam, 'nas:1', 'storage:1')
    const withNetwork = assignComponent(withStorage, 'nas:1', 'network:1')

    expect(withNetwork.assignments.filter((assignment) => assignment.serverId === 'nas:1')).toHaveLength(4)
    expect(validateAssignment(withNetwork, 'nas:1', 'network:2').ok).toBe(false)
  })

  it('rejects GPUs on a NAS', () => {
    const result = validateAssignment(mergeInventoryWithProject(items, null), 'nas:1', 'gpu:1')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toMatch(/CPU, RAM, storage drives, and network cards/i)
  })

  it('rejects assigning an archived component', () => {
    const project = mergeInventoryWithProject([
      ...items,
      archived({ id: 3, key: 'cpu:3', name: 'Archived CPU', type: 'cpu' }),
    ], null)

    expect(validateAssignment(project, 'server:1', 'cpu:3')).toEqual({
      ok: false,
      message: 'Restore Archived CPU before assigning it.',
    })
    expect(assignComponent(project, 'server:1', 'cpu:3')).toBe(project)
  })

  it('rejects assigning a component to an archived host', () => {
    const project = mergeInventoryWithProject([
      ...items.filter((item) => item.key !== 'server:1'),
      archived({ id: 1, key: 'server:1', name: 'Archived Server', type: 'server' }),
    ], null)

    expect(validateAssignment(project, 'server:1', 'cpu:1')).toEqual({
      ok: false,
      message: 'Restore this server or NAS before assigning components.',
    })
  })

  it('sorts assignments in server display order', () => {
    const base = mergeInventoryWithProject(items, null)
    const project = ['network:1', 'storage:1', 'cpu:1', 'gpu:1', 'ram:1'].reduce(
      (current, itemId) => assignComponent(current, 'server:1', itemId),
      base,
    )

    expect(sortAssignmentsForDisplay(project, 'server:1').map((assignment) => assignment.type)).toEqual([
      'cpu',
      'ram',
      'storage',
      'gpu',
      'network',
    ])
  })

  it('shows only required empty slots until optional components are assigned', () => {
    const emptyProject = mergeInventoryWithProject(items, null)

    expect(getVisibleServerSlotTypes(emptyProject, 'server:1')).toEqual(['cpu', 'ram', 'storage'])

    const withGpu = assignComponent(emptyProject, 'server:1', 'gpu:1')

    expect(getVisibleServerSlotTypes(withGpu, 'server:1')).toEqual(['cpu', 'ram', 'storage', 'gpu'])

    const withNetwork = assignComponent(withGpu, 'server:1', 'network:1')

    expect(getVisibleServerSlotTypes(withNetwork, 'server:1')).toEqual([
      'cpu',
      'ram',
      'storage',
      'gpu',
      'network',
    ])

    const gpuAssignment = withNetwork.assignments.find((assignment) => assignment.type === 'gpu')
    const withoutGpu = removeAssignment(withNetwork, gpuAssignment!.id)

    expect(getVisibleServerSlotTypes(withoutGpu, 'server:1')).toEqual([
      'cpu',
      'ram',
      'storage',
      'network',
    ])
  })

  it('swaps CPUs when moving one CPU onto another populated server', () => {
    const base = mergeInventoryWithProject(items, null)
    const first = assignComponent(base, 'server:1', 'cpu:1')
    const populated = assignComponent(first, 'server:2', 'cpu:2')
    const sourceAssignment = populated.assignments.find((assignment) => assignment.itemId === 'cpu:1')
    const result = swapAssignedComponent(populated, sourceAssignment!.id, 'server:2')

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(result.project.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceAssignment?.id,
          serverId: 'server:2',
          itemId: 'cpu:1',
          type: 'cpu',
        }),
        expect.objectContaining({
          serverId: 'server:1',
          itemId: 'cpu:2',
          type: 'cpu',
        }),
      ]),
    )
  })

  it('swaps RAM when moving one RAM module onto another populated server', () => {
    const base = mergeInventoryWithProject(items, null)
    const first = assignComponent(base, 'server:1', 'ram:1')
    const populated = assignComponent(first, 'server:2', 'ram:2')
    const sourceAssignment = populated.assignments.find((assignment) => assignment.itemId === 'ram:1')
    const result = swapAssignedComponent(populated, sourceAssignment!.id, 'server:2')

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(result.project.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceAssignment?.id,
          serverId: 'server:2',
          itemId: 'ram:1',
          type: 'ram',
        }),
        expect.objectContaining({
          serverId: 'server:1',
          itemId: 'ram:2',
          type: 'ram',
        }),
      ]),
    )
  })

  it('rejects moving an archived component or swapping with an archived target component', () => {
    const base = mergeInventoryWithProject(items, null)
    const first = assignComponent(base, 'server:1', 'cpu:1')
    const populated = assignComponent(first, 'server:2', 'cpu:2')
    const sourceAssignment = populated.assignments.find((assignment) => assignment.itemId === 'cpu:1')
    const archivedSource: typeof populated = {
      ...populated,
      items: {
        ...populated.items,
        'cpu:1': archived(populated.items['cpu:1']),
      },
    }
    const archivedTarget: typeof populated = {
      ...populated,
      items: {
        ...populated.items,
        'cpu:2': archived(populated.items['cpu:2']),
      },
    }

    expect(swapAssignedComponent(archivedSource, sourceAssignment!.id, 'server:2')).toEqual({
      ok: false,
      message: 'Restore archived components and hosts before moving or swapping them.',
    })
    expect(swapAssignedComponent(archivedTarget, sourceAssignment!.id, 'server:2')).toEqual({
      ok: false,
      message: 'Restore archived components before moving or swapping them.',
    })
  })
})
