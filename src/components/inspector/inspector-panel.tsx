import { AlertTriangle, Info, X } from 'lucide-react'
import { InventoryActionsMenu } from '@/components/inventory-actions-menu'
import { Button } from '@/components/ui/button'
import { RIGHT_DRAWER_LAYOUT_CLASS_NAME } from '@/components/right-drawer-layout'
import { describeConnectionEndpoint } from '@/lib/cables'
import { getItemAuditWarnings } from '@/lib/audit'
import { cn } from '@/lib/utils'
import { runtimeItemKey } from '@/lib/item-keys'
import type { InspectorPanelProps } from '@/components/inspector/inspector-contract'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { itemTypeLabel } from '@/components/inspector/shared/item-formatters'
import { InspectorTopologyContext } from '@/components/inspector/inspector-topology-context'
import { ConnectionDetails } from '@/components/inspector/connections/connection-editor'
import { InspectorConnectionSelectionContext } from '@/components/inspector/connections/connection-selection-context'
import {
  AuditSection,
  type InspectorAuditWarning,
} from '@/components/inspector/audit/audit-section'
import { AuditIgnoreContext } from '@/components/inspector/audit/audit-context'
import { ServerInspectorTabs } from '@/components/inspector/equipment/server-inspector-tabs'
import { SwitchInspectorTabs } from '@/components/inspector/equipment/switch-inspector-tabs'
import { NasInspectorTabs } from '@/components/inspector/equipment/nas-inspector-tabs'
import { PatchPanelInspectorTabs } from '@/components/inspector/equipment/patch-panel-inspector-tabs'
import {
  ComponentItemEditor,
} from '@/components/inspector/equipment/component-item-editor'
import { isEditableComponent } from '@/components/inspector/equipment/component-item-editor-model'
import { PcBuildInspectorTabs } from '@/components/inspector/equipment/pc-build-inspector-tabs'
import { StandalonePowerEquipmentTabs } from '@/components/inspector/equipment/standalone-power-equipment-tabs'
import { usePermission } from '@/hooks/use-permission'
import { useAgentHardwareSuggestions } from '@/hooks/use-agent-hardware-suggestions'
import { useAssignedItemAgentTelemetry } from '@/components/inspector/agent/use-agent-telemetry'

const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'

