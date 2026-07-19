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
  { id: 'srv', name: 'Server', type: 'server' },
  { id: 'srv-two', name: 'Server Two', type: 'server' },
  { id: 'nas', name: 'NAS', type: 'nas' },
  { id: 'cpu-a', name: 'CPU A', type: 'cpu' },
  { id: 'cpu-b', name: 'CPU B', type: 'cpu' },
  { id: 'ram', name: 'RAM', type: 'ram' },
  { id: 'ram-b', name: 'RAM B', type: 'ram' },
  { id: 'storage-a', name: 'Storage A', type: 'storage' },
  { id: 'storage-b', name: 'Storage B', type: 'storage' },
  { id: 'gpu', name: 'GPU', type: 'gpu' },
  { id: 'wifi', name: 'Wi-Fi', type: 'network', subtype: 'wifi' },
  { id: 'eth', name: 'A+E 2.5GbE', type: 'network', subtype: 'ethernet' },
  { id: 'switch', name: 'Switch', type: 'switch' },
]

describe('slot constraints', () => {
  it('rejects a duplicate CPU', () => {
    const project = assignComponent(mergeInventoryWithProject(items, null), 'srv', 'cpu-a')
    const result = validateAssignment(project, 'srv', 'cpu-b')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toMatch(/already has a CPU/i)
  })

  it('allows multiple storage items', () => {
    const first = assignComponent(mergeInventoryWithProject(items, null), 'srv', 'storage-a')
    const second = assignComponent(first, 'srv', 'storage-b')

    expect(second.assignments.filter((assignment) => assignment.type === 'storage')).toHaveLength(2)
  })

  it('treats Wi-Fi and A+E 2.5GbE as the same network slot', () => {
    const project = assignComponent(mergeInventoryWithProject(items, null), 'srv', 'wifi')
    const result = validateAssignment(project, 'srv', 'eth')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toMatch(/network card/i)
  })

  it('rejects canvas equipment as server components', () => {
    const result = validateAssignment(mergeInventoryWithProject(items, null), 'srv', 'switch')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toMatch(/canvas equipment/i)
  })

  it('allows storage and one network card on a NAS', () => {
    const base = mergeInventoryWithProject(items, null)
    const withStorage = assignComponent(base, 'nas', 'storage-a')
    const withNetwork = assignComponent(withStorage, 'nas', 'wifi')

    expect(withNetwork.assignments.filter((assignment) => assignment.serverId === 'nas')).toHaveLength(2)
    expect(validateAssignment(withNetwork, 'nas', 'eth').ok).toBe(false)
  })

  it('rejects non-NAS components on a NAS', () => {
    const result = validateAssignment(mergeInventoryWithProject(items, null), 'nas', 'cpu-a')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toMatch(/storage drives and network cards/i)
  })

  it('rejects assigning an archived component', () => {
    const project = mergeInventoryWithProject([
      ...items,
      archived({ id: 'cpu-archived', name: 'Archived CPU', type: 'cpu' }),
    ], null)

    expect(validateAssignment(project, 'srv', 'cpu-archived')).toEqual({
      ok: false,
      message: 'Restore Archived CPU before assigning it.',
    })
    expect(assignComponent(project, 'srv', 'cpu-archived')).toBe(project)
  })

  it('rejects assigning a component to an archived host', () => {
    const project = mergeInventoryWithProject([
      ...items.filter((item) => item.id !== 'srv'),
      archived({ id: 'srv', name: 'Archived Server', type: 'server' }),
    ], null)

    expect(validateAssignment(project, 'srv', 'cpu-a')).toEqual({
      ok: false,
      message: 'Restore this server or NAS before assigning components.',
    })
  })

  it('sorts assignments in server display order', () => {
    const base = mergeInventoryWithProject(items, null)
    const project = ['wifi', 'storage-a', 'cpu-a', 'gpu', 'ram'].reduce(
      (current, itemId) => assignComponent(current, 'srv', itemId),
      base,
    )

    expect(sortAssignmentsForDisplay(project, 'srv').map((assignment) => assignment.type)).toEqual([
      'cpu',
      'ram',
      'storage',
      'gpu',
      'network',
    ])
  })

  it('shows only required empty slots until optional components are assigned', () => {
    const emptyProject = mergeInventoryWithProject(items, null)

    expect(getVisibleServerSlotTypes(emptyProject, 'srv')).toEqual(['cpu', 'ram', 'storage'])

    const withGpu = assignComponent(emptyProject, 'srv', 'gpu')

    expect(getVisibleServerSlotTypes(withGpu, 'srv')).toEqual(['cpu', 'ram', 'storage', 'gpu'])

    const withNetwork = assignComponent(withGpu, 'srv', 'wifi')

    expect(getVisibleServerSlotTypes(withNetwork, 'srv')).toEqual([
      'cpu',
      'ram',
      'storage',
      'gpu',
      'network',
    ])

    const gpuAssignment = withNetwork.assignments.find((assignment) => assignment.type === 'gpu')
    const withoutGpu = removeAssignment(withNetwork, gpuAssignment?.id ?? '')

    expect(getVisibleServerSlotTypes(withoutGpu, 'srv')).toEqual([
      'cpu',
      'ram',
      'storage',
      'network',
    ])
  })

  it('swaps CPUs when moving one CPU onto another populated server', () => {
    const base = mergeInventoryWithProject(items, null)
    const first = assignComponent(base, 'srv', 'cpu-a')
    const populated = assignComponent(first, 'srv-two', 'cpu-b')
    const sourceAssignment = populated.assignments.find((assignment) => assignment.itemId === 'cpu-a')
    const result = swapAssignedComponent(populated, sourceAssignment?.id ?? '', 'srv-two')

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(result.project.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceAssignment?.id,
          serverId: 'srv-two',
          itemId: 'cpu-a',
          type: 'cpu',
        }),
        expect.objectContaining({
          serverId: 'srv',
          itemId: 'cpu-b',
          type: 'cpu',
        }),
      ]),
    )
  })

  it('swaps RAM when moving one RAM module onto another populated server', () => {
    const base = mergeInventoryWithProject(items, null)
    const first = assignComponent(base, 'srv', 'ram')
    const populated = assignComponent(first, 'srv-two', 'ram-b')
    const sourceAssignment = populated.assignments.find((assignment) => assignment.itemId === 'ram')
    const result = swapAssignedComponent(populated, sourceAssignment?.id ?? '', 'srv-two')

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(result.project.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceAssignment?.id,
          serverId: 'srv-two',
          itemId: 'ram',
          type: 'ram',
        }),
        expect.objectContaining({
          serverId: 'srv',
          itemId: 'ram-b',
          type: 'ram',
        }),
      ]),
    )
  })

  it('rejects moving an archived component or swapping with an archived target component', () => {
    const base = mergeInventoryWithProject(items, null)
    const first = assignComponent(base, 'srv', 'cpu-a')
    const populated = assignComponent(first, 'srv-two', 'cpu-b')
    const sourceAssignment = populated.assignments.find((assignment) => assignment.itemId === 'cpu-a')
    const archivedSource: typeof populated = {
      ...populated,
      items: {
        ...populated.items,
        'cpu-a': archived(populated.items['cpu-a']),
      },
    }
    const archivedTarget: typeof populated = {
      ...populated,
      items: {
        ...populated.items,
        'cpu-b': archived(populated.items['cpu-b']),
      },
    }

    expect(swapAssignedComponent(archivedSource, sourceAssignment?.id ?? '', 'srv-two')).toEqual({
      ok: false,
      message: 'Restore archived components and hosts before moving or swapping them.',
    })
    expect(swapAssignedComponent(archivedTarget, sourceAssignment?.id ?? '', 'srv-two')).toEqual({
      ok: false,
      message: 'Restore archived components before moving or swapping them.',
    })
  })
})
