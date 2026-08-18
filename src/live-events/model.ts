export type AgentLiveHostType = 'server' | 'nas' | 'pcBuild'

export type ApplicationLiveTopic =
  | `systems:${number}`
  | `compatibility:${number}`
  | 'agents:fleet'
  | `agent-telemetry:${AgentLiveHostType}:${number}`
  | `agent-hardware:${AgentLiveHostType}:${number}`
  | 'notifications:summary'
  | 'notifications:incidents'
  | 'updates:status'
  | 'demo:session'

export type ApplicationLiveEvent = Readonly<{
  version: 1
  generationId: string
  sequence: number
  topic: ApplicationLiveTopic
  topics: readonly ApplicationLiveTopic[]
  kind: string
  occurredAt: string
  payload: Readonly<Record<string, unknown>>
}>

export type ApplicationStreamReady = Readonly<{
  version: 1
  generationId: string
  sequence: number
  topics: readonly ApplicationLiveTopic[]
  topicSequences: Readonly<Partial<Record<ApplicationLiveTopic, number>>>
}>
