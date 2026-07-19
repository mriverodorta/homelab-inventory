export type CompatibilitySeverity = 'error' | 'warning' | 'unknown'
export type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown'
export type CompatibilityResourceType = 'memory' | 'storage' | 'expansion'
export type ExpansionInterfaceFamily = 'pcie' | 'm2-ae' | 'usb' | 'onboard'
export type CardHeight = 'full-height' | 'low-profile'

export type StorageSlotGroup = {
  id: string
  label: string
  count: number
  interfaces?: string[]
  formFactors?: string[]
  pcieGeneration?: number
}

export type ExpansionSlotGroup = {
  id: string
  label: string
  count: number
  interfaceFamily: ExpansionInterfaceFamily
  pcieGeneration?: number
  mechanicalLanes?: number
  electricalLanes?: number
  acceptedHeights?: CardHeight[]
  maxSlotWidth?: number
  maxPowerWatts?: number
}

export type HostCompatibility = {
  cpu?: { sockets?: string[]; generations?: string[]; maxTdpWatts?: number }
  memory?: {
    generations?: string[]
    slots?: number
    maxCapacityGb?: number
    maxModuleCapacityGb?: number
    maxSpeedMt?: number
  }
  storageSlots?: StorageSlotGroup[]
  expansionSlots?: ExpansionSlotGroup[]
  maxExpansionPowerWatts?: number
}

export type ComponentCompatibilityRequirements = {
  cpu?: { socket?: string; generation?: string; tdpWatts?: number }
  expansion?: {
    interfaceFamily?: ExpansionInterfaceFamily
    pcieGeneration?: number
    connectorLanes?: number
    minimumElectricalLanes?: number
    height?: CardHeight
    slotWidth?: number
    powerWatts?: number
  }
}

export type InventoryCompatibility = {
  host?: HostCompatibility
  requirements?: ComponentCompatibilityRequirements
}

export type CompatibilityAllocation = {
  resourceType: CompatibilityResourceType
  groupId?: string
  positions: number[]
}

export type CompatibilityFinding = {
  code: string
  severity: CompatibilitySeverity
  message: string
  field?: string
  resourceId?: string
}

export type CompatibilityResult = {
  status: CompatibilityStatus
  findings: CompatibilityFinding[]
  allocation?: CompatibilityAllocation
}
