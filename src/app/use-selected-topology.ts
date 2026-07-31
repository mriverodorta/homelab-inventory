import { useMemo } from 'react'
import { endpointKey } from '@/lib/project'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import type { ConnectionEndpoint, ProjectState } from '@/types/inventory'

type UseSelectedTopologyOptions = {
  project: ProjectState | null
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  activeNetworkTraceEndpoint: ConnectionEndpoint | null
  topologyData: TopologyQueryData | undefined
}

export function useSelectedTopology({
  project,
  selectedItemId,
  selectedConnectionId,
  activeNetworkTraceEndpoint,
  topologyData,
}: UseSelectedTopologyOptions) {
  const selectedItem = useMemo(
    () => (project && selectedItemId ? project.items[selectedItemId] ?? null : null),
    [project, selectedItemId],
  )
  const selectedConnection = useMemo(
    () => project && selectedConnectionId !== null
      ? project.connections.find(
          (connection) => String(connection.id) === String(selectedConnectionId),
        ) ?? null
      : null,
    [project, selectedConnectionId],
  )
  const activeNetworkTrace = useMemo(
    () => activeNetworkTraceEndpoint
      ? topologyData?.networkTraceByEndpointKey.get(endpointKey(activeNetworkTraceEndpoint)) ?? null
      : null,
    [activeNetworkTraceEndpoint, topologyData],
  )
  const activeNetworkTraceConnectionIds = useMemo(
    () => activeNetworkTrace
      ? [...new Set(activeNetworkTrace.steps.flatMap((step) =>
          step.connectionId === undefined ? [] : [step.connectionId],
        ))]
      : [],
    [activeNetworkTrace],
  )
  const activeNetworkTraceItemIds = useMemo(
    () => activeNetworkTrace
      ? [...new Set(activeNetworkTrace.steps.map((step) => step.endpoint.itemId))]
      : [],
    [activeNetworkTrace],
  )

  return {
    selectedItem,
    selectedConnection,
    activeNetworkTrace,
    activeNetworkTraceConnectionIds,
    activeNetworkTraceItemIds,
  }
}
