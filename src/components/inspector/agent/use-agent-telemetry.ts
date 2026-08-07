import { useQuery } from '@tanstack/react-query'
import { loadAgentTelemetry } from '@/lib/agent-api'
import type { AgentHostType } from '@/types/agent'

export const AGENT_TELEMETRY_REFRESH_INTERVAL_MS = 60_000

export function useAgentTelemetry({
  hostType,
  hostId,
  enabled,
}: {
  hostType: AgentHostType
  hostId: number
  enabled: boolean
}) {
  return useQuery({
    queryKey: ['agent-telemetry', hostType, hostId, '30m'],
    queryFn: () => loadAgentTelemetry(hostType, hostId, { limit: 30 }),
    enabled,
    retry: 1,
    refetchInterval: AGENT_TELEMETRY_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
}
