import { isHostCompatibilityEnabled, planHostAllocations } from '@/lib/compatibility'
import { isAssignableComponentType } from '@/lib/inventory-capabilities'
import type { ProjectCompatibilityResult } from '@/lib/compatibility'
import { nextNumericId } from '@/lib/ids'
import { isArchivedItem, placementCollides, touchProject } from '@/lib/project'
import type { CompatibilityFinding, CompatibilityResult } from '@/types/compatibility'
import type {
  ComponentAssignment,
  ComponentType,
  InventoryItem,
  ProjectState,
  SlotStatus,
  ValidationResult,
} from '@/types/inventory'

export const COMPONENT_ORDER: ComponentType[] = [
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
  'motherboard',
  'cpuCooler',
  'case',
  'powerSupply',
  'soundCard',
  'wireless',
  'powerAdapter',
]

export const REQUIRED_SERVER_SLOT_TYPES: ComponentType[] = [
  'cpu',
  'ram',
  'storage',
]

export const SLOT_LABELS: Record<ComponentType, string> = {
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'Storage',
  gpu: 'GPU',
  network: 'Network',
  motherboard: 'Motherboard',
  cpuCooler: 'CPU Cooler',
  case: 'Case',
  powerSupply: 'Power Supply',
  soundCard: 'Sound Card',
  wireless: 'Wireless',
  powerAdapter: 'Power Adapter',
}

const SINGLE_ITEM_TYPES = new Set<ComponentType>(['cpu', 'ram', 'gpu', 'network'])
const NAS_COMPONENT_TYPES = new Set<ComponentType>(['cpu', 'ram', 'storage', 'network'])
const SWAPPABLE_COMPONENT_TYPES = new Set<ComponentType>(['cpu', 'ram'])
const ALWAYS_ENFORCED_COMPATIBILITY_CODES = new Set([
  'compatibility.resource.exhausted',
  'memory.slots.exceeded',
])
const NAS_COMPONENT_MESSAGE = 'A NAS can accept CPU, RAM, storage drives, and network cards.'

export type AssignmentMutationResult =
  | {
      ok: true
      project: ProjectState
      compatibility: ProjectCompatibilityResult[]
      unknownFindings: CompatibilityFinding[]
    }
  | {
      ok: false
      message: string
      compatibility?: ProjectCompatibilityResult[]
    }

type PlannedTransition = {
  project: ProjectState
  compatibility: ProjectCompatibilityResult[]
  unknownFindings: CompatibilityFinding[]
}

function typedId(id: string | number): string {
  return JSON.stringify([typeof id, id])
}

function assignmentIdentity(assignment: Pick<ComponentAssignment, 'serverId' | 'id'>): string {
  return JSON.stringify([assignment.serverId, typeof assignment.id, assignment.id])
}

export function findAssignmentById(
  assignments: ComponentAssignment[],
  assignmentId: string | number,
): ComponentAssignment | undefined {
  const exact = assignments.find((assignment) => Object.is(assignment.id, assignmentId))
  if (exact) return exact

  const normalized = assignments.filter(
    (assignment) => String(assignment.id) === String(assignmentId),
  )
  return normalized.length === 1 ? normalized[0] : undefined
}

export function getAssignedComponentDropGeometryError(
  originalProject: ProjectState,
  candidateProject: ProjectState,
  assignment: ComponentAssignment,
  targetServerId: string,
): string | null {
  if (candidateProject === originalProject || assignment.serverId === targetServerId) {
    return null
  }

  const targetPlacement = candidateProject.placements.find(
    (placement) => placement.serverId === targetServerId,
  )
  const sourcePlacement = candidateProject.placements.find(
    (placement) => placement.serverId === assignment.serverId,
  )

  return (
    (targetPlacement && placementCollides(candidateProject, targetPlacement)) ||
    (sourcePlacement && placementCollides(candidateProject, sourcePlacement))
  )
    ? 'This server needs more open space before moving that component.'
    : null
}

function compatibilityFingerprint(
  result: ProjectCompatibilityResult,
  finding: CompatibilityFinding,
): string {
  return JSON.stringify([
    result.hostId,
    typeof result.assignmentId,
    result.assignmentId,
    finding.code,
    finding.field ?? '',
    finding.resourceId ?? '',
    finding.message,
  ])
}

