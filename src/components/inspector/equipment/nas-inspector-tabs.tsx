import { HostCompatibilityTab } from '@/components/host-compatibility-tab'
import { AgentContainersPanel } from '@/components/inspector/agent/agent-containers-panel'
import { AgentInspectorTab } from '@/components/inspector/agent/agent-inspector-tab'
import { AgentServicesPanel } from '@/components/inspector/agent/agent-services-panel'
import {
  getAgentHostStatus,
  hasAgentHostStatus,
  isAgentHostRegistered,
} from '@/components/inspector/agent/server-agent-status'
import { agentSectionAvailable } from '@/components/inspector/agent/agent-status-utils'
import { useAgentTelemetry } from '@/components/inspector/agent/use-agent-telemetry'
import type { InspectorAuditWarning } from '@/components/inspector/audit/audit-section'
import {
  ConnectionEditor,
  PortTabsEditor,
} from '@/components/inspector/connections/connection-editor'
import { InspectorTabs } from '@/components/inspector/inspector-tabs'
import { NetworkTraceSection } from '@/components/inspector/network/server-network-tab'
import {
  EditableSpecsSection,
} from '@/components/inspector/shared/editable-specs-section'
import { updateEditorPorts } from '@/components/inspector/shared/inventory-editor-ports'
import { itemFromEditorValues } from '@/components/inspector/shared/item-editor-adapters'
import { EquipmentSlotsTab } from '@/components/inspector/slots/equipment-slots-tab'
import type { InventoryFormValues } from '@/components/inventory-form/model'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import { InventoryFormStatus } from '@/components/inventory-form/specs-tab-content'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import { usePermission } from '@/hooks/use-permission'
import { isHostCompatibilityEnabled } from '@/lib/compatibility'
import {
  setHostCompatibilityEnabled,
  setVerifiedMemoryLimitEnabled,
} from '@/lib/compatibility-policy'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import type { AgentHardwareSuggestion, AgentStatusSummary } from '@/types/agent'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  NasPowerConfiguration,
  ProjectState,
} from '@/types/inventory'
import { nasPowerTopology } from '../../../../shared/power-ports.mjs'

