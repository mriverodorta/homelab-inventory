import type { AgentHostStatus, AgentHostType, AgentServerStatus, AgentStatusSummary } from '@/types/agent'

export function getAgentHostStatus(
  summary: AgentStatusSummary | null,
  hostType: AgentHostType,
  hostId: number,
): AgentHostStatus {
  const existing = summary?.hosts?.[`${hostType}:${hostId}`]
    ?? (hostType === 'server' ? summary?.servers?.[String(hostId)] : undefined)

  if (existing) return { ...existing, hostType, hostId }

  const registered = summary?.registeredHosts?.some(
    (host) => host.hostType === hostType && host.hostId === hostId,
  ) ?? (hostType === 'server' && summary?.registeredServerIds?.includes(hostId))

  return {
    hostType,
    hostId,
    ...(hostType === 'server' ? { serverId: hostId } : {}),
    state: registered ? 'unknown' : 'unregistered',
    connected: Boolean(registered),
    ageMs: null,
  }
}

export function isAgentHostRegistered(
  summary: AgentStatusSummary | null,
  hostType: AgentHostType,
  hostId: number,
): boolean {
  return Boolean(summary?.registeredHosts?.some(
    (host) => host.hostType === hostType && host.hostId === hostId,
  ) ?? (hostType === 'server' && summary?.registeredServerIds?.includes(hostId)))
}

export function hasAgentHostStatus(
  summary: AgentStatusSummary | null,
  hostType: AgentHostType,
  hostId: number,
): boolean {
  return Boolean(
    summary?.hosts?.[`${hostType}:${hostId}`]
      ?? (hostType === 'server' ? summary?.servers?.[String(hostId)] : undefined),
  )
}

export function getServerAgentStatus(
  summary: AgentStatusSummary | null,
  serverId: number,
): AgentServerStatus {
  return getAgentHostStatus(summary, 'server', serverId)
}