function shouldEnforceCompatibilityFinding(
  project: ProjectState,
  result: ProjectCompatibilityResult,
  finding: CompatibilityFinding,
): boolean {
  return (
    isHostCompatibilityEnabled(project, result.hostId) ||
    ALWAYS_ENFORCED_COMPATIBILITY_CODES.has(finding.code)
  )
}

function planHosts(project: ProjectState, hostIds: string[]): PlannedTransition {
  let plannedProject = project
  const compatibility: ProjectCompatibilityResult[] = []

  for (const hostId of [...new Set(hostIds)]) {
    const plan = planHostAllocations(plannedProject, hostId)
    const plannedAssignments = new Map(
      plan.assignments.map((assignment) => [assignmentIdentity(assignment), assignment]),
    )

    plannedProject = {
      ...plannedProject,
      assignments: plannedProject.assignments.map((assignment) =>
        assignment.serverId === hostId
          ? plannedAssignments.get(assignmentIdentity(assignment)) ?? assignment
          : assignment,
      ),
    }
    compatibility.push(...plan.results)
  }

  return { project: plannedProject, compatibility, unknownFindings: [] }
}

function evaluateTransition(
  original: ProjectState,
  tentative: ProjectState,
  affectedHostIds: string[],
): AssignmentMutationResult {
  const baseline = [...new Set(affectedHostIds)].flatMap(
    (hostId) => planHostAllocations(original, hostId).results,
  )
  const planned = planHosts(tentative, affectedHostIds)
  const baselineErrors = new Set(
    baseline.flatMap((result) =>
      result.findings
        .filter(
          (finding) =>
            finding.severity === 'error' &&
            shouldEnforceCompatibilityFinding(tentative, result, finding),
        )
        .map((finding) => compatibilityFingerprint(result, finding)),
    ),
  )
  const baselineUnknown = new Set(
    baseline.flatMap((result) =>
      result.findings
        .filter(
          (finding) =>
            finding.severity === 'unknown' &&
            shouldEnforceCompatibilityFinding(tentative, result, finding),
        )
        .map((finding) => compatibilityFingerprint(result, finding)),
    ),
  )
  const introducedErrors = planned.compatibility.flatMap((result) =>
    result.findings.filter(
      (finding) =>
        finding.severity === 'error' &&
        shouldEnforceCompatibilityFinding(tentative, result, finding) &&
        !baselineErrors.has(compatibilityFingerprint(result, finding)),
    ),
  )

  if (introducedErrors.length > 0) {
    return {
      ok: false,
      message: [...new Set(introducedErrors.map((finding) => finding.message))].join(' '),
      compatibility: planned.compatibility,
    }
  }

  planned.unknownFindings = planned.compatibility.flatMap((result) =>
    result.findings.filter(
      (finding) =>
        finding.severity === 'unknown' &&
        shouldEnforceCompatibilityFinding(tentative, result, finding) &&
        !baselineUnknown.has(compatibilityFingerprint(result, finding)),
    ),
  )

  return { ok: true, ...planned }
}

function validateAssignmentBasics(
  project: ProjectState,
  serverId: string,
  itemId: string,
): ValidationResult {
  const host = project.items[serverId]
  const item = project.items[itemId]

  if (!host || (host.type !== 'server' && host.type !== 'nas')) {
    return { ok: false, message: 'Drop components onto a server or NAS.' }
  }

  if (isArchivedItem(host)) {
    return { ok: false, message: 'Restore this server or NAS before assigning components.' }
  }

  if (!item) {
    return { ok: false, message: 'That inventory item no longer exists.' }
  }

  if (isArchivedItem(item)) {
    return { ok: false, message: `Restore ${item.name} before assigning it.` }
  }

  if (!isAssignableComponentType(item.type)) {
    return { ok: false, message: 'Canvas equipment belongs on the canvas, not inside another item.' }
  }

  if (host.type === 'nas' && !NAS_COMPONENT_TYPES.has(item.type)) {
    return { ok: false, message: NAS_COMPONENT_MESSAGE }
  }

  const alreadyAssigned = project.assignments.find((assignment) => assignment.itemId === itemId)

  if (alreadyAssigned && alreadyAssigned.serverId !== serverId) {
    return { ok: false, message: `${item.name} is already assigned to another item.` }
  }

  if (alreadyAssigned && alreadyAssigned.serverId === serverId) {
    return { ok: false, message: `${item.name} is already attached to this item.` }
  }

  if (SINGLE_ITEM_TYPES.has(item.type)) {
    const existing = project.assignments.find(
      (assignment) => assignment.serverId === serverId && assignment.type === item.type,
    )

    if (existing) {
      const label = item.type === 'network' ? 'network card' : SLOT_LABELS[item.type]
      return { ok: false, message: `This ${host.type === 'nas' ? 'NAS' : 'server'} already has a ${label}.` }
    }
  }

  return { ok: true }
}

