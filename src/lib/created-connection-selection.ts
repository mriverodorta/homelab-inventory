import type { ConnectionEndpoint } from '@/types/inventory'

export type CreatedConnectionSelection = {
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  activeNetworkTraceEndpoint: ConnectionEndpoint | null
}

export function resolveCreatedConnectionSelection(
  current: CreatedConnectionSelection,
  connectionId: string | number,
  openInspector: boolean,
): CreatedConnectionSelection {
  if (!openInspector) {
    return current
  }

  return {
    selectedItemId: null,
    selectedConnectionId: connectionId,
    activeNetworkTraceEndpoint: null,
  }
}
