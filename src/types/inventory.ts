import type {
  CompatibilityAllocation,
  CompatibilityResult,
  InventoryCompatibility,
} from './compatibility'

export type InventoryType =
  | 'server'
  | 'nas'
  | 'pcBuild'
  | 'cpu'
  | 'ram'
  | 'storage'
  | 'gpu'
  | 'network'
  | 'motherboard'
  | 'cpuCooler'
  | 'case'
  | 'powerSupply'
  | 'soundCard'
  | 'powerAdapter'
  | 'switch'
  | 'patchPanel'
  | 'monitor'
  | 'ups'
  | 'powerStrip'

export type InventorySpecValue =
  | string
  | number
  | boolean
  | null
  | InventorySpecValue[]
  | { [key: string]: InventorySpecValue }
export type InventorySpecs = Record<string, InventorySpecValue>
export type InventoryProperties = Record<string, string>
export type HardwareClass = 'desktop' | 'workstation' | 'server'
export type EquipmentUsageRole = 'server' | 'desktop' | 'workstation' | 'other'
export type NasPowerConfiguration = 'internal-psu' | 'external-adapter'
export type SmartPowerStripOutletName = {
  portId: number
  name: string
}
export type SmartPowerStripConfiguration = {
  enabled: true
  displayName?: string
  managementIp?: string
  macAddress?: string
  outlets: SmartPowerStripOutletName[]
}
export type HostType = 'server' | 'nas' | 'pcBuild'
export type CanvasEquipmentType =
  | HostType
  | 'switch'
  | 'patchPanel'
  | 'monitor'
  | 'ups'
  | 'powerStrip'
export type ComponentType =
  | 'cpu'
  | 'ram'
  | 'storage'
  | 'gpu'
  | 'network'
  | 'motherboard'
  | 'cpuCooler'
  | 'case'
  | 'powerSupply'
  | 'soundCard'
  | 'powerAdapter'
export type InventoryPortKind =
  | 'switch-port'
  | 'keystone'
  | 'server-port'
  | 'power-port'
  | 'network'
  | 'video'
export type InventoryPortType =
  | 'rj45'
  | 'sfp'
  | 'sfp-plus'
  | 'sfp28'
  | 'qsfp'
  | 'qsfp-plus'
  | 'qsfp28'
  | 'qsfp56'
  | 'qsfp-dd'
  | 'osfp'
  | 'fc'
  | 'infiniband'
  | 'hdmi'
  | 'displayport'
  | 'mini-displayport'
  | 'barrel'
  | 'ac-input'
  | 'ac-outlet'
export type InventoryPortSide = 'front' | 'back'
export type InventoryPortRole = 'access' | 'trunk' | 'uplink' | 'management' | 'disabled'
export type InventoryPortOrigin = 'fixed' | 'module'

export type InventoryPortEndpoint = {
  id: number
  side: InventoryPortSide
}

export type InventoryPort = {
  id: number
  key?: string
  kind: InventoryPortKind
  type: InventoryPortType
  slotNumber: number
  label?: string
  notes?: string
  ipAddress?: string
  macAddress?: string
  role?: InventoryPortRole
  adminState?: 'enabled' | 'disabled'
  speed?: string
  speedBps?: number
  supportedSpeedsBps?: number[]
  networkTechnology?: 'ethernet' | 'wifi' | 'fibre-channel' | 'infiniband' | 'converged' | 'cellular' | 'other'
  operatingModes?: string[]
  media?: Array<'dac' | 'aoc' | 'optical-transceiver' | 'copper-transceiver' | 'active-copper' | 'passive-copper'>
  vendorLock?: boolean
  poe?: boolean
  origin?: InventoryPortOrigin
  endpoints?: InventoryPortEndpoint[]
}

export type FixedComponentDisposition = 'fixed' | 'soldered'

