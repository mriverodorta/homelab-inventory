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
  | 'wireless'
  | 'powerAdapter'
  | 'switch'
  | 'patchPanel'
  | 'monitor'
  | 'ups'
  | 'powerStrip'

export type InventorySpecs = Record<string, string | number | boolean | null>
export type InventoryProperties = Record<string, string>
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
  | 'wireless'
  | 'powerAdapter'
export type InventoryPortKind = 'switch-port' | 'keystone' | 'server-port' | 'power-port'
export type InventoryPortType =
  | 'rj45'
  | 'sfp'
  | 'sfp-plus'
  | 'hdmi'
  | 'displayport'
  | 'mini-displayport'
  | 'barrel'
  | 'ac-input'
  | 'ac-outlet'
export type InventoryPortSide = 'front' | 'back'
export type InventoryPortRole = 'access' | 'trunk' | 'uplink' | 'management' | 'disabled'

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
  role?: InventoryPortRole
  speed?: string
  poe?: boolean
  endpoints?: InventoryPortEndpoint[]
}

export type ConnectionEndpoint = {
  itemId: string
  portId: number
  endpointId?: number
  hostedItemId?: string
}

export type InventoryConnectionType = 'network' | 'display' | 'power' | 'other'
export type ConnectionRouteSide = 'auto' | 'left' | 'right' | 'top' | 'bottom'

export type ConnectionBendPoint = {
  x: number
  y: number
}

export type ConnectionRoutePreferences = {
  sourceSide?: ConnectionRouteSide
  targetSide?: ConnectionRouteSide
  bendPoints?: ConnectionBendPoint[]
}

export type InventoryConnection = {
  id: number
  from: ConnectionEndpoint
  to: ConnectionEndpoint
  type: InventoryConnectionType
  negotiatedSpeedMbps?: number
  label?: string
  route?: ConnectionRoutePreferences
  createdAt: string
}

export type InventoryItem = {
  id: number
  key?: string
  name: string
  type: InventoryType
  subtype?: string
  manufacturer?: string
  secondaryManufacturer?: string
  family?: string
  model?: string
  number?: string
  specs?: InventorySpecs
  properties?: InventoryProperties
  ports?: InventoryPort[]
  compatibility?: InventoryCompatibility
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
}

export type CompatibilityHostRef = {
  hostType: HostType
  hostId: number
}

export type CompatibilityPolicy = {
  disabledHosts: CompatibilityHostRef[]
  ignoredWarningIds: string[]
}

export type ProjectState = {
  id: string
  metadata: ProjectMetadata
  items: Record<string, InventoryItem>
  placements: ServerPlacement[]
  assignments: ComponentAssignment[]
  connections: InventoryConnection[]
  compatibilityPolicy?: CompatibilityPolicy
}

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
