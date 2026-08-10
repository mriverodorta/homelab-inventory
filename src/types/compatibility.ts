export type CompatibilitySeverity = 'error' | 'warning' | 'unknown'
export type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown'
export type CompatibilityResourceType =
  | 'cpu'
  | 'memory'
  | 'storage'
  | 'expansion'
  | 'optionalModule'
  | 'controllerSlot'
  | 'bootDeviceSlot'
  | 'coolingProfile'
  | 'motherboard'
  | 'cooling'
  | 'power'
  | 'case'
export type ExpansionInterfaceFamily = 'pcie' | 'm2-ae' | 'usb' | 'onboard'
export type CardHeight = 'full-height' | 'low-profile'
export type TopologyCompleteness = 'complete' | 'partial' | 'conflicting'
export type EccSupport = 'supported' | 'unsupported' | 'conditional' | 'unknown'
export type MemoryFormFactor = 'DIMM' | 'SO-DIMM'
export type MemoryModuleType = 'UDIMM' | 'RDIMM' | 'LRDIMM'
export type PowerRedundancy = 'none' | 'optional' | 'required' | 'supported'
export type PsuType = 'fixed' | 'cabled' | 'hot-plug'

export type CompatibilityConstraintMember = {
  resourceType: 'storage-slot' | 'expansion-slot' | 'optional-module-slot'
    | 'controller-slot' | 'boot-device-slot' | 'cooling-profile'
  resourceId: number
}

export type CompatibilityConstraintGroup = {
  id: number
  key: string
  label: string
  kind: 'mutually-exclusive'
  members: CompatibilityConstraintMember[]
}

export type StorageSlotGroup = {
  id: number
  key: string
  label: string
  count: number
  interfaces?: string[]
  formFactors?: string[]
  pcieGeneration?: number
  location?: string
  hotSwap?: boolean
  backplane?: string
  controllerSlotIds?: number[]
  directConnect?: boolean
}

export type ExpansionSlotGroup = {
  id: number
  key: string
  label: string
  count: number
  interfaceFamily: ExpansionInterfaceFamily
  pcieGeneration?: number
  mechanicalLanes?: number
  electricalLanes?: number
  acceptedHeights?: CardHeight[]
  maxSlotWidth?: number
  maxPowerWatts?: number
  proprietaryRiser?: boolean
  riserCapability?: string
  requiredCpuSockets?: number
  riserGroup?: string
}

export type OptionalModuleSlotGroup = {
  id: number
  key: string
  label: string
  count: number
  acceptedModuleKinds?: string[]
}

export type ControllerSlotGroup = {
  id: number
  key: string
  label: string
  count: number
  acceptedControllerKinds?: string[]
  interfaceFamily?: string
  dedicated?: boolean
  requiredCpuSockets?: number
}

export type BootDeviceSlotGroup = {
  id: number
  key: string
  label: string
  count: number
  acceptedDeviceKinds?: string[]
  interfaces?: string[]
  formFactors?: string[]
  controllerSlotId?: number
  requiredCpuSockets?: number
}

export type CoolingProfile = {
  id: number
  key: string
  label: string
  fanCount?: number
  redundant?: boolean
  conditions?: string[]
}

export type ManagementControllerCompatibility = {
  controllerFamily?: string
  controllerGeneration?: string
  dedicatedPort?: boolean
  sharedNic?: boolean
  portType?: string
  speed?: string
}

export type HostPowerCompatibility = {
  configuration?: string
  connector?: string
  supportedWattagesWatts?: number[]
  adapterRequired?: boolean
  adapterType?: string
  redundancy?: PowerRedundancy
  maxGraphicsPowerWatts?: number
  psuBayCount?: number
  psuType?: PsuType
  mixedPsuAllowed?: boolean
  redundancyModes?: string[]
}

export type MotherboardPowerConnectorGroup = {
  id: number
  key: string
  label: string
  kind: 'main-power' | 'cpu-power'
  connector: string
  count: number
  required: boolean
}

export type FixedHostPort = {
  id: number
  key: string
  kind: string
  type: string
  slotNumber: number
  speed?: string
  origin: 'fixed'
}

export type HostCompatibility = {
  topologyCompleteness?: TopologyCompleteness
  cpu?: {
    sockets?: string[]
    generations?: string[]
    maxTdpWatts?: number
    socketCount?: number
    populationModes?: number[]
  }
  memory?: {
    generations?: string[]
    formFactors?: MemoryFormFactor[]
    slots?: number
    maxCapacityGb?: number
    maxModuleCapacityGb?: number
    maxSpeedMt?: number
    eccSupport?: EccSupport
    slotsPerCpu?: number
    moduleTypes?: MemoryModuleType[]
  }
  storageSlots?: StorageSlotGroup[]
  expansionSlots?: ExpansionSlotGroup[]
  optionalModuleSlots?: OptionalModuleSlotGroup[]
  controllerSlots?: ControllerSlotGroup[]
  bootDeviceSlots?: BootDeviceSlotGroup[]
  coolingProfiles?: CoolingProfile[]
  management?: ManagementControllerCompatibility
  constraintGroups?: CompatibilityConstraintGroup[]
  fixedPorts?: FixedHostPort[]
  powerConnectors?: MotherboardPowerConnectorGroup[]
  power?: HostPowerCompatibility
  maxExpansionPowerWatts?: number
}

export type ComponentCompatibilityRequirements = {
  cpu?: { socket?: string; generation?: string; tdpWatts?: number }
  memory?: {
    capacityGb?: number
    generation?: string
    speedMt?: number
    formFactor?: MemoryFormFactor
    moduleType?: MemoryModuleType
    ecc?: boolean
  }
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
  groupId?: number
  positions: number[]
}

export type CompatibilityFinding = {
  code: string
  severity: CompatibilitySeverity
  message: string
  field?: string
  resourceId?: number
}

export type CompatibilityResult = {
  status: CompatibilityStatus
  findings: CompatibilityFinding[]
  allocation?: CompatibilityAllocation
}
