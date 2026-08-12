import type { InventoryItemInput } from '@/lib/db'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import type { AgentStatusSummary } from '@/types/agent'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  InventoryItem,
  InventoryProperties,
  NasPowerConfiguration,
  ProjectState,
} from '@/types/inventory'

export type InspectorPanelProps = {
  project: ProjectState
  topologyData?: TopologyQueryData | null
  compatibleEndpointKeys?: ReadonlySet<string> | null
  topologyStatusMessage?: string | null
  topologyStatusIsError?: boolean
  agentStatus: AgentStatusSummary | null
  demoMode?: boolean
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  activeNetworkTraceKey: string | null
  pendingConnectionEndpoint: ConnectionEndpoint | null
  validationMessage: string | null
  validationSeverity?: 'error' | 'unknown'
  persistenceWarning: string | null
  open: boolean
  onClose: () => void
  onUpdateProject: (project: ProjectState) => void
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onUpdateItemProperties?: (
    itemId: string,
    properties: InventoryProperties,
  ) => void | Promise<void>
  onDuplicateItem?: (item: InventoryItem) => void
  onDuplicateItemToProject?: (item: InventoryItem) => void
  onChangeItemScope?: (item: InventoryItem, scope: 'global' | 'project') => void
  onRemoveGlobalItemFromProject?: (item: InventoryItem) => void
  onArchiveItem?: (item: InventoryItem) => void
  onReturnItemToInventory?: (runtimeItemId: string) => void
  lifecycleBusy?: boolean
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onSelectConnection?: (connectionId: string | number) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onCancelPendingConnection: () => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onUpdateConnectionRoute: (connectionId: string | number, route: ConnectionRoutePreferences) => void
  onRemoveConnection: (connectionId: string | number) => void
  onSetWarningIgnored?: (warningId: string, ignored: boolean) => void
  onRequestNasPowerConfigurationChange?: (
    item: InventoryItem,
    powerConfiguration: NasPowerConfiguration,
  ) => void
}