function newAssignment(
  project: ProjectState,
  serverId: string,
  itemId: string,
  item: InventoryItem & { type: ComponentType },
): ComponentAssignment {
  return {
    id: nextNumericId(project.assignments.map((assignment) => assignment.id)),
    serverId,
    itemId,
    type: item.type,
    assignedAt: new Date().toISOString(),
  }
}

function candidateCompatibility(
  compatibility: ProjectCompatibilityResult[],
  assignment: ComponentAssignment,
): CompatibilityResult | undefined {
  return compatibility.find(
    (result) =>
      result.hostId === assignment.serverId &&
      typedId(result.assignmentId) === typedId(assignment.id),
  )
}

export function sortAssignmentsForDisplay(
  project: ProjectState,
  serverId: string,
): ComponentAssignment[] {
  return project.assignments
    .filter((assignment) => assignment.serverId === serverId)
    .sort((a, b) => {
      const typeDelta = COMPONENT_ORDER.indexOf(a.type) - COMPONENT_ORDER.indexOf(b.type)

      if (typeDelta !== 0) {
        return typeDelta
      }

      return a.assignedAt.localeCompare(b.assignedAt)
    })
}

export function getVisibleServerSlotTypes(
  project: ProjectState,
  serverId: string,
): ComponentType[] {
  const assignedTypes = new Set(
    project.assignments
      .filter((assignment) => assignment.serverId === serverId)
      .map((assignment) => assignment.type),
  )

  return COMPONENT_ORDER.filter(
    (type) => REQUIRED_SERVER_SLOT_TYPES.includes(type) || assignedTypes.has(type),
  )
}

export function getSlotStatus(project: ProjectState, serverId: string): SlotStatus[] {
  return COMPONENT_ORDER.map((type) => {
    const filled = project.assignments.filter(
      (assignment) => assignment.serverId === serverId && assignment.type === type,
    ).length

    return {
      type,
      label: SLOT_LABELS[type],
      filled,
      limit: type === 'storage' ? null : 1,
    }
  })
}

export function validateAssignment(
  project: ProjectState,
  serverId: string,
  itemId: string,
): ValidationResult {
  const basic = validateAssignmentBasics(project, serverId, itemId)
  if (!basic.ok) return basic

  const item = project.items[itemId]
  if (!item || !isAssignableComponentType(item.type)) {
    return { ok: false, message: 'That inventory item no longer exists.' }
  }

  const assignment = newAssignment(
    project,
    serverId,
    itemId,
    item as InventoryItem & { type: ComponentType },
  )
  const transition = evaluateTransition(
    project,
    { ...project, assignments: [...project.assignments, assignment] },
    [serverId],
  )

  if (!transition.ok) {
    return {
      ok: false,
      message: transition.message,
      compatibility: candidateCompatibility(transition.compatibility ?? [], assignment),
    }
  }

  return {
    ok: true,
    compatibility: candidateCompatibility(transition.compatibility, assignment),
  }
}

