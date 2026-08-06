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
import type { InspectorAuditWarning } from '@/components/inspector/audit/audit-section'
import { PortTabsEditor } from '@/components/inspector/connections/connection-editor'
import { ServerNetworkTab } from '@/components/inspector/network/server-network-tab'
import { EditableSpecsSection } from '@/components/inspector/shared/editable-specs-section'
import { updateEditorPorts } from '@/components/inspector/shared/inventory-editor-ports'
import { itemFromEditorValues } from '@/components/inspector/shared/item-editor-adapters'
import { EquipmentSlotsTab } from '@/components/inspector/slots/equipment-slots-tab'
import { InspectorTabs } from '@/components/inspector/inspector-tabs'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import { InventoryFormStatus } from '@/components/inventory-form/specs-tab-content'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import { usePermission } from '@/hooks/use-permission'
import { isHostCompatibilityEnabled } from '@/lib/compatibility'
import { setHostCompatibilityEnabled } from '@/lib/compatibility-policy'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import type { AgentHardwareSuggestion, AgentStatusSummary } from '@/types/agent'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

export function ServerInspectorTabs({
  project,
  server,
  agentStatus,
  agentHardwareSuggestions,
  demoMode,
  activeNetworkTraceKey,
  pendingEndpoint,
  auditWarnings,
  onUpdateProject,
  onUpdateItem,
  onSelectNetworkTrace,
  onEndpointConnectionClick,
}: {
  project: ProjectState
  server: InventoryItem
  agentStatus: AgentStatusSummary | null
  agentHardwareSuggestions: AgentHardwareSuggestion[]
  demoMode: boolean
  activeNetworkTraceKey: string | null
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: InspectorAuditWarning[]
  onUpdateProject: (project: ProjectState) => void
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
}) {
  const canViewAgents = usePermission('agents.view')
  const editor = useInventoryItemEditor({
    item: server,
    onSave: (input) => onUpdateItem(runtimeItemKey(server), input),
  })
  const draftServer = itemFromEditorValues(server, editor.values)
  const status = getAgentHostStatus(agentStatus, 'server', server.id)
  const registered = isAgentHostRegistered(agentStatus, 'server', server.id)
  const hasSavedStatus = hasAgentHostStatus(agentStatus, 'server', server.id)
  const showServices = (registered || hasSavedStatus)
    && agentSectionAvailable(status, 'host.services', status.services)
  const showContainers = (registered || hasSavedStatus)
    && agentSectionAvailable(status, 'containers', status.containers)
  const handlePortsUpdate = (ports: InventoryPort[]) => updateEditorPorts(editor, ports)

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
              title="Server Details"
              editor={editor}
              auditWarnings={auditWarnings}
              displayName
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
              host={draftServer}
              title="Server Slots"
            />
          ),
        },
        {
          value: 'ports',
          label: 'Ports',
          content: (
            <>
              <PortGroupsEditor
                type="server"
                groups={editor.values.portGroups}
                error={editor.errors.portGroups}
                onChange={(portGroups) => editor.updateValues({ portGroups }, 'immediate')}
              />
              <PortTabsEditor
                project={project}
                item={draftServer}
                pendingEndpoint={pendingEndpoint}
                onUpdate={handlePortsUpdate}
                onEndpointConnect={onEndpointConnectionClick}
              />
            </>
          ),
        },
        {
          value: 'network',
          label: 'Network',
          content: (
            <ServerNetworkTab
              project={project}
              server={draftServer}
              status={status}
              activeNetworkTraceKey={activeNetworkTraceKey}
              onUpdateServerPorts={handlePortsUpdate}
              onUpdateItem={onUpdateItem}
              onSelectTrace={onSelectNetworkTrace}
            />
          ),
        },
        ...(showServices ? [{
          value: 'services',
          label: 'Services',
          content: <AgentServicesPanel services={status.services ?? []} />,
        }] : []),
        ...(showContainers ? [{
          value: 'containers',
          label: 'Containers',
          content: <AgentContainersPanel containers={status.containers ?? []} />,
        }] : []),
        ...(canViewAgents ? [{
          value: 'agent',
          label: 'Agent',
          content: (
            <AgentInspectorTab
              host={draftServer}
              status={status}
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
              host={draftServer}
              values={editor.values}
              errors={editor.errors}
              onChange={editor.updateValues}
              enabled={isHostCompatibilityEnabled(project, runtimeItemKey(server))}
              onEnabledChange={(enabled) => onUpdateProject(
                setHostCompatibilityEnabled(project, runtimeItemKey(server), enabled),
              )}
            />
          ),
        },
      ]}
    />
  )
}
