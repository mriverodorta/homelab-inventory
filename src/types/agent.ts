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

export type AgentService = Record<string, unknown> & {
  name?: string
  description?: string
  activeState?: string
  classification?: 'user-installed' | 'system' | 'unknown'
}

export type AgentContainerPort = {
  hostPort: number
  containerPort: number
  protocol: 'tcp' | 'udp' | 'sctp'
}

export type AgentContainer = Record<string, unknown> & {
  runtime?: 'docker' | 'podman'
  runtimeId?: string
  name?: string
  image?: string
  state?: string
  status?: string
  uptime?: string
  composeService?: string
  networkMode?: 'host' | 'bridge' | 'none' | 'custom'
  networkNames?: string[]
  ports?: AgentContainerPort[]
  cpuPercent?: number
  memoryBytes?: number
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
  containers?: AgentContainer[]
  kubernetes?: Record<string, unknown> | null
  services?: AgentService[]
  listeningPorts?: Array<Record<string, unknown>>
  capabilities?: Record<string, AgentCapability>
  metrics?: AgentMetrics
  storageHealth?: Array<Record<string, unknown>>
  droppedSamples?: number
  monitoringRevision?: number
  details?: {
    metrics: boolean
    services: boolean
    containers: boolean
    storage: boolean
    network: boolean
    hardware: boolean
  }
  upgradeCommands?: {
    linux: string
    freebsd: string
  }
}

export type AgentServerStatus = AgentHostStatus

export type AgentStatusSummary = {
  hosts?: Record<string, AgentHostStatus>
  registeredHosts?: Array<{ hostType: AgentHostType; hostId: number }>
  servers?: Record<string, AgentServerStatus>
  registeredServerIds?: number[]
  release?: {
    version: string
    sourceRevision: string
  } | null
}

export type AgentEnrollmentResponse = {
  enrollmentId: number
  expiresAt: string
  endpoint: string
  installCommand: string
  installCommands: {
    linux: string
    freebsd: string
  }
  agentVersion: string
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
    monitoringRevision?: number
    capabilities: Record<string, AgentCapability>
    metrics: AgentMetrics
    services?: AgentService[]
    containers?: AgentContainer[]
    storageHealth?: Array<Record<string, unknown>>
  }
}

export type AgentTelemetryRange = {
  host: { hostType: AgentHostType; hostId: number }
  serverTime: string
  status: AgentHostStatus
  timing: {
    heartbeatIntervalMs: number
    onlineMaxAgeMs: number
    staleMaxAgeMs: number
  }
  from: string
  to: string
  heartbeatBuckets: Array<{
    at: string
    received: boolean
  }>
  metricBuckets: Array<{
    at: string
    received: boolean
    metrics: AgentMetrics | null
  }>
  latest: ({
    source: 'reconstructed-latest-state'
    observedAt: string
    agentVersion: string
    sequence: number
    metrics: AgentMetrics
    services: AgentService[]
    containers: AgentContainer[]
    storageHealth: Array<Record<string, unknown>>
  } & Record<string, unknown>) | null
  storage?: AgentStorageTelemetry
}

export type AgentStorageMount = {
  mountId: number | null
  parentId: number | null
  majorMinor: string | null
  source: string
  mountPoint: string
  root: string
  fsType: string
  readOnly: boolean
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usagePercent: number
}

export type AgentStorageDevice = {
  locator: string
  model: string | null
  vendor: string | null
  sizeBytes: number | null
  transport: string | null
  partitionTable: string | null
  rotational: boolean | null
  topology: Array<Record<string, unknown>>
}

export type AgentStorageItemTelemetry = {
  itemType: 'storage'
  itemId: number
  match: 'opaque-fingerprint' | 'physical-locator' | 'one-to-one-position'
  device: AgentStorageDevice
  mounts: AgentStorageMount[]
}

export type AgentStorageTelemetry = {
  summary: {
    totalBytes: number
    usedBytes: number
    availableBytes: number
    usagePercent: number
    mounts: AgentStorageMount[]
  }
  items: AgentStorageItemTelemetry[]
  unmatchedMounts: AgentStorageMount[]
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
    deviceId?: number
    hostType?: AgentHostType
    hostId?: number
    protocolMajor?: number
    collectedAt: string
    receivedAt: string
    host?: Record<string, unknown>
    components: Array<{ kind: string; locator: string; values: Record<string, unknown> }>
  } | null
  stale: boolean
  ageMs: number | null
  suggestions: AgentHardwareSuggestion[]
}