export function InspectorPanel({
  layout = 'overlay',
  project,
  topologyData = null,
  compatibleEndpointKeys = null,
  topologyStatusMessage = null,
  topologyStatusIsError = false,
  agentStatus,
  demoMode = false,
  selectedItemId,
  selectedConnectionId,
  activeNetworkTraceKey,
  pendingConnectionEndpoint,
  validationMessage,
  validationSeverity = 'error',
  persistenceWarning,
  open,
  onClose,
  onUpdateProject,
  onUpdateItem,
  onUpdateItemProperties = () => undefined,
  onDuplicateItem = () => undefined,
  onDuplicateItemToProject,
  onChangeItemScope,
  onRemoveGlobalItemFromProject,
  onArchiveItem = () => undefined,
  onReturnItemToInventory,
  lifecycleBusy = false,
  onCreateConnection,
  onSelectConnection = () => undefined,
  onSelectNetworkTrace,
  onEndpointConnectionClick,
  onCancelPendingConnection,
  onUpdateConnectionLabel,
  onUpdateConnectionRoute,
  onRemoveConnection,
  onRequestNasPowerConfigurationChange = () => undefined,
  onSetWarningIgnored = () => undefined,
}: InspectorPanelProps) {
  const canCreateInventory = usePermission('inventory.create')
  const canEditInventory = usePermission('inventory.edit')
  const canArchiveInventory = usePermission('inventory.archive')
  const canEditCanvas = usePermission('canvas.edit')
  const canEditConnections = usePermission('connections.edit')
  const canManageProject = usePermission('project.settings.manage')
  const canManageAudit = usePermission('audit.manage')
  const canViewAgents = usePermission('agents.view')
  const updateProject = canManageProject ? onUpdateProject : () => undefined
  const updateItem = canEditInventory ? onUpdateItem : () => undefined
  const updateItemProperties = canEditInventory ? onUpdateItemProperties : () => undefined
  const updateConnectionLabel = canEditConnections ? onUpdateConnectionLabel : () => undefined
  const updateConnectionRoute = canEditConnections ? onUpdateConnectionRoute : () => undefined
  const removeConnection = canEditConnections ? onRemoveConnection : () => undefined
  const createConnection = canEditConnections ? onCreateConnection : () => undefined
  const requestNasPowerConfigurationChange = canEditInventory ? onRequestNasPowerConfigurationChange : () => undefined
  const selectedItem = selectedItemId ? project.items[selectedItemId] ?? null : null
  const agentHardwareSuggestions = useAgentHardwareSuggestions(
    project,
    selectedItem,
    canViewAgents && !demoMode,
  )
  const selectedItemTelemetry = useAssignedItemAgentTelemetry({
    project,
    item: selectedItem,
    enabled: canViewAgents && !demoMode && selectedItem?.type === 'storage',
  })
  const selectedStorageTelemetry = selectedItem?.type === 'storage'
    ? selectedItemTelemetry.data?.storage?.items.find((entry) => entry.itemId === selectedItem.id) ?? null
    : null
  const selectedConnection = selectedConnectionId
    ? project.connections.find((connection) => String(connection.id) === String(selectedConnectionId)) ?? null
    : null
  const selectedItemRuntimeKey = selectedItem ? runtimeItemKey(selectedItem) : null
  const selectedItemIsPlaced = selectedItemRuntimeKey
    ? project.placements.some((placement) => placement.serverId === selectedItemRuntimeKey)
    : false
  const openAuditWarnings = selectedItemRuntimeKey
    ? getItemAuditWarnings(project, selectedItemRuntimeKey, {}, topologyData ? {
      endpoints: topologyData.endpoints,
      networkTraces: topologyData.networkTraces,
      powerEndpoints: topologyData.power.endpoints,
      powerFindings: topologyData.power.findings,
    } : undefined)
    : []
  const ignoredAuditWarnings = selectedItemRuntimeKey
    ? getItemAuditWarnings(project, selectedItemRuntimeKey, { visibility: 'ignored' }, topologyData ? {
      endpoints: topologyData.endpoints,
      networkTraces: topologyData.networkTraces,
      powerEndpoints: topologyData.power.endpoints,
      powerFindings: topologyData.power.findings,
    } : undefined)
    : []
  const auditWarnings: InspectorAuditWarning[] = [
    ...openAuditWarnings.map((warning) => ({ ...warning, ignored: false })),
    ...ignoredAuditWarnings.map((warning) => ({ ...warning, ignored: true })),
  ]
  const drawerTitle = selectedConnection
    ? selectedConnection.label?.trim() || 'Connection'
    : selectedItem ? selectedItem.name : 'Inspector'
  const drawerType = selectedConnection
    ? 'Connection'
    : selectedItem ? itemTypeLabel(selectedItem.type) : null

  return (
    <aside
      data-testid="inspector-drawer"
      role="dialog"
      aria-label={`${drawerTitle} inspector`}
      className={cn(`${RIGHT_DRAWER_LAYOUT_CLASS_NAME} z-40 flex min-h-0 flex-col overflow-x-hidden border-l border-[#d6ccbd] bg-[radial-gradient(circle_at_top_left,#fffdf8_0%,#fbf7ef_44%,#f3ede4_100%)] shadow-[-22px_0_46px_rgba(32,36,44,0.18)] transition-transform duration-200 ease-out`, layout === 'systems-split' && 'lg:absolute lg:inset-y-0 lg:right-0 lg:w-full lg:shadow-[-10px_0_24px_rgba(32,36,44,0.12)]',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#e5dccf] bg-[#fffdf8]/88 p-4 backdrop-blur">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-lg font-black text-[#20242c]">{drawerTitle}</h2>
          {drawerType ? (
            <StatusBadge className="shrink-0">
              {drawerType}
            </StatusBadge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {selectedItem ? (
            <InventoryActionsMenu
              itemName={selectedItem.name}
              busy={lifecycleBusy}
              onDuplicate={canCreateInventory ? () => onDuplicateItem(selectedItem) : undefined}
              onDuplicateToProject={canCreateInventory && onDuplicateItemToProject ? () => onDuplicateItemToProject(selectedItem) : undefined}
              onMakeGlobal={canEditInventory && selectedItem.scope === 'project' && onChangeItemScope
                ? () => onChangeItemScope(selectedItem, 'global')
                : undefined}
              onMakeProjectBound={canEditInventory && selectedItem.scope === 'global' && onChangeItemScope
                ? () => onChangeItemScope(selectedItem, 'project')
                : undefined}
              onRemoveFromProject={canEditInventory && selectedItem.scope === 'global' && onRemoveGlobalItemFromProject
                ? () => onRemoveGlobalItemFromProject(selectedItem)
                : undefined}
              onArchive={canArchiveInventory ? () => onArchiveItem(selectedItem) : undefined}
              onReturnToInventory={canEditCanvas && selectedItemIsPlaced && selectedItemRuntimeKey && onReturnItemToInventory
                ? () => onReturnItemToInventory(selectedItemRuntimeKey)
                : undefined}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Close inspector"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-4 sm:p-5">
        {pendingConnectionEndpoint ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[#d6ccbd] bg-[#f8f3eb] p-3 text-xs text-[#5f554b] shadow-[0_8px_20px_rgba(60,52,43,0.06)]">
            <div>
              <div className={labelClass}>Connecting</div>
              <div className="mt-1 font-semibold text-[#20242c]">
                {describeConnectionEndpoint(project, pendingConnectionEndpoint)}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onCancelPendingConnection}
            >
              Cancel
            </Button>
          </div>
        ) : null}

        {validationMessage ? (
          <div
            data-testid="inspector-validation-message"
            data-severity={validationSeverity}
            role={validationSeverity === 'unknown' ? 'status' : 'alert'}
            className={cn(
              'flex gap-2 rounded-lg border p-3 text-sm font-semibold',
              validationSeverity === 'unknown'
                ? 'border-[#dfc483] bg-[#fff8df] text-[#5d4814]'
                : 'border-[#dfb3a5] bg-[#fff4ee] text-[#613126]',
            )}
          >
            {validationSeverity === 'unknown' ? (
              <Info className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{validationMessage}</span>
          </div>
        ) : null}

        {persistenceWarning ? (
          <div className="flex gap-2 rounded-lg border border-[#dfc483] bg-[#fff8df] p-3 text-sm font-semibold text-[#5d4814]">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>{persistenceWarning}</span>
          </div>
        ) : null}

        <InspectorConnectionSelectionContext.Provider value={{ onSelectConnection }}>
          <InspectorTopologyContext.Provider value={{
            data: topologyData,
            compatibleEndpointKeys,
            statusMessage: topologyStatusMessage,
            statusIsError: topologyStatusIsError,
          }}>
            <AuditIgnoreContext.Provider value={canManageAudit ? onSetWarningIgnored : null}>
              <section className="space-y-4">
          {selectedConnection ? (
            <ConnectionDetails
              project={project}
              connection={selectedConnection}
              onUpdateLabel={updateConnectionLabel}
              onUpdateRoute={updateConnectionRoute}
              onRemove={removeConnection}
            />
          ) : selectedItem ? (
            <>
              {selectedItem.type === 'server' ? (
                <ServerInspectorTabs
                  project={project}
                  server={selectedItem}
                  agentStatus={agentStatus}
                  agentHardwareSuggestions={agentHardwareSuggestions}
                  demoMode={demoMode}
                  activeNetworkTraceKey={activeNetworkTraceKey}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  onUpdateProject={updateProject}
                  onUpdateItem={updateItem}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                />
              ) : selectedItem.type === 'switch' ? (
                <SwitchInspectorTabs
                  project={project}
                  item={selectedItem}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  onUpdateItem={updateItem}
                  onCreateConnection={createConnection}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onUpdateConnectionLabel={updateConnectionLabel}
                  onRemoveConnection={removeConnection}
                />
              ) : selectedItem.type === 'nas' ? (
                <NasInspectorTabs
                  project={project}
                  item={selectedItem}
                  agentStatus={agentStatus}
                  agentHardwareSuggestions={agentHardwareSuggestions}
                  demoMode={demoMode}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  activeNetworkTraceKey={activeNetworkTraceKey}
                  onUpdateProject={updateProject}
                  onUpdateItem={updateItem}
                  onCreateConnection={createConnection}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onUpdateConnectionLabel={updateConnectionLabel}
                  onRemoveConnection={removeConnection}
                  onRequestPowerConfigurationChange={requestNasPowerConfigurationChange}
                />
              ) : selectedItem.type === 'patchPanel' ? (
                <PatchPanelInspectorTabs
                  project={project}
                  item={selectedItem}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  activeNetworkTraceKey={activeNetworkTraceKey}
                  onUpdateItem={updateItem}
                  onCreateConnection={createConnection}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onUpdateConnectionLabel={updateConnectionLabel}
                  onRemoveConnection={removeConnection}
                />
              ) : selectedItem.type === 'pcBuild' ? (
                <PcBuildInspectorTabs
                  project={project}
                  item={selectedItem}
                  agentStatus={agentStatus}
                  agentHardwareSuggestions={agentHardwareSuggestions}
                  demoMode={demoMode}
                  activeNetworkTraceKey={activeNetworkTraceKey}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  onUpdateProject={updateProject}
                  onUpdateItem={updateItem}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onUpdateConnectionLabel={updateConnectionLabel}
                  onRemoveConnection={removeConnection}
                />
              ) : selectedItem.type === 'monitor'
                || selectedItem.type === 'ups'
                || selectedItem.type === 'powerStrip' ? (
                <StandalonePowerEquipmentTabs
                  project={project}
                  item={selectedItem}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  onUpdateItem={updateItem}
                  onUpdateItemProperties={updateItemProperties}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onUpdateConnectionLabel={updateConnectionLabel}
                  onRemoveConnection={removeConnection}
                />
              ) : isEditableComponent(selectedItem) ? (
                <>
                  <ComponentItemEditor
                    key={runtimeItemKey(selectedItem)}
                    project={project}
                    item={selectedItem}
                    validationMessage={null}
                    pendingEndpoint={pendingConnectionEndpoint}
                    onUpdateItem={updateItem}
                    onEndpointConnectionClick={onEndpointConnectionClick}
                    agentHardwareSuggestions={agentHardwareSuggestions}
                    storageTelemetry={selectedStorageTelemetry}
                  />
                  <AuditSection warnings={auditWarnings} />
                </>
              ) : (
                null
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-4 text-sm font-medium text-[#75695d]">
              Select an inventory item or server card to inspect it.
            </div>
          )}
              </section>
            </AuditIgnoreContext.Provider>
          </InspectorTopologyContext.Provider>
        </InspectorConnectionSelectionContext.Provider>
      </div>
    </aside>
  )
}
