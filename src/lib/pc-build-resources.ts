import type {
  CompatibilityAllocation,
  CompatibilityResourceType,
  ExpansionSlotGroup,
  StorageSlotGroup,
} from '@/types/compatibility'
import type { ComponentAssignment, ComponentType, InventoryItem } from '@/types/inventory'
import type {
  CpuSocketGroup,
  MemorySlotGroup,
  MotherboardResources,
  PcBuildAllocationRequest,
  PcBuildAllocationResult,
} from '@/types/pc-build'

type ResourceGroup =
  | CpuSocketGroup
  | MemorySlotGroup
  | StorageSlotGroup
  | ExpansionSlotGroup

const LOGICAL_RESOURCE_TYPES = new Map<ComponentType, CompatibilityResourceType>([
  ['motherboard', 'motherboard'],
  ['powerSupply', 'power'],
  ['case', 'case'],
])

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : []
}

function normalized(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim().toLowerCase()
    : undefined
}

function includesNormalized(values: string[] | undefined, value: unknown): boolean {
  const expected = normalized(value)
  return expected !== undefined && (values ?? []).some((entry) => normalized(entry) === expected)
}

function cloneStorageGroup(group: StorageSlotGroup): StorageSlotGroup | undefined {
  const count = positiveInteger(group.count)
  if (!group.id || !group.label || count === undefined) return undefined
  return {
    ...group,
    count,
    ...(group.interfaces ? { interfaces: [...group.interfaces] } : {}),
    ...(group.formFactors ? { formFactors: [...group.formFactors] } : {}),
  }
}

function cloneExpansionGroup(group: ExpansionSlotGroup): ExpansionSlotGroup | undefined {
  const count = positiveInteger(group.count)
  if (!group.id || !group.label || count === undefined || !group.interfaceFamily) return undefined
  return {
    ...group,
    count,
    ...(group.acceptedHeights ? { acceptedHeights: [...group.acceptedHeights] } : {}),
  }
}

export function motherboardResources(item: InventoryItem): MotherboardResources {
  const host = item.compatibility?.host
  const sockets = stringArray(host?.cpu?.sockets)
  const socketCount = positiveInteger(item.specs?.cpuSocketCount ?? item.specs?.cpuSockets) ?? 1
  const memoryCount = positiveInteger(host?.memory?.slots)

  return {
    cpuSockets: sockets.length > 0
      ? [{
          id: 'cpu',
          label: socketCount === 1 ? 'CPU socket' : 'CPU sockets',
          count: socketCount,
          socket: sockets[0],
          ...(host?.cpu?.generations?.length
            ? { supportedGenerations: [...host.cpu.generations] }
            : {}),
          ...(host?.cpu?.maxTdpWatts !== undefined
            ? { maxTdpWatts: host.cpu.maxTdpWatts }
            : {}),
        }]
      : [],
    memorySlots: memoryCount === undefined
      ? []
      : [{
          id: 'dimm',
          label: 'DIMM slots',
          count: memoryCount,
          generations: stringArray(host?.memory?.generations),
          ...(host?.memory?.maxCapacityGb !== undefined
            ? { maxCapacityGb: host.memory.maxCapacityGb }
            : {}),
          ...(host?.memory?.maxModuleCapacityGb !== undefined
            ? { maxModuleCapacityGb: host.memory.maxModuleCapacityGb }
            : {}),
          ...(host?.memory?.maxSpeedMt !== undefined
            ? { maxSpeedMt: host.memory.maxSpeedMt }
            : {}),
        }],
    storageSlots: (host?.storageSlots ?? [])
      .map(cloneStorageGroup)
      .filter((group): group is StorageSlotGroup => group !== undefined),
    expansionSlots: (host?.expansionSlots ?? [])
      .map(cloneExpansionGroup)
      .filter((group): group is ExpansionSlotGroup => group !== undefined),
  }
}

export function occupiedPositions(
  assignments: ComponentAssignment[],
  resourceType: CompatibilityResourceType,
  groupId?: string,
): Set<number> {
  const positions = new Set<number>()
  for (const assignment of assignments) {
    const allocation = assignment.allocation
    if (
      allocation?.resourceType !== resourceType
      || (allocation.groupId ?? undefined) !== (groupId ?? undefined)
    ) {
      continue
    }
    for (const position of allocation.positions) {
      if (Number.isSafeInteger(position) && position >= 0) positions.add(position)
    }
  }
  return positions
}

function resourceTypeFor(componentType: ComponentType): CompatibilityResourceType | undefined {
  if (componentType === 'cpu') return 'cpu'
  if (componentType === 'cpuCooler') return 'cooling'
  if (componentType === 'ram') return 'memory'
  if (componentType === 'storage') return 'storage'
  if (['gpu', 'network', 'soundCard', 'wireless'].includes(componentType)) return 'expansion'
  return LOGICAL_RESOURCE_TYPES.get(componentType)
}

function groupsFor(
  componentType: ComponentType,
  resources: MotherboardResources,
): ResourceGroup[] {
  if (componentType === 'cpu') return resources.cpuSockets
  if (componentType === 'cpuCooler') return resources.cpuSockets
  if (componentType === 'ram') return resources.memorySlots
  if (componentType === 'storage') return resources.storageSlots
  if (['gpu', 'network', 'soundCard', 'wireless'].includes(componentType)) {
    return resources.expansionSlots
  }
  return []
}

