export type AgentState = 'unregistered' | 'unknown' | 'online' | 'stale' | 'offline'

export type AgentServerStatus = {
  serverId: string | number
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
}

export type AgentStatusSummary = {
  servers: Record<string, AgentServerStatus>
  registeredServerIds: Array<string | number>
}

export type AgentEnrollmentResponse = {
  enrollmentId: string
  expiresAt: string
  endpoint: string
  installCommand: string
}
