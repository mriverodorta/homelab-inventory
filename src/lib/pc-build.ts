import { normalizeComponentRequirements } from '@/lib/compatibility'
import { allocatePcBuildResource } from '@/lib/pc-build-resources'
import type { ComponentAssignment, ComponentType, InventoryItem, ProjectState } from '@/types/inventory'

export const PC_BUILD_COMPONENT_ORDER: ComponentType[] = [
  'motherboard',
  'cpu',
  'cpuCooler',
  'ram',
  'storage',
  'gpu',
  'soundCard',
  'network',
  'wireless',
  'case',
  'powerSupply',
]

export const REQUIRED_PC_BUILD_COMPONENT_TYPES: ComponentType[] = [
  'motherboard',
  'cpu',
  'cpuCooler',
  'ram',
  'storage',
  'powerSupply',
]

export const PC_BUILD_COMPONENT_TYPES = new Set<ComponentType>(PC_BUILD_COMPONENT_ORDER)

const SINGLE_PC_BUILD_COMPONENT_TYPES = new Set<ComponentType>([
  'motherboard',
  'case',
  'powerSupply',
])

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function ramModuleCount(item: InventoryItem): number {
  const explicit = positiveInteger(item.specs?.moduleCount)
  if (explicit !== undefined) return explicit

  const composition = String(item.specs?.module ?? item.specs?.modules ?? '')
  return positiveInteger(composition.match(/^\s*(\d+)\s*x/i)?.[1]) ?? 1
}

export function requiredPcBuildPositions(item: InventoryItem & { type: ComponentType }): number {
  return item.type === 'ram' ? ramModuleCount(item) : 1
}

export function pcBuildRequirements(item: InventoryItem & { type: ComponentType }): Record<string, unknown> {
  const normalized = normalizeComponentRequirements(item) as Record<string, unknown>

  if (item.type === 'storage') {
    const storageInterface = normalized.interface
    const formFactor = normalized.formFactor
    return {
      ...(storageInterface ? { interfaces: [storageInterface] } : {}),
      ...(formFactor ? { formFactors: [formFactor] } : {}),
    }
  }

  if (item.type === 'ram') {
    return {
      generation: normalized.generation,
      moduleCapacityGb: normalized.moduleCapacityGb,
      speedMt: normalized.speedMt,
    }
  }

  if (['gpu', 'network', 'soundCard', 'wireless'].includes(item.type)) {
    const structured = item.compatibility?.requirements?.expansion ?? {}
    return {
      ...normalized,
      ...structured,
    }
  }

  if (item.type === 'cpuCooler') {
    return {
      socket: item.specs?.socket,
      tdpWatts: item.specs?.maxTdpWatts ?? item.specs?.tdpWatts,
    }
  }

  return normalized
}

export function pcBuildMotherboardAssignment(
  project: ProjectState,
  hostId: string,
): ComponentAssignment | undefined {
  return project.assignments.find(
    (assignment) => assignment.serverId === hostId && assignment.type === 'motherboard',
  )
}

export function pcBuildMotherboard(project: ProjectState, hostId: string): InventoryItem | undefined {
  const assignment = pcBuildMotherboardAssignment(project, hostId)
  return assignment ? project.items[assignment.itemId] : undefined
}

export function pcBuildComponentLimitMessage(
  assignments: ComponentAssignment[],
  item: InventoryItem & { type: ComponentType },
): string | null {
  if (
    SINGLE_PC_BUILD_COMPONENT_TYPES.has(item.type)
    && assignments.some((assignment) => assignment.type === item.type)
  ) {
    return `This PC Build already has a ${item.type === 'powerSupply' ? 'power supply' : item.type}.`
  }

  if (item.type === 'cpuCooler') {
    const cpuCount = assignments.filter((assignment) => assignment.type === 'cpu').length
    const coolerCount = assignments.filter((assignment) => assignment.type === 'cpuCooler').length
    if (coolerCount >= cpuCount) return 'Add a CPU before adding another CPU cooler.'
  }

  return null
}

export function allocatePcBuildAssignment(
  project: ProjectState,
  hostId: string,
  item: InventoryItem & { type: ComponentType },
  assignments: ComponentAssignment[],
) {
  const motherboard = item.type === 'motherboard' ? item : pcBuildMotherboard(project, hostId)
  if (!motherboard) {
    return { ok: false as const, message: 'Add a motherboard before assigning other PC components.' }
  }

  return allocatePcBuildResource({
    componentType: item.type,
    requiredPositions: requiredPcBuildPositions(item),
    motherboard,
    assignments,
    requirements: pcBuildRequirements(item),
  })
}

export function visiblePcBuildSlotTypes(
  project: ProjectState,
  hostId: string,
): ComponentType[] {
  const assignedTypes = new Set(
    project.assignments
      .filter((assignment) => assignment.serverId === hostId)
      .map((assignment) => assignment.type),
  )

  return PC_BUILD_COMPONENT_ORDER.filter(
    (type) => REQUIRED_PC_BUILD_COMPONENT_TYPES.includes(type) || assignedTypes.has(type),
  )
}

export function canRemovePcBuildAssignment(
  project: ProjectState,
  assignment: ComponentAssignment,
): { ok: true } | { ok: false; message: string } {
  if (assignment.type !== 'motherboard') return { ok: true }

  const dependents = project.assignments.filter(
    (candidate) => candidate.serverId === assignment.serverId && candidate.id !== assignment.id,
  )
  if (dependents.length === 0) return { ok: true }

  return {
    ok: false,
    message: 'Remove the components assigned to this motherboard before removing the motherboard.',
  }
}
