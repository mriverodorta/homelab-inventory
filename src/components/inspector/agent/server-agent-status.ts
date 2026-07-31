import type { AgentServerStatus, AgentStatusSummary } from '@/types/agent'

export function getServerAgentStatus(
  summary: AgentStatusSummary | null,
  serverId: number,
): AgentServerStatus {
  const existing = summary?.servers[String(serverId)]

  if (existing) {
    return existing
  }

  if (summary?.registeredServerIds.includes(serverId)) {
    return {
      serverId,
      state: 'unknown',
      connected: true,
      ageMs: null,
    }
  }

  return {
    serverId,
    state: 'unregistered',
    connected: false,
    ageMs: null,
  }
}
