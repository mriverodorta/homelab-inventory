import type { HistoryState } from '@/lib/history'
import type {
  InventoryMetadataHistoryState,
  ProjectHistorySnapshot,
} from '@/app/project-history-snapshot'
import type { ConnectionEndpoint, ProjectState } from '@/types/inventory'

export type CanvasRuntimeViewState = {
  project: ProjectState
  history: HistoryState<ProjectHistorySnapshot>
  metadataHistory: InventoryMetadataHistoryState
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  activeNetworkTraceEndpoint: ConnectionEndpoint | null
}

export function validCanvasRuntimeViewState(
  state: CanvasRuntimeViewState,
): CanvasRuntimeViewState {
  const selectedItemId = state.selectedItemId && state.project.items[state.selectedItemId]
    ? state.selectedItemId
    : null
  const selectedConnectionId = state.selectedConnectionId
    && state.project.connections.some((connection) => connection.id === state.selectedConnectionId)
      ? state.selectedConnectionId
      : null
  const activeNetworkTraceEndpoint = state.activeNetworkTraceEndpoint
    && state.project.items[state.activeNetworkTraceEndpoint.itemId]
      ? state.activeNetworkTraceEndpoint
      : null

  return {
    ...state,
    selectedItemId,
    selectedConnectionId,
    activeNetworkTraceEndpoint,
  }
}
