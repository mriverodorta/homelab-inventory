import { describe, expect, it } from 'vitest'
import { moveAssignedComponent } from '@/lib/constraints'
import type { ComponentAssignment, ProjectState } from '@/types/inventory'

function legacyOverlappingProject(): ProjectState {
  return {
    id: 'default',
    metadata: {
      name: 'Legacy overlapping layout',
      version: 1,
      updatedAt: '2026-07-19T00:00:00.000Z',
    },
    items: {
      'server:1': { id: 1, key: 'server:1', name: 'Source', type: 'server' },
      'server:2': { id: 2, key: 'server:2', name: 'Neighbor', type: 'server' },
      'ram:1': { id: 1, key: 'ram:1', name: 'RAM', type: 'ram' },
    },
    placements: [
      { serverId: 'server:1', x: 0, y: 0 },
      { serverId: 'server:2', x: 0, y: 0 },
    ],
    assignments: [{
      id: 1,
      serverId: 'server:1',
      itemId: 'ram:1',
      type: 'ram',
      assignedAt: '2026-07-19T00:00:00.000Z',
    }],
    connections: [],
  }
}

describe('assigned component drop guards', () => {
  it.each([
    ['component', 'ram:1'],
    ['host', 'server:1'],
  ])('preserves the restore error for an archived same-host %s', (_, archivedItemId) => {
    const original = legacyOverlappingProject()
    const project: ProjectState = {
      ...original,
      items: {
        ...original.items,
        [archivedItemId]: {
          ...original.items[archivedItemId],
          archivedAt: '2026-07-19T12:00:00.000Z',
        },
      },
    }
    const before = JSON.stringify(project)
    const assignment = project.assignments[0] as ComponentAssignment

    expect(moveAssignedComponent(project, assignment.id, 'server:1')).toEqual({
      ok: false,
      message: 'Restore archived components and hosts before moving or swapping them.',
    })
    expect(JSON.stringify(project)).toBe(before)
  })

  it.each([
    ['component', 'ram:1'],
    ['host', 'server:1'],
  ])('preserves stale-record validation for a missing same-host %s', (_, missingItemId) => {
    const original = legacyOverlappingProject()
    const items = { ...original.items }
    delete items[missingItemId]
    const project = { ...original, items }
    const before = JSON.stringify(project)

    expect(moveAssignedComponent(project, 1, 'server:1')).toEqual({
      ok: false,
      message: 'That component or server no longer exists.',
    })
    expect(JSON.stringify(project)).toBe(before)
  })
})
