import { describe, expect, it, vi } from 'vitest'
import {
  acknowledgeOptimisticAssignments,
  applyAssignmentTransition,
  assignmentChanges,
  updateProjectAssignments,
} from '@/engine/assignments'
import { createEmptyProject } from '@/lib/project'
import type { DomainEngineClient } from '@/engine/client'

function projectWithAssignment() {
  const project = createEmptyProject([
    { id: 1, name: 'Source', type: 'server' },
    { id: 2, name: 'Target', type: 'server' },
    { id: 1, name: 'RAM', type: 'ram' },
  ])
  return {
    ...project,
    assignments: [{
      id: 1,
      serverId: 'server:1',
      itemId: 'ram:1',
      type: 'ram' as const,
      assignedAt: '2026-07-23T00:00:00.000Z',
      allocation: { resourceType: 'memory' as const, groupId: 2, positions: [1, 2] },
    }],
  }
}

describe('assignment engine adapter', () => {
  it('creates exact assignment changes for add, move, and remove transitions', () => {
    const previous = projectWithAssignment()
    const moved = {
      ...previous,
      assignments: previous.assignments.map((assignment) => ({
        ...assignment,
        serverId: 'server:2',
      })),
    }
    expect(assignmentChanges(previous, moved)).toEqual([{
      previous: {
        id: 1,
        host: { item_type: 'server', id: 1 },
        item: { item_type: 'ram', id: 1 },
        component_type: 'ram',
        assigned_at: '2026-07-23T00:00:00.000Z',
        allocation: { resource_type: 'memory', group_id: 2, positions: [1, 2] },
      },
      next: {
        id: 1,
        host: { item_type: 'server', id: 2 },
        item: { item_type: 'ram', id: 1 },
        component_type: 'ram',
        assigned_at: '2026-07-23T00:00:00.000Z',
        allocation: { resource_type: 'memory', group_id: 2, positions: [1, 2] },
      },
    }])
    expect(assignmentChanges(previous, { ...previous, assignments: [] })[0]?.next).toBeNull()
    expect(assignmentChanges({ ...previous, assignments: [] }, previous)[0]?.previous).toBeNull()
  })

  it('submits one canonical assignment command', async () => {
    const previous = projectWithAssignment()
    const next = { ...previous, assignments: [] }
    const response = {
      protocol_version: 1 as const,
      request_id: 1,
      base_revision: 1,
      result: { kind: 'status' as const, payload: {
        revision: 1,
        geometry_revision: 0,
        routing_revision: 0,
        project_name: 'Lab',
      } },
    }
    const mutate = vi.fn(async () => response)

    await expect(updateProjectAssignments({ mutate } as unknown as DomainEngineClient, previous, next))
      .resolves.toBe(response)
    expect(mutate).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledWith({
      operation: expect.objectContaining({ kind: 'update-assignments' }),
    })
  })

  it('preserves unrelated canonical assignments and rejects changed targets', () => {
    const previous = projectWithAssignment()
    const next = { ...previous, assignments: [] }
    const unrelated = {
      id: 2,
      serverId: 'server:2',
      itemId: 'cpu:1',
      type: 'cpu' as const,
      assignedAt: '2026-07-23T00:01:00.000Z',
    }
    const canonical = {
      ...previous,
      items: {
        ...previous.items,
        'cpu:1': { id: 1, name: 'CPU', type: 'cpu' as const },
      },
      assignments: [...previous.assignments, unrelated],
    }

    expect(applyAssignmentTransition(canonical, previous, next).assignments).toEqual([unrelated])
    expect(() => applyAssignmentTransition(
      { ...canonical, assignments: [{ ...previous.assignments[0], serverId: 'server:2' }, unrelated] },
      previous,
      next,
    )).toThrow('Assignment 1 changed')
  })

  it('acknowledges the revision without replacing optimistic assignment references', () => {
    const canonical = projectWithAssignment()
    const optimistic = {
      ...canonical,
      assignments: canonical.assignments.map((assignment) => ({
        ...assignment,
        serverId: 'server:2',
      })),
    }
    const response = {
      protocol_version: 1 as const,
      request_id: 1,
      base_revision: 1,
      result: {
        kind: 'patch' as const,
        payload: {
          revision: 2,
          forward: {
            kind: 'patch-assignments' as const,
            payload: {
              upsert: [{
                id: 1,
                host: { item_type: 'server', id: 2 },
                item: { item_type: 'ram', id: 1 },
                component_type: 'ram',
                assigned_at: '2026-07-23T00:00:00.000Z',
                allocation: { resource_type: 'memory', group_id: 2, positions: [1, 2] },
              }],
              remove_assignment_ids: [],
            },
          },
          inverse: {
            kind: 'patch-assignments' as const,
            payload: { upsert: [], remove_assignment_ids: [] },
          },
        },
      },
    }

    const acknowledged = acknowledgeOptimisticAssignments(canonical, optimistic, response)
    expect(acknowledged.assignments).toBe(optimistic.assignments)
    expect(acknowledged.revision).toBe(2)
  })
})