function groupMatches(
  componentType: ComponentType,
  group: ResourceGroup,
  requirements: Record<string, unknown>,
): boolean {
  if (componentType === 'cpu') {
    const cpu = group as CpuSocketGroup
    const socket = requirements.socket
    const generation = requirements.generation
    const tdpWatts = optionalNumber(requirements.tdpWatts)
    return (socket === undefined || normalized(cpu.socket) === normalized(socket))
      && (generation === undefined || includesNormalized(cpu.supportedGenerations, generation))
      && (tdpWatts === undefined || cpu.maxTdpWatts === undefined || tdpWatts <= cpu.maxTdpWatts)
  }

  if (componentType === 'cpuCooler') return true

  if (componentType === 'ram') {
    const memory = group as MemorySlotGroup
    const generation = requirements.generation
    const moduleCapacityGb = optionalNumber(requirements.moduleCapacityGb)
    const speedMt = optionalNumber(requirements.speedMt)
    return (generation === undefined || includesNormalized(memory.generations, generation))
      && (moduleCapacityGb === undefined
        || memory.maxModuleCapacityGb === undefined
        || moduleCapacityGb <= memory.maxModuleCapacityGb)
      && (speedMt === undefined || memory.maxSpeedMt === undefined || speedMt <= memory.maxSpeedMt)
  }

  if (componentType === 'storage') {
    const storage = group as StorageSlotGroup
    return (requirements.interfaces === undefined
      || (Array.isArray(requirements.interfaces)
        && requirements.interfaces.some((value) => includesNormalized(storage.interfaces, value))))
      && (requirements.formFactors === undefined
        || (Array.isArray(requirements.formFactors)
          && requirements.formFactors.some((value) => includesNormalized(storage.formFactors, value))))
  }

  const expansion = group as ExpansionSlotGroup
  const interfaceFamily = requirements.interfaceFamily
  const connectorLanes = optionalNumber(requirements.connectorLanes)
  const height = requirements.height
  const slotWidth = optionalNumber(requirements.slotWidth)
  return (interfaceFamily === undefined
      || normalized(expansion.interfaceFamily) === normalized(interfaceFamily))
    && (connectorLanes === undefined
      || expansion.mechanicalLanes === undefined
      || connectorLanes <= expansion.mechanicalLanes)
    && (height === undefined || includesNormalized(expansion.acceptedHeights, height))
    && (slotWidth === undefined
      || expansion.maxSlotWidth === undefined
      || slotWidth <= expansion.maxSlotWidth)
}

function firstFreePositions(count: number, occupied: Set<number>, required: number): number[] {
  const positions: number[] = []
  for (let position = 0; position < count && positions.length < required; position += 1) {
    if (!occupied.has(position)) positions.push(position)
  }
  return positions
}

function noCapacityMessage(resourceType: CompatibilityResourceType): string {
  const labels: Record<CompatibilityResourceType, string> = {
    cpu: 'CPU socket',
    memory: 'memory',
    storage: 'storage',
    expansion: 'expansion',
    motherboard: 'motherboard',
    cooling: 'cooling',
    power: 'power supply',
    case: 'case',
  }
  return `No available ${labels[resourceType]} positions can satisfy this component.`
}

export function allocatePcBuildResource(
  request: PcBuildAllocationRequest,
): PcBuildAllocationResult {
  const resourceType = resourceTypeFor(request.componentType)
  if (!resourceType) {
    return { ok: false, message: `Component type ${request.componentType} does not use a PC Build resource.` }
  }
  if (!Number.isSafeInteger(request.requiredPositions) || request.requiredPositions < 1) {
    return { ok: false, message: 'Required positions must be a positive whole number.' }
  }

  if (LOGICAL_RESOURCE_TYPES.has(request.componentType)) {
    const occupied = occupiedPositions(request.assignments, resourceType)
    const positions = firstFreePositions(1, occupied, request.requiredPositions)
    return positions.length === request.requiredPositions
      ? { ok: true, allocation: { resourceType, positions } }
      : { ok: false, message: noCapacityMessage(resourceType) }
  }

  const resources = motherboardResources(request.motherboard)
  const requirements = request.requirements ?? {}
  for (const group of groupsFor(request.componentType, resources)) {
    if (!groupMatches(request.componentType, group, requirements)) continue
    const occupied = occupiedPositions(request.assignments, resourceType, group.id)
    const positions = firstFreePositions(group.count, occupied, request.requiredPositions)
    if (positions.length === request.requiredPositions) {
      return {
        ok: true,
        allocation: { resourceType, groupId: group.id, positions },
      }
    }
  }

  return { ok: false, message: noCapacityMessage(resourceType) }
}

export function validatePersistedAllocation(
  request: PcBuildAllocationRequest,
  allocation: CompatibilityAllocation,
): boolean {
  const resourceType = resourceTypeFor(request.componentType)
  if (
    !resourceType
    || allocation.resourceType !== resourceType
    || allocation.positions.length !== request.requiredPositions
    || new Set(allocation.positions).size !== allocation.positions.length
    || allocation.positions.some((position) => !Number.isSafeInteger(position) || position < 0)
  ) {
    return false
  }

  if (LOGICAL_RESOURCE_TYPES.has(request.componentType)) {
    return allocation.groupId === undefined
      && allocation.positions.every((position) => position < 1)
      && allocation.positions.every(
        (position) => !occupiedPositions(request.assignments, resourceType).has(position),
      )
  }

  if (!allocation.groupId) return false
  const group = groupsFor(request.componentType, motherboardResources(request.motherboard))
    .find((candidate) => candidate.id === allocation.groupId)
  if (!group || !groupMatches(request.componentType, group, request.requirements ?? {})) return false
  const occupied = occupiedPositions(request.assignments, resourceType, group.id)
  return allocation.positions.every(
    (position) => position < group.count && !occupied.has(position),
  )
}