export type InventoryFixedComponentItem = {
  type: InventoryType
  name: string
  subtype?: string
  manufacturer?: string
  secondaryManufacturer?: string
  family?: string
  model?: string
  number?: string
  aliases?: string[]
  specs?: InventorySpecs
  properties?: InventoryProperties
  ports?: InventoryPort[]
  compatibility?: InventoryCompatibility
  notes?: string
}

export type InventoryFixedComponent = {
  id: number
  componentType: string
  disposition: FixedComponentDisposition
  label: string
  item: InventoryFixedComponentItem
  templateKey?: string
  templateRevision?: number
}

export type ConnectionEndpoint = {
  itemId: string
  portId: number
  endpointId?: number
  hostedItemId?: string
}

export type InventoryConnectionType = 'network' | 'display' | 'power' | 'other'
export type ConnectionRouteSide = 'left' | 'right' | 'top' | 'bottom'

export type ConnectionBendPoint = {
  x: number
  y: number
}

export type ConnectionRoutePreferences = {
  sourceSide?: ConnectionRouteSide
  targetSide?: ConnectionRouteSide
  bendPoints?: ConnectionBendPoint[]
  avoidCableOverlap?: boolean
}

export type InventoryConnection = {
  id: number
  from: ConnectionEndpoint
  to: ConnectionEndpoint
  type: InventoryConnectionType
  negotiatedSpeedBps?: number
  label?: string
  route?: ConnectionRoutePreferences
  createdAt: string
}

export type InventoryItem = {
  id: number
  key?: string
  name: string
  type: InventoryType
  scope?: 'global' | 'project'
  ownerProjectId?: number
  hardwareClass?: HardwareClass
  usageRole?: EquipmentUsageRole
  subtype?: string
  manufacturer?: string
  secondaryManufacturer?: string
  family?: string
  model?: string
  number?: string
  aliases?: string[]
  specs?: InventorySpecs
  smart?: SmartPowerStripConfiguration
  properties?: InventoryProperties
  ports?: InventoryPort[]
  compatibility?: InventoryCompatibility
  fixedComponents?: InventoryFixedComponent[]
  notes?: string
  archivedAt?: string
}

export type ServerPlacement = {
  serverId: string
  x: number
  y: number
}

export type ComponentAssignment = {
  id: number
  serverId: string
  itemId: string
  type: ComponentType
  assignedAt: string
  allocation?: CompatibilityAllocation
}

export type ProjectMetadata = {
  name: string
  version: number
  updatedAt: string
  projectId?: number
  workspaceId?: number
}

export type CompatibilityHostRef = {
  hostType: HostType
  hostId: number
}

export type CompatibilityPolicy = {
  disabledHosts: CompatibilityHostRef[]
  verifiedMemoryHosts?: CompatibilityHostRef[]
  ignoredWarningIds: string[]
}

export type ProjectState = {
  id: string
  revision?: number
  metadata: ProjectMetadata
  items: Record<string, InventoryItem>
  placements: ServerPlacement[]
  assignments: ComponentAssignment[]
  connections: InventoryConnection[]
  compatibilityPolicy?: CompatibilityPolicy
}

export type NasPowerConfigurationImpact = {
  from: NasPowerConfiguration
  to: NasPowerConfiguration
  connections: Array<{ id: number; label: string }>
  releasedAdapter: { type: 'powerAdapter'; id: number; name: string } | null
}

export type NasPowerConfigurationChangeResult =
  | { status: 'confirmation-required'; impact: NasPowerConfigurationImpact }
  | { status: 'applied'; project: ProjectState }

export type SlotStatus = {
  type: ComponentType
  label: string
  filled: number
  limit: number | null
}

export type ValidationResult =
  | { ok: true; compatibility?: CompatibilityResult }
  | {
      ok: false
      message: string
      compatibility?: CompatibilityResult
    }

export type SaveFile = {
  saveFormatVersion: 1
  exportedAt: string
  project: ProjectState
}
