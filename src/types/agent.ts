export type AgentState = 'unregistered' | 'unknown' | 'online' | 'stale' | 'offline'

export type AgentHostType = 'server' | 'nas' | 'pcBuild'

export type AgentCapabilityState = 'available' | 'unavailable' | 'permission-blocked' | 'disabled'

export type AgentCapability = {
  state: AgentCapabilityState
  detail?: string
}

export type AgentMetrics = {
  uptimeSeconds?: number
  loadAverage?: number[]
  system?: Record<string, unknown>
  cpu?: Record<string, unknown>
  memory?: Record<string, unknown>
  filesystems?: Array<Record<string, unknown>>
  diskIo?: Array<Record<string, unknown>>
  network?: Array<Record<string, unknown>>
  sensors?: Array<Record<string, unknown>>
  batteries?: Array<Record<string, unknown>>
  gpus?: Array<Record<string, unknown>>
}

export type AgentHostStatus = {
  hostType?: AgentHostType
  hostId?: number
  serverId?: number
  state: AgentState
  connected: boolean
  ageMs: number | null
  lastSeenAt?: string
  agentVersion?: string
  collectedAt?: string | null
  hostname?: string | null
  os?: Record<string, unknown> | null
  uptimeSeconds?: number | null
  loadAverage?: number[] | null
  cpu?: Record<string, unknown> | null
  memory?: Record<string, unknown> | null
  swap?: Record<string, unknown> | null
  disks?: Array<Record<string, unknown>>
  network?: Array<{
    name?: string
    mac?: string
    addresses?: string[]
  }>
  motherboard?: Record<string, unknown> | null
  containers?: Array<Record<string, unknown>>
  kubernetes?: Record<string, unknown> | null
  services?: Array<Record<string, unknown>>
  listeningPorts?: Array<Record<string, unknown>>
  capabilities?: Record<string, AgentCapability>
  metrics?: AgentMetrics
  storageHealth?: Array<Record<string, unknown>>
  droppedSamples?: number
}

export type AgentServerStatus = AgentHostStatus

export type AgentStatusSummary = {
  hosts?: Record<string, AgentHostStatus>
  registeredHosts?: Array<{ hostType: AgentHostType; hostId: number }>
  servers: Record<string, AgentServerStatus>
  registeredServerIds: number[]
}

export type AgentEnrollmentResponse = {
  enrollmentId: number
  expiresAt: string
  endpoint: string
  installCommand: string
}

export type AgentTelemetrySample = {
  id: number
  deviceId: number
  hostType: AgentHostType
  hostId: number
  sequence: number
  receivedAt: string
  collectedAt: string
  agentVersion: string
  payload: {
    sequence: number
    collectedAt: string
    agentVersion: string
    hostname?: string
    droppedSamples?: number
    capabilities: Record<string, AgentCapability>
    metrics: AgentMetrics
    services?: Array<Record<string, unknown>>
    containers?: Array<Record<string, unknown>>
    storageHealth?: Array<Record<string, unknown>>
  }
}

export type AgentTelemetryRange = {
  host: { hostType: AgentHostType; hostId: number }
  from: string
  to: string
  samples: AgentTelemetrySample[]
}

export type AgentHardwareSuggestion = {
  id: string
  snapshotId: number
  target: { itemType: string; itemId: number }
  fieldPath: string
  detectedValue: unknown
  currentValue: unknown
  source: {
    kind: string
    locator: string
    collectedAt: string
  }
  match: {
    method: 'host' | 'opaque-fingerprint' | 'physical-locator' | 'one-to-one-position'
    confidence: 'high' | 'medium'
  }
}

export type AgentHardwareSnapshotResponse = {
  snapshot: {
    id: number
    collectedAt: string
    receivedAt: string
    components: Array<{ kind: string; locator: string; values: Record<string, unknown> }>
  } | null
  stale: boolean
  ageMs: number | null
  suggestions: AgentHardwareSuggestion[]
}
