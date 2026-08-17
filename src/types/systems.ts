export type SystemsAgentState = 'unregistered' | 'unknown' | 'online' | 'stale' | 'offline'

export type SystemsHostType = 'server' | 'nas' | 'pcBuild'

export type SystemsHostLive = Readonly<{
  itemId: number
  agentState: SystemsAgentState
  agentVersion: string | null
  agentUpdateAvailable: boolean
  agentUpdateCommand?: string
  cpuPercent: number | null
  memoryPercent: number | null
  storagePercent: number | null
}>

export type SystemsHostRow = SystemsHostLive & Readonly<{
  itemKey: string
  type: SystemsHostType
  legacyId: number
  name: string
  manufacturer: string | null
  model: string | null
  hardwareClass: string | null
  usageRole: string | null
  cpuLabel: string | null
  memoryLabel: string | null
  storageLabel: string | null
  agentRegistered: boolean
  registryLinked: boolean
}>

export type SystemsInitialResponse = Readonly<{
  projectId: number
  generatedAt: string
  currentAgentVersion: string | null
  systems: readonly SystemsHostRow[]
}>

export type SystemsLiveResponse = Readonly<{
  projectId: number
  generatedAt: string
  systems: readonly SystemsHostLive[]
}>
