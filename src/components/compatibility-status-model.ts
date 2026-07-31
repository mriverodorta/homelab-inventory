import { itemKey, parseItemKey, runtimeItemKey } from '@/lib/item-keys'
import type {
  CompatibilityAllocation,
  HostCompatibility,
} from '@/types/compatibility'
import type {
  ComponentAssignment,
  ComponentType,
  InventoryItem,
  InventoryType,
  ProjectState,
} from '@/types/inventory'

type PersistedAssignmentMetadata = {
  hostType?: InventoryType
  hostId?: string | number
  itemType?: InventoryType
}

const componentTypes = new Set<ComponentType>([
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
])

function isComponentType(value: unknown): value is ComponentType {
  return typeof value === 'string' && componentTypes.has(value as ComponentType)
}

function isHostType(value: unknown): value is 'server' | 'nas' {
  return value === 'server' || value === 'nas'
}

export function compatibilityAssignmentIdentity(id: string | number): string {
  return `${typeof id}:${String(id)}`
}

function typedReferenceKey(type: InventoryType, reference: string | number): string {
  if (typeof reference === 'string') {
    const parsed = parseItemKey(reference)
    if (parsed?.type === type) return reference
    if (!Number.isInteger(Number(reference))) return reference
  }

  return itemKey(type, reference)
}

function resolveTypedItemKey(
  items: Record<string, InventoryItem>,
  reference: string | number,
  expectedType: InventoryType,
): string | undefined {
  const normalized = String(reference)
  const parsed = parseItemKey(normalized)
  if (parsed && parsed.type !== expectedType) return undefined

  const direct = items[normalized]
  if (direct?.type === expectedType) return runtimeItemKey(direct)

  const candidates = Object.values(items).filter((item) => (
    item.type === expectedType
    && (
      runtimeItemKey(item) === normalized
      || item.key === normalized
      || String(item.id) === normalized
    )
  ))

  return candidates.length === 1 ? runtimeItemKey(candidates[0]) : undefined
}

function assignmentComponentType(assignment: ComponentAssignment): ComponentType | undefined {
  const metadata = assignment as ComponentAssignment & PersistedAssignmentMetadata
  if (isComponentType(metadata.itemType)) return metadata.itemType

  const parsed = parseItemKey(String(assignment.itemId))
  if (parsed && isComponentType(parsed.type)) return parsed.type

  return isComponentType(assignment.type) ? assignment.type : undefined
}

function assignmentHostType(
  assignment: ComponentAssignment,
  items: Record<string, InventoryItem>,
): 'server' | 'nas' | undefined {
  const metadata = assignment as ComponentAssignment & PersistedAssignmentMetadata
  if (isHostType(metadata.hostType)) return metadata.hostType

  const parsed = parseItemKey(String(assignment.serverId))
  if (parsed && isHostType(parsed.type)) return parsed.type

  const direct = items[String(assignment.serverId)]
  if (direct && isHostType(direct.type)) return direct.type

  const reference = metadata.hostId ?? assignment.serverId
  const candidates = Object.values(items).filter((item) => (
    isHostType(item.type)
    && (
      runtimeItemKey(item) === String(reference)
      || item.key === String(reference)
      || String(item.id) === String(reference)
    )
  ))

  return candidates.length === 1 && isHostType(candidates[0].type)
    ? candidates[0].type
    : undefined
}

export function normalizeCompatibilityViewProject(
  project: ProjectState,
  draftItems: InventoryItem[] = [],
): ProjectState {
  const items: Record<string, InventoryItem> = {}
  for (const item of [...Object.values(project.items), ...draftItems]) {
    items[runtimeItemKey(item)] = item
  }

  const assignments = project.assignments.map((assignment) => {
    const metadata = assignment as ComponentAssignment & PersistedAssignmentMetadata
    const componentType = assignmentComponentType(assignment)
    const hostType = assignmentHostType(assignment, items)
    const hostReference = metadata.hostId ?? assignment.serverId
    const resolvedItemKey = componentType
      ? resolveTypedItemKey(items, assignment.itemId, componentType)
      : undefined
    const resolvedHostKey = hostType
      ? resolveTypedItemKey(items, hostReference, hostType)
      : undefined

    return {
      ...assignment,
      type: componentType ?? assignment.type,
      itemId: resolvedItemKey
        ?? (componentType
          ? typedReferenceKey(componentType, assignment.itemId)
          : `unresolved-item:${compatibilityAssignmentIdentity(assignment.id)}`),
      serverId: resolvedHostKey
        ?? (hostType
          ? typedReferenceKey(hostType, hostReference)
          : `unresolved-host:${compatibilityAssignmentIdentity(assignment.id)}`),
    }
  })

  return { ...project, items, assignments }
}

function allocationGroupLabel(
  allocation: CompatibilityAllocation,
  host: HostCompatibility,
): string | undefined {
  if (!allocation.groupId) return undefined

  const groups = allocation.resourceType === 'storage'
    ? host.storageSlots
    : host.expansionSlots

  return groups?.find((group) => group.id === allocation.groupId)?.label
}

function positionLabel(positions: number[]): string {
  const oneBased = [...positions].sort((left, right) => left - right).map((position) => position + 1)
  if (oneBased.length === 1) return `position ${oneBased[0]}`

  const consecutive = oneBased.every(
    (position, index) => index === 0 || position === oneBased[index - 1] + 1,
  )
  return consecutive
    ? `positions ${oneBased[0]}-${oneBased[oneBased.length - 1]}`
    : `positions ${oneBased.join(', ')}`
}

export function formatCompatibilityAllocation(
  allocation: CompatibilityAllocation | undefined,
  host: HostCompatibility,
): string {
  if (!allocation) return 'No resource position allocated'

  const groupLabel = allocationGroupLabel(allocation, host)
  const resourceLabel = allocation.resourceType === 'memory'
    ? 'Memory'
    : allocation.resourceType === 'storage'
      ? 'Storage'
      : 'Expansion'

  return groupLabel
    ? `${groupLabel}, ${positionLabel(allocation.positions)}`
    : `${resourceLabel} ${positionLabel(allocation.positions)}`
}