export function tryAssignComponent(
  project: ProjectState,
  serverId: string,
  itemId: string,
): AssignmentMutationResult {
  const basic = validateAssignmentBasics(project, serverId, itemId)
  if (!basic.ok) return { ok: false, message: basic.message }

  const item = project.items[itemId]
  if (!item || !isAssignableComponentType(item.type)) {
    return { ok: false, message: 'That inventory item no longer exists.' }
  }

  const assignment = newAssignment(
    project,
    serverId,
    itemId,
    item as InventoryItem & { type: ComponentType },
  )
  const transition = evaluateTransition(
    project,
    { ...project, assignments: [...project.assignments, assignment] },
    [serverId],
  )

  if (!transition.ok) return transition
  return { ...transition, project: touchProject(transition.project) }
}

export function assignComponent(project: ProjectState, serverId: string, itemId: string): ProjectState {
  const result = tryAssignComponent(project, serverId, itemId)
  return result.ok ? result.project : project
}

export function moveAssignedComponent(
  project: ProjectState,
  assignmentId: string | number,
  targetServerId: string,
): AssignmentMutationResult {
  const sourceAssignment = findAssignmentById(project.assignments, assignmentId)
  if (!sourceAssignment) {
    return { ok: false, message: 'That assigned component is no longer attached.' }
  }

  const item = project.items[sourceAssignment.itemId]
  const sourceHost = project.items[sourceAssignment.serverId]
  const targetHost = project.items[targetServerId]

  if (!item || !sourceHost || !targetHost) {
    return { ok: false, message: 'That component or server no longer exists.' }
  }

  if (!['server', 'nas'].includes(sourceHost.type) || !['server', 'nas'].includes(targetHost.type)) {
    return { ok: false, message: 'Drop components onto a server or NAS.' }
  }

  if (isArchivedItem(item) || isArchivedItem(sourceHost) || isArchivedItem(targetHost)) {
    return { ok: false, message: 'Restore archived components and hosts before moving or swapping them.' }
  }

  if (sourceAssignment.serverId === targetServerId) {
    return {
      ok: true,
      project,
      compatibility: planHostAllocations(project, targetServerId).results,
      unknownFindings: [],
    }
  }

  const targetAssignment = SWAPPABLE_COMPONENT_TYPES.has(sourceAssignment.type)
    ? project.assignments.find(
        (assignment) =>
          assignment.serverId === targetServerId && assignment.type === sourceAssignment.type,
      )
    : undefined
  const targetItem = targetAssignment ? project.items[targetAssignment.itemId] : undefined

  if (targetAssignment && !targetItem) {
    return { ok: false, message: 'That component or server no longer exists.' }
  }

  if (isArchivedItem(targetItem)) {
    return { ok: false, message: 'Restore archived components before moving or swapping them.' }
  }

  if (!targetAssignment) {
    const projectWithoutSource: ProjectState = {
      ...project,
      assignments: project.assignments.filter(
        (assignment) => assignmentIdentity(assignment) !== assignmentIdentity(sourceAssignment),
      ),
    }
    const basic = validateAssignmentBasics(projectWithoutSource, targetServerId, sourceAssignment.itemId)
    if (!basic.ok) return { ok: false, message: basic.message }
  }

  const tentative: ProjectState = {
    ...project,
    assignments: project.assignments.map((assignment) => {
      if (assignmentIdentity(assignment) === assignmentIdentity(sourceAssignment)) {
        return { ...assignment, serverId: targetServerId }
      }
      if (
        targetAssignment &&
        assignmentIdentity(assignment) === assignmentIdentity(targetAssignment)
      ) {
        return { ...assignment, serverId: sourceAssignment.serverId }
      }
      return assignment
    }),
  }
  const transition = evaluateTransition(
    project,
    tentative,
    [sourceAssignment.serverId, targetServerId],
  )

  if (!transition.ok) return transition
  return { ...transition, project: touchProject(transition.project) }
}

export function swapAssignedComponent(
  project: ProjectState,
  assignmentId: string | number,
  targetServerId: string,
): AssignmentMutationResult {
  const sourceAssignment = findAssignmentById(project.assignments, assignmentId)
  if (!sourceAssignment) {
    return { ok: false, message: 'That assigned component is no longer attached.' }
  }
  if (!SWAPPABLE_COMPONENT_TYPES.has(sourceAssignment.type)) {
    return { ok: false, message: 'Only CPU and RAM slots can be swapped.' }
  }
  return moveAssignedComponent(project, sourceAssignment.id, targetServerId)
}
