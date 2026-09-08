import type { ApplicationLiveEvent } from '@/live-events/model'
import type { AgentHostStatus, AgentStatusSummary } from '@/types/agent'

const DELTA_KINDS = new Set(['agent.heartbeat', 'agent.status-online', 'agent.status-stale', 'agent.status-offline', 'agent.status-unknown'])
const STATES = new Set(['online', 'stale', 'offline', 'unknown', 'unregistered'])

// Fleet events are sparse: membership and upgrade commands still
// require an authoritative snapshot after lifecycle or agent-version changes.
export function mergeAgentStatusEvent(current: AgentStatusSummary | undefined, event: ApplicationLiveEvent): AgentStatusSummary | null {
  if (!current || !event || !DELTA_KINDS.has(event.kind)) return null
  const host = event.payload?.host as { hostType?: unknown; hostId?: unknown } | undefined
  const status = event.payload?.status as Partial<AgentHostStatus> | null | undefined
  if (!host || !['server', 'nas', 'pcBuild'].includes(String(host.hostType))
    || !Number.isSafeInteger(host.hostId) || Number(host.hostId) <= 0 || !status
    || status.hostType !== host.hostType || status.hostId !== host.hostId
    || !STATES.has(String(status.state)) || typeof status.connected !== 'boolean'
    || !(status.ageMs === null || (typeof status.ageMs === 'number' && Number.isFinite(status.ageMs) && status.ageMs >= 0))) return null

  const key = `${host.hostType}:${host.hostId}`
  const serverKey = String(host.hostId)
  const previous = current.hosts?.[key] ?? (host.hostType === 'server' ? current.servers?.[serverKey] : undefined)
  if (!previous || previous.connected !== status.connected
    || (status.agentVersion !== undefined && previous.agentVersion !== status.agentVersion)) return null

  const next: AgentHostStatus = {
    ...previous,
    hostType: status.hostType,
    hostId: status.hostId,
    state: status.state!,
    connected: status.connected,
    ageMs: status.ageMs!,
  }
  for (const field of ['lastSeenAt', 'agentVersion'] as const) {
    if (status[field] !== undefined) {
      if (typeof status[field] !== 'string') return null
      next[field] = status[field]
    }
  }
  for (const field of ['collectedAt', 'hostname'] as const) {
    if (status[field] !== undefined) {
      if (status[field] !== null && typeof status[field] !== 'string') return null
      next[field] = status[field]
    }
  }
  for (const field of ['droppedSamples', 'monitoringRevision'] as const) {
    if (status[field] !== undefined) {
      if (!Number.isSafeInteger(status[field]) || status[field]! < 0) return null
      next[field] = status[field]
    }
  }
  if (status.commandPlatform !== undefined) {
    if (!['linux', 'alpine', 'freebsd'].includes(status.commandPlatform)) return null
    next.commandPlatform = status.commandPlatform
  }
  if (status.details !== undefined) {
    if (!status.details || !['metrics', 'services', 'containers', 'storage', 'network', 'hardware']
      .every((field) => typeof status.details?.[field as keyof NonNullable<AgentHostStatus['details']>] === 'boolean')) return null
    next.details = status.details
  }
  return {
    ...current,
    hosts: { ...current.hosts, [key]: next },
    ...(host.hostType === 'server' && current.servers ? { servers: { ...current.servers, [serverKey]: next } } : {}),
  }
}
