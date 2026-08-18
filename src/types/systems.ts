export type SystemsAgentState = 'unregistered' | 'unknown' | 'online' | 'stale' | 'offline'

export type SystemsHostType = 'server' | 'nas' | 'pcBuild'
export type SystemsAttentionState = 'current' | 'refreshing' | 'failed'
export type SystemsColumnKey = 'type' | 'name' | 'manufacturer' | 'cpu' | 'memory' | 'storage' | 'attention' | 'agent' | 'registry' | 'operatingSystem' | 'uptime' | 'lanIp'
export type SystemsDensity = 'dense' | 'comfortable'

export type SystemsHostLive = Readonly<{
  itemId: number
  itemKey?: string
  agentRegistered: boolean
  agentState: SystemsAgentState
  agentVersion: string | null
  agentUpdateAvailable: boolean
  agentUpdateCommand?: string
  cpuPercent: number | null
  memoryPercent: number | null
  storagePercent: number | null
  uptimeSeconds: number | null
  attentionCount: number
  attentionState: SystemsAttentionState
  attentionRevision: number
}>

export type SystemsHostRow = SystemsHostLive & Readonly<{
  itemKey: string
  type: SystemsHostType
  legacyId: number
  name: string
  manufacturer: string | null
  model: string | null
  hardwareClass: 'desktop' | 'workstation' | 'server' | null
  usageRole: 'server' | 'desktop' | 'workstation' | 'other' | null
  cpuLabel: string | null
  memoryLabel: string | null
  storageLabel: string | null
  operatingSystem: string | null
  lanIp: string | null
  registryLinked: boolean
}>

export type SystemsViewColumn = Readonly<{ key: SystemsColumnKey; visible: boolean; order: number }>
export type SystemsViewConfiguration = Readonly<{
  types: readonly SystemsHostType[]
  registrations: readonly ('registered' | 'unregistered')[]
  registryStates: readonly ('linked' | 'unlinked')[]
  sortKey: SystemsColumnKey
  sortDirection: 'ascending' | 'descending'
  density: SystemsDensity
  columns: readonly SystemsViewColumn[]
}>
export type SystemsSavedView = Readonly<{
  id: number
  projectId: number
  name: string
  isDefault: boolean
  revision: number
  configuration: SystemsViewConfiguration
  createdAt: string
  updatedAt: string
}>

export type SystemsAttentionSummary = Readonly<{
  id: number
  projectId: number
  hostType: SystemsHostType
  hostId: number
  registryCount: number
  auditCount: number
  notificationCount: number
  totalCount: number
  state: SystemsAttentionState
  revision: number
  evaluatedAt: string | null
  updatedAt: string
}>
export type SystemsAttentionFinding = Readonly<{
  id: number
  category: 'registry' | 'audit' | 'notification'
  key: string
  affectedItemType: string | null
  affectedItemId: number | null
  severity: 'info' | 'warning' | 'error' | 'critical'
  title: string
  description: string
  destination: Readonly<Record<string, unknown>>
}>
export type SystemsAttentionResponse = Readonly<{
  summary: SystemsAttentionSummary | null
  findings: readonly SystemsAttentionFinding[]
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
