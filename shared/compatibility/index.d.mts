import type {
  CardHeight,
  CompatibilityResult,
  ExpansionInterfaceFamily,
  HostCompatibility,
} from '../../src/types/compatibility'
import type {
  CompatibilityPolicy,
  CanvasEquipmentType,
  ComponentAssignment,
  ComponentType,
  InventoryItem,
  InventoryType,
  ProjectState,
} from '../../src/types/inventory'

export type PcieDescriptor = {
  pcieGeneration?: number
  connectorLanes?: number
}

export type NormalizedCpuRequirements = {
  type: 'cpu'
  socket?: string
  generation?: string
  tdpWatts?: number
}

export type NormalizedRamRequirements = {
  type: 'ram'
  capacityGb?: number
  moduleCount?: number
  moduleCapacityGb?: number
  generation?: string
  speedMt?: number
}

export type NormalizedStorageRequirements = PcieDescriptor & {
  type: 'storage'
  capacityGb?: number
  capacityTb?: number
  interface?: string
  formFactor?: string
}

export type NormalizedExpansionRequirements = PcieDescriptor & {
  type: 'gpu' | 'network'
  interfaceFamily?: ExpansionInterfaceFamily
  minimumElectricalLanes?: number
  height?: CardHeight
  slotWidth?: number
  powerWatts?: number
}

export type NormalizedComponentRequirements =
  | NormalizedCpuRequirements
  | NormalizedRamRequirements
  | NormalizedStorageRequirements
  | NormalizedExpansionRequirements
  | {
      type?:
        | CanvasEquipmentType
        | Exclude<ComponentType, 'cpu' | 'ram' | 'storage' | 'gpu' | 'network'>
    }

export type AssignmentCompatibilityInput = {
  host: InventoryItem
  component: InventoryItem
  assignments?: ComponentAssignment[]
  items?: Record<string, InventoryItem> | InventoryItem[] | Map<string | number, InventoryItem>
}

export type ProjectCompatibilityResult = CompatibilityResult & {
  assignmentId: string | number
  hostId: string
  itemId: string
}

export type HostAllocationPlan = {
  assignments: ComponentAssignment[]
  results: ProjectCompatibilityResult[]
}

export function normalizeHostCapabilities(item: InventoryItem): HostCompatibility
export function normalizeCompatibilityPolicy(
  policy?: Partial<CompatibilityPolicy> | null,
): CompatibilityPolicy
export function isHostCompatibilityEnabled(
  project: ProjectState | null | undefined,
  hostId: string | number,
): boolean
export function normalizeProjectCompatibilityPolicy(project: ProjectState): ProjectState
export function parsePcieDescriptor(value: unknown): PcieDescriptor
export function normalizeComponentRequirements(
  item: InventoryItem,
): NormalizedComponentRequirements
export function evaluateAssignmentCompatibility(
  input: AssignmentCompatibilityInput,
): CompatibilityResult
export function evaluateProjectCompatibility(project: ProjectState): ProjectCompatibilityResult[]
export function planHostAllocations(project: ProjectState, hostId: string): HostAllocationPlan
export function normalizeCompatibilityProject(project: ProjectState): ProjectState
