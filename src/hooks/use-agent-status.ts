import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loadAgentStatus } from '@/lib/agent-api'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'
import { mergeAgentStatusEvent } from '@/lib/agent-status-live'
import type { AgentStatusSummary } from '@/types/agent'

export function useAgentStatus(enabled: boolean) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['agent-status'],
    queryFn: loadAgentStatus,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })
  useLiveEventTopic({
    topic: 'agents:fleet',
    enabled: enabled && query.isSuccess,
    onEvent: (event) => {
      if (!enabled) return
      const next = mergeAgentStatusEvent(queryClient.getQueryData<AgentStatusSummary>(['agent-status']), event)
      if (next) queryClient.setQueryData(['agent-status'], next)
      else void query.refetch()
    },
    onResync: () => { if (enabled) void query.refetch() },
  })
  return query
}
