import type {
  CardHeight,
  ExpansionInterfaceFamily,
  HostCompatibility,
} from '../../src/types/compatibility'
import type { InventoryItem, InventoryType } from '../../src/types/inventory'

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
  | { type?: InventoryType }

export function normalizeHostCapabilities(item: InventoryItem): HostCompatibility
export function parsePcieDescriptor(value: unknown): PcieDescriptor
export function normalizeComponentRequirements(
  item: InventoryItem,
): NormalizedComponentRequirements
