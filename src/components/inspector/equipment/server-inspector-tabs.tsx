import { HostCompatibilityTab } from '@/components/host-compatibility-tab'
import { AgentSetupPanel } from '@/components/inspector/agent/agent-setup-panel'
import { getServerAgentStatus } from '@/components/inspector/agent/server-agent-status'
import type { InspectorAuditWarning } from '@/components/inspector/audit/audit-section'
import { PortTabsEditor } from '@/components/inspector/connections/connection-editor'
import { ServerNetworkTab } from '@/components/inspector/network/server-network-tab'
import {
  ComingSoonSection,
  EditableSpecsSection,
} from '@/components/inspector/shared/editable-specs-section'
import { updateEditorPorts } from '@/components/inspector/shared/inventory-editor-ports'
import { itemFromEditorValues } from '@/components/inspector/shared/item-editor-adapters'
import { EquipmentSlotsTab } from '@/components/inspector/slots/equipment-slots-tab'
import { InspectorTabs } from '@/components/inspector/inspector-tabs'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import { InventoryFormStatus } from '@/components/inventory-form/specs-tab-content'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import { isHostCompatibilityEnabled } from '@/lib/compatibility'
import { setHostCompatibilityEnabled } from '@/lib/compatibility-policy'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import type { AgentStatusSummary } from '@/types/agent'
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
  demoMode: boolean
  activeNetworkTraceKey: string | null
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: InspectorAuditWarning[]
  onUpdateProject: (project: ProjectState) => void
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
}) {
  const editor = useInventoryItemEditor({
    item: server,
    onSave: (input) => onUpdateItem(runtimeItemKey(server), input),
  })
  const draftServer = itemFromEditorValues(server, editor.values)
  const status = getServerAgentStatus(agentStatus, server.id)
  const registered = agentStatus?.registeredServerIds.includes(server.id) ?? false
  const hasSavedStatus = Boolean(agentStatus?.servers[String(server.id)])
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
        {
          value: 'services',
          label: 'Services',
          content: <ComingSoonSection />,
        },
        {
          value: 'agent',
          label: 'Agent',
          content: (
            <AgentSetupPanel
              server={draftServer}
              status={status}
              registered={registered}
              hasSavedStatus={hasSavedStatus}
              demoMode={demoMode}
            />
          ),
        },
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
