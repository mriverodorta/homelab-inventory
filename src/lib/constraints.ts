import { nextNumericId } from '@/lib/ids'
import { isArchivedItem, touchProject } from '@/lib/project'
import type {
  ComponentAssignment,
  ComponentType,
  InventoryType,
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
}

const SINGLE_ITEM_TYPES = new Set<ComponentType>(['cpu', 'ram', 'gpu', 'network'])
const CANVAS_EQUIPMENT_TYPES = new Set<InventoryType>(['server', 'nas', 'switch', 'patchPanel'])
const NAS_COMPONENT_TYPES = new Set<ComponentType>(['storage', 'network'])
const SWAPPABLE_COMPONENT_TYPES = new Set<ComponentType>(['cpu', 'ram'])

function isAssignableComponentType(type: InventoryType): type is ComponentType {
  return !CANVAS_EQUIPMENT_TYPES.has(type)
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
    return { ok: false, message: 'A NAS can accept storage drives and network cards.' }
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

export function assignComponent(project: ProjectState, serverId: string, itemId: string): ProjectState {
  const validation = validateAssignment(project, serverId, itemId)

  if (!validation.ok) {
    return project
  }

  const item = project.items[itemId]

  if (!item || !isAssignableComponentType(item.type)) {
    return project
  }

  return touchProject({
    ...project,
    assignments: [
      ...project.assignments,
      {
        id: nextNumericId(project.assignments.map((assignment) => assignment.id)),
        serverId,
        itemId,
        type: item.type,
        assignedAt: new Date().toISOString(),
      },
    ],
  })
}

export function swapAssignedComponent(
  project: ProjectState,
  assignmentId: string | number,
  targetServerId: string,
): { ok: true; project: ProjectState } | { ok: false; message: string } {
  const sourceAssignment = project.assignments.find((assignment) => String(assignment.id) === String(assignmentId))

  if (!sourceAssignment) {
    return { ok: false, message: 'That assigned component is no longer attached.' }
  }

  const item = project.items[sourceAssignment.itemId]
  const sourceHost = project.items[sourceAssignment.serverId]
  const targetHost = project.items[targetServerId]

  if (!item || !sourceHost || !targetHost) {
    return { ok: false, message: 'That component or server no longer exists.' }
  }

  if (isArchivedItem(item) || isArchivedItem(sourceHost) || isArchivedItem(targetHost)) {
    return { ok: false, message: 'Restore archived components and hosts before moving or swapping them.' }
  }

  if (!SWAPPABLE_COMPONENT_TYPES.has(sourceAssignment.type)) {
    return { ok: false, message: 'Only CPU and RAM slots can be swapped.' }
  }

  if (sourceAssignment.serverId === targetServerId) {
    return { ok: true, project }
  }

  if (targetHost.type === 'nas') {
    return { ok: false, message: 'A NAS can accept storage drives and network cards.' }
  }

  const targetAssignment = project.assignments.find(
    (assignment) => assignment.serverId === targetServerId && assignment.type === sourceAssignment.type,
  )

  const targetItem = targetAssignment ? project.items[targetAssignment.itemId] : undefined

  if (isArchivedItem(targetItem)) {
    return { ok: false, message: 'Restore archived components before moving or swapping them.' }
  }

  if (!targetAssignment) {
    const projectWithoutSource = {
      ...project,
      assignments: project.assignments.filter((assignment) => String(assignment.id) !== String(assignmentId)),
    }
    const validation = validateAssignment(projectWithoutSource, targetServerId, sourceAssignment.itemId)

    if (!validation.ok) {
      return validation
    }

    return {
      ok: true,
      project: assignComponent(projectWithoutSource, targetServerId, sourceAssignment.itemId),
    }
  }

  return {
    ok: true,
    project: touchProject({
      ...project,
      assignments: project.assignments.map((assignment) => {
        if (String(assignment.id) === String(sourceAssignment.id)) {
          return {
            ...assignment,
            serverId: targetServerId,
          }
        }

        if (String(assignment.id) === String(targetAssignment.id)) {
          return {
            ...assignment,
            serverId: sourceAssignment.serverId,
          }
        }

        return assignment
      }),
    }),
  }
}
