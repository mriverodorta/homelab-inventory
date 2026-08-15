import { useQuery } from '@tanstack/react-query'
import { loadAgentStatus } from '@/lib/agent-api'

export const AGENT_STATUS_REFRESH_INTERVAL_MS = 60_000

export function useAgentStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['agent-status'],
    queryFn: loadAgentStatus,
    enabled,
    refetchInterval: enabled ? AGENT_STATUS_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  })
}
