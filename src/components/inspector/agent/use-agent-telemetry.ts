import { useQuery } from '@tanstack/react-query'
import { loadAgentTelemetry } from '@/lib/agent-api'
import type { AgentHostType } from '@/types/agent'
import type { InventoryItem, ProjectState } from '@/types/inventory'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'

export function useAgentTelemetry({
  hostType,
  hostId,
  enabled,
}: {
  hostType: AgentHostType
  hostId: number
  enabled: boolean
}) {
  const query = useQuery({
    queryKey: ['agent-telemetry', hostType, hostId, '30m'],
    queryFn: () => loadAgentTelemetry(hostType, hostId, { limit: 30 }),
    enabled,
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })
  useLiveEventTopic({
    topic: `agent-telemetry:${hostType}:${hostId}`,
    enabled,
    onEvent: () => { void query.refetch() },
    onResync: () => { void query.refetch() },
  })
  return query
}

const HOST_TYPES = new Set<AgentHostType>(['server', 'nas', 'pcBuild'])

function telemetryHost(project: ProjectState, item: InventoryItem | null) {
  if (!item) return null
  if (HOST_TYPES.has(item.type as AgentHostType)) return { type: item.type as AgentHostType, id: item.id }
  const assignment = project.assignments.find((candidate) => candidate.itemId === `${item.type}:${item.id}`)
  const host = assignment ? project.items[assignment.serverId] : null
  return host && HOST_TYPES.has(host.type as AgentHostType)
    ? { type: host.type as AgentHostType, id: host.id }
    : null
}

export function useAssignedItemAgentTelemetry({
  project,
  item,
  enabled,
}: {
  project: ProjectState
  item: InventoryItem | null
  enabled: boolean
}) {
  const host = telemetryHost(project, item)
  return useAgentTelemetry({
    hostType: host?.type ?? 'server',
    hostId: host?.id ?? 1,
    enabled: enabled && Boolean(host),
  })
}
