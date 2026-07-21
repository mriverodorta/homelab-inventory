import type {
  CompatibilityAllocation,
  ExpansionSlotGroup,
  StorageSlotGroup,
} from './compatibility'
import type { ComponentAssignment, ComponentType, InventoryItem } from './inventory'

export type CpuSocketGroup = {
  label: string
  count: number
  socket: string
  supportedGenerations?: string[]
  maxTdpWatts?: number
}

export type MemorySlotGroup = {
  label: string
  count: number
  generations: string[]
  maxCapacityGb?: number
  maxModuleCapacityGb?: number
  maxSpeedMt?: number
}

export type MotherboardResources = {
  cpuSockets: CpuSocketGroup[]
  memorySlots: MemorySlotGroup[]
  storageSlots: StorageSlotGroup[]
  expansionSlots: ExpansionSlotGroup[]
}

export type PcBuildAllocationRequest = {
  componentType: ComponentType
  requiredPositions: number
  motherboard: InventoryItem
  assignments: ComponentAssignment[]
  requirements?: Record<string, unknown>
}

export type PcBuildAllocationResult =
  | { ok: true; allocation: CompatibilityAllocation }
  | { ok: false; message: string }
