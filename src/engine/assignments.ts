import type {
  AssignmentChange,
  EngineAssignment,
  EngineResponse,
} from '../../shared/engine/protocol.mjs'
import type { DomainEngineClient } from '@/engine/client'
import { applyEngineResponsePatch } from '@/engine/project-patches'
import { toTopologyItemRef } from '@/engine/topology'
import type { ComponentAssignment, ProjectState } from '@/types/inventory'

function engineAssignment(
  project: ProjectState,
  assignment: ComponentAssignment,
): EngineAssignment {
  return {
    id: assignment.id,
    host: toTopologyItemRef(project, assignment.serverId),
    item: toTopologyItemRef(project, assignment.itemId),
    component_type: assignment.type,
    assigned_at: assignment.assignedAt,
    allocation: assignment.allocation
      ? {
          resource_type: assignment.allocation.resourceType,
          group_id: assignment.allocation.groupId ?? null,
          positions: [...assignment.allocation.positions],
        }
      : null,
  }
}

function allocationsEqual(
  left: ComponentAssignment['allocation'],
  right: ComponentAssignment['allocation'],
) {
  if (!left || !right) return left === right
  return left.resourceType === right.resourceType
    && (left.groupId ?? null) === (right.groupId ?? null)
    && left.positions.length === right.positions.length
    && left.positions.every((position, index) => position === right.positions[index])
}

export function assignmentsEqual(
  left: readonly ComponentAssignment[],
  right: readonly ComponentAssignment[],
) {
  if (left.length !== right.length) return false
  const rightById = new Map(right.map((assignment) => [assignment.id, assignment]))
  return left.every((assignment) => {
    const candidate = rightById.get(assignment.id)
    return candidate
      && assignment.serverId === candidate.serverId
      && assignment.itemId === candidate.itemId
      && assignment.type === candidate.type
      && assignment.assignedAt === candidate.assignedAt
      && allocationsEqual(assignment.allocation, candidate.allocation)
  })
}

export function assignmentChanges(
  previousProject: ProjectState,
  nextProject: ProjectState,
): AssignmentChange[] {
  const previous = new Map(previousProject.assignments.map((assignment) => [assignment.id, assignment]))
  const next = new Map(nextProject.assignments.map((assignment) => [assignment.id, assignment]))
  const ids = [...new Set([...previous.keys(), ...next.keys()])].sort((left, right) => left - right)

  return ids.flatMap((id) => {
    const previousAssignment = previous.get(id)
    const nextAssignment = next.get(id)
    if (
      previousAssignment
      && nextAssignment
      && assignmentsEqual([previousAssignment], [nextAssignment])
    ) {
      return []
    }
    return [{
      previous: previousAssignment ? engineAssignment(previousProject, previousAssignment) : null,
      next: nextAssignment ? engineAssignment(nextProject, nextAssignment) : null,
    }]
  })
}

export function applyAssignmentTransition(
  canonicalProject: ProjectState,
  previousProject: ProjectState,
  nextProject: ProjectState,
): ProjectState {
  const previous = new Map(previousProject.assignments.map((assignment) => [assignment.id, assignment]))
  const next = new Map(nextProject.assignments.map((assignment) => [assignment.id, assignment]))
  const canonical = new Map(canonicalProject.assignments.map((assignment) => [assignment.id, assignment]))
  const ids = [...new Set([...previous.keys(), ...next.keys()])].sort((left, right) => left - right)

  for (const id of ids) {
    const before = previous.get(id)
    const after = next.get(id)
    if (before && after && assignmentsEqual([before], [after])) continue

    const current = canonical.get(id)
    const currentMatchesBefore = before
      ? Boolean(current && assignmentsEqual([current], [before]))
      : current === undefined
    if (!currentMatchesBefore) {
      throw new Error(`Assignment ${String(id)} changed before this action could be saved.`)
    }

    if (after) canonical.set(id, after)
    else canonical.delete(id)
  }

  return {
    ...canonicalProject,
    metadata: {
      ...canonicalProject.metadata,
      updatedAt: nextProject.metadata.updatedAt,
    },
    assignments: [...canonical.values()].sort((left, right) => left.id - right.id),
  }
}

export async function updateProjectAssignments(
  client: DomainEngineClient,
  previousProject: ProjectState,
  nextProject: ProjectState,
) {
  const changes = assignmentChanges(previousProject, nextProject)
  if (changes.length === 0) return null
  return client.mutate({
    operation: {
      kind: 'update-assignments',
      payload: { changes },
    },
  })
}

export function acknowledgeOptimisticAssignments(
  canonicalProject: ProjectState,
  optimisticProject: ProjectState,
  response: EngineResponse,
): ProjectState {
  const committedProject = applyEngineResponsePatch(canonicalProject, response)
  if (!assignmentsEqual(committedProject.assignments, optimisticProject.assignments)) {
    throw new Error('Committed assignments did not match the optimistic workspace change.')
  }
  return {
    ...optimisticProject,
    revision: committedProject.revision,
  }
}
