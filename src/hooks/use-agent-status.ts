import { useQuery } from '@tanstack/react-query'
import { loadAgentStatus } from '@/lib/agent-api'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'

export function useAgentStatus(enabled: boolean) {
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
    enabled,
    onEvent: () => { void query.refetch() },
    onResync: () => { void query.refetch() },
  })
  return query
}