export function NasInspectorTabs({
  project,
  item,
  agentStatus,
  agentHardwareSuggestions,
  demoMode,
  pendingEndpoint,
  auditWarnings,
  activeNetworkTraceKey,
  onUpdateProject,
  onUpdateItem,
  onCreateConnection,
  onEndpointConnectionClick,
  onSelectNetworkTrace,
  onUpdateConnectionLabel,
  onRemoveConnection,
  onRequestPowerConfigurationChange,
}: {
  project: ProjectState
  item: InventoryItem
  agentStatus: AgentStatusSummary | null
  agentHardwareSuggestions: AgentHardwareSuggestion[]
  demoMode: boolean
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: InspectorAuditWarning[]
  activeNetworkTraceKey: string | null
  onUpdateProject: (project: ProjectState) => void
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
  onRequestPowerConfigurationChange: (
    item: InventoryItem,
    powerConfiguration: NasPowerConfiguration,
  ) => void
}) {
  const canViewAgents = usePermission('agents.view')
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
  const status = getAgentHostStatus(agentStatus, 'nas', item.id)
  const registered = isAgentHostRegistered(agentStatus, 'nas', item.id)
  const hasSavedStatus = hasAgentHostStatus(agentStatus, 'nas', item.id)
  const telemetry = useAgentTelemetry({
    hostType: 'nas',
    hostId: item.id,
    enabled: canViewAgents && !demoMode && (registered || hasSavedStatus),
  })
  const liveStatus = telemetry.data?.status
    ? { ...status, ...telemetry.data.status, details: status.details, upgradeCommands: status.upgradeCommands }
    : status
  const powerTopology = nasPowerTopology(item)
  const showServices = (registered || hasSavedStatus)
    && (status.details?.services ?? agentSectionAvailable(liveStatus, 'host.services', liveStatus.services))
  const showContainers = (registered || hasSavedStatus)
    && (status.details?.containers ?? agentSectionAvailable(liveStatus, 'containers', liveStatus.containers))
  const systemPowerPorts = (draftItem.ports ?? []).filter((port) => port.kind === 'power-port')
  const editableNasItem = {
    ...draftItem,
    ports: (draftItem.ports ?? []).filter((port) => port.kind !== 'power-port'),
  }
  const handlePortsUpdate = (ports: InventoryPort[]) => updateEditorPorts(
    editor,
    [...ports.filter((port) => port.kind !== 'power-port'), ...systemPowerPorts],
  )
  const handleSpecsChange = (
    patch: Partial<InventoryFormValues>,
    mode: 'debounced' | 'immediate' = 'debounced',
  ) => {
    const requested = patch.powerConfiguration
    if (requested && requested !== editor.values.powerConfiguration) {
      onRequestPowerConfigurationChange(item, requested)
      return
    }
    editor.updateValues(patch, mode)
  }

  return (
    <InspectorTabs
      defaultValue="specs"
      status={<InventoryFormStatus saveError={editor.saveError} />}
      tabs={[
        {
          value: 'specs',
          label: 'Specs',
          content: (
            <EditableSpecsSection
              title="NAS Details"
              editor={editor}
              auditWarnings={auditWarnings}
              onChange={handleSpecsChange}
              agentSuggestions={agentHardwareSuggestions}
            />
          ),
        },
        {
          value: 'slots',
          label: 'Slots',
          content: (
            <EquipmentSlotsTab
              project={project}
              host={draftItem}
              title="NAS Slots"
              allowedTypes={powerTopology.configuration === 'external-adapter' && powerTopology.adapterDisposition === 'replaceable'
                ? ['storage', 'network', 'powerAdapter']
                : ['storage', 'network']}
            />
          ),
        },
        {
          value: 'ports',
          label: 'Ports',
          content: (
            <>
              <PortGroupsEditor
                type="nas"
                groups={editor.values.portGroups}
                error={editor.errors.portGroups}
                onChange={(portGroups) => editor.updateValues({ portGroups }, 'immediate')}
              />
              <PortTabsEditor
                project={project}
                item={editableNasItem}
                pendingEndpoint={pendingEndpoint}
                onUpdate={handlePortsUpdate}
                onEndpointConnect={onEndpointConnectionClick}
              />
              <ConnectionEditor
                project={project}
                item={draftItem}
                onCreate={onCreateConnection}
                onUpdateLabel={onUpdateConnectionLabel}
                onRemove={onRemoveConnection}
              />
            </>
          ),
        },
        {
          value: 'network',
          label: 'Network',
          content: (
            <NetworkTraceSection
              item={draftItem}
              activeTraceKey={activeNetworkTraceKey}
              onSelectTrace={onSelectNetworkTrace}
            />
          ),
        },
        ...(showServices ? [{ value: 'services', label: 'Services', content: <AgentServicesPanel services={liveStatus.services ?? []} /> }] : []),
        ...(showContainers ? [{ value: 'containers', label: 'Containers', content: <AgentContainersPanel containers={liveStatus.containers ?? []} /> }] : []),
        ...(canViewAgents ? [{
          value: 'agent',
          label: 'Agent',
          content: (
            <AgentInspectorTab
              host={draftItem}
              status={liveStatus}
              registered={registered}
              hasSavedStatus={hasSavedStatus}
              demoMode={demoMode}
              release={agentStatus?.release ?? null}
            />
          ),
        }] : []),
        {
          value: 'compatibility',
          label: 'Compatibility',
          content: (
            <HostCompatibilityTab
              project={project}
              host={draftItem}
              values={editor.values}
              errors={editor.errors}
              onChange={editor.updateValues}
              enabled={isHostCompatibilityEnabled(project, runtimeItemKey(item))}
              onEnabledChange={(enabled) => onUpdateProject(
                setHostCompatibilityEnabled(project, runtimeItemKey(item), enabled),
              )}
              onVerifiedMemoryLimitsChange={(enabled) => onUpdateProject(
                setVerifiedMemoryLimitEnabled(project, runtimeItemKey(item), enabled),
              )}
            />
          ),
        },
      ]}
    />
  )
}
