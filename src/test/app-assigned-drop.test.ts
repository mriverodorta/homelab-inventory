import { describe, expect, it } from 'vitest'
import {
  getAssignedComponentDropGeometryError,
  moveAssignedComponent,
} from '@/lib/constraints'
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

describe('assigned component drop geometry gate', () => {
  it('skips geometry rejection for a same-host no-op in a legacy overlapping layout', () => {
    const project = legacyOverlappingProject()
    const assignment = project.assignments[0] as ComponentAssignment
    const result = moveAssignedComponent(project, assignment.id, 'server:1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).toBe(project)
    expect(getAssignedComponentDropGeometryError(project, result.project, assignment, 'server:1')).toBeNull()
  })

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

  it('rejects changed assignments that leave an affected host colliding without mutating input', () => {
    const project = legacyOverlappingProject()
    const before = JSON.stringify(project)
    const assignment = project.assignments[0] as ComponentAssignment
    const candidate: ProjectState = {
      ...project,
      assignments: project.assignments.map((entry) => ({ ...entry, serverId: 'server:2' })),
    }

    expect(getAssignedComponentDropGeometryError(project, candidate, assignment, 'server:2'))
      .toBe('This server needs more open space before moving that component.')
    expect(JSON.stringify(project)).toBe(before)
  })
})
