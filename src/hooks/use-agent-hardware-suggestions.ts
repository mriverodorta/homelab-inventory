import { useQuery } from '@tanstack/react-query'
import { loadAgentHardwareSnapshot } from '@/lib/agent-api'
import type { AgentHardwareSuggestion, AgentHostType } from '@/types/agent'
import type { InventoryItem, ProjectState } from '@/types/inventory'

const HOST_TYPES = new Set<AgentHostType>(['server', 'nas', 'pcBuild'])

function suggestionHost(project: ProjectState, item: InventoryItem | null): InventoryItem | null {
  if (!item) return null
  if (HOST_TYPES.has(item.type as AgentHostType)) return item
  const assignment = project.assignments.find((candidate) => candidate.itemId === `${item.type}:${item.id}`)
  const host = assignment ? project.items[assignment.serverId] : null
  return host && HOST_TYPES.has(host.type as AgentHostType) ? host : null
}

export function useAgentHardwareSuggestions(
  project: ProjectState,
  item: InventoryItem | null,
  enabled: boolean,
): AgentHardwareSuggestion[] {
  const host = suggestionHost(project, item)
  const query = useQuery({
    queryKey: ['agent-hardware-snapshot', host?.type, host?.id],
    queryFn: () => loadAgentHardwareSnapshot(host!.type as AgentHostType, host!.id),
    enabled: enabled && Boolean(host),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  if (!item) return []
  return (query.data?.suggestions ?? []).filter(
    (suggestion) => suggestion.target.itemType === item.type && suggestion.target.itemId === item.id,
  )
}
