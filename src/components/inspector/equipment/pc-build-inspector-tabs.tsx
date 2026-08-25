import { useContext, useEffect, useMemo, useState } from 'react'
import { Cable, Layers3, Network, PlugZap } from 'lucide-react'
import { HostCompatibilityTab } from '@/components/host-compatibility-tab'
import { AgentContainersPanel } from '@/components/inspector/agent/agent-containers-panel'
import { AgentInspectorTab } from '@/components/inspector/agent/agent-inspector-tab'
import { AgentServicesPanel } from '@/components/inspector/agent/agent-services-panel'
import { AttentionTab, type AttentionActions } from '@/components/inspector/attention/attention-tab'
import { useAttentionTabVisibility } from '@/components/inspector/attention/attention-tab-visibility'
import {
  getAgentHostStatus,
  hasAgentHostStatus,
  isAgentHostRegistered,
} from '@/components/inspector/agent/server-agent-status'
import { agentSectionAvailable } from '@/components/inspector/agent/agent-status-utils'
import { useAgentTelemetry } from '@/components/inspector/agent/use-agent-telemetry'
import type { InspectorAuditWarning } from '@/components/inspector/audit/audit-section'
import {
  EndpointConnectButton,
  formatPortTypeLabel,
  getEndpointConnectionState,
  getEndpointConnections,
  getOppositeEndpoint,
  portChipClass,
  updatePort,
} from '@/components/inspector/connections/connection-editor'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { InspectorTabs } from '@/components/inspector/inspector-tabs'
import { InspectorTopologyContext } from '@/components/inspector/inspector-topology-context'
import { NetworkTraceCard } from '@/components/inspector/network/server-network-tab'
import { PowerEndpointsTab } from '@/components/inspector/power/power-endpoints-tab'
import { getPcBuildPortOptions } from '@/components/inspector/equipment/pc-build-port-options'
import { EditableSpecsSection } from '@/components/inspector/shared/editable-specs-section'
import {
  itemFromEditorValues,
  itemInputWithPorts,
} from '@/components/inspector/shared/item-editor-adapters'
import { SlotItemCard } from '@/components/inspector/slots/equipment-slots-tab'
import { slotTone } from '@/components/inspector/slots/equipment-slot-model'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import { usePermission } from '@/hooks/use-permission'
import { describeConnectionEndpoint } from '@/lib/cables'
import { isHostCompatibilityEnabled } from '@/lib/compatibility'
import { setHostCompatibilityEnabled } from '@/lib/compatibility-policy'
import { SLOT_LABELS, sortAssignmentsForDisplay } from '@/lib/constraints'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import { PC_BUILD_COMPONENT_ORDER } from '@/lib/pc-build'
import { endpointKey } from '@/lib/project'
import { cn } from '@/lib/utils'
import type { AgentHardwareSuggestion, AgentStatusSummary } from '@/types/agent'
import type {
  ConnectionEndpoint,
  InventoryItem,
  ProjectState,
} from '@/types/inventory'
import { InventoryFormStatus } from '@/components/inventory-form/specs-tab-content'

const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'
const formLabelClass = 'grid gap-1.5 text-sm font-semibold text-[#20242c]'

export function HostedPortsTab({
  project,
  host,
  networkOnly = false,
  activeNetworkTraceKey,
  pendingEndpoint,
  onUpdateItem,
  onSelectTrace,
  onEndpointConnect,
}: {
  project: ProjectState
  host: InventoryItem
  networkOnly?: boolean
  activeNetworkTraceKey: string | null
  pendingEndpoint: ConnectionEndpoint | null
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onSelectTrace: (endpoint: ConnectionEndpoint) => void
  onEndpointConnect: (endpoint: ConnectionEndpoint) => void
}) {
  const topology = useContext(InspectorTopologyContext)
  const options = useMemo(
    () => getPcBuildPortOptions(project, host, networkOnly),
    [host, networkOnly, project],
  )
  const [selectedKey, setSelectedKey] = useState(() => options[0]?.key ?? '')
  const selected = options.find((option) => option.key === selectedKey) ?? options[0] ?? null
  const connections = selected ? getEndpointConnections(project, selected.endpoint) : []
  const trace = networkOnly && selected
    ? topology.data?.networkTraceByEndpointKey.get(endpointKey(selected.endpoint)) ?? null
    : null

  useEffect(() => {
    if (options.length === 0) {
      setSelectedKey('')
    } else if (!options.some((option) => option.key === selectedKey)) {
      setSelectedKey(options[0].key)
    }
  }, [options, selectedKey])

  if (options.length === 0) {
    return (
      <InspectorSection title={networkOnly ? 'Network Interfaces' : 'PC Build Ports'} icon={networkOnly ? Network : PlugZap}>
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-3 text-sm font-medium text-[#75695d]">
          {networkOnly ? 'No physical network interfaces assigned.' : 'No motherboard or expansion-card ports recorded.'}
        </div>
      </InspectorSection>
    )
  }

  return (
    <div className="space-y-4">
      <InspectorSection
        title={networkOnly ? 'Network Interfaces' : 'PC Build Ports'}
        icon={networkOnly ? Network : PlugZap}
        badge={<StatusBadge>{options.length} ports</StatusBadge>}
      >
        <Tabs value={selected?.key ?? ''} onValueChange={setSelectedKey} className="gap-4 overflow-visible">
          <TabsList className="flex !h-auto w-full flex-wrap items-stretch justify-start gap-2 overflow-visible bg-transparent p-0 pb-1">
            {options.map((option) => (
              <TabsTrigger
                key={option.key}
                value={option.key}
                className={cn(
                  '!h-auto flex-none rounded-md border px-2.5 py-1.5 text-[#20242c] shadow-none data-active:ring-2 data-active:ring-[#ddb668]',
                  portChipClass(getEndpointConnectionState(project, option.endpoint)),
                )}
              >
                <span className="grid leading-none">
                  <span className="text-[9px] font-black uppercase tracking-[0.06em] opacity-70">
                    {formatPortTypeLabel(option.port.type)}
                  </span>
                  <span className="mt-1 font-mono text-base font-black">
                    {String(option.port.slotNumber).padStart(2, '0')}
                  </span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {selected ? (
            <TabsContent value={selected.key} className="m-0">
              <div className="grid gap-3 rounded-lg border border-[#e5dccf] bg-[#fffdf8] p-3">
                <div className="grid gap-2 sm:grid-cols-[68px_minmax(0,1fr)_auto] sm:items-end">
                  <div className="rounded-md bg-[#20242c] px-3 py-2 text-center text-[#fffdf8]">
                    <div className="text-[8px] font-black uppercase tracking-[0.12em] opacity-65">Port</div>
                    <div className="font-mono text-xl font-black leading-none">
                      {String(selected.port.slotNumber).padStart(2, '0')}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className={cn(labelClass, 'mb-1 text-[9px]')}>Source</div>
                    <div className="truncate rounded-md bg-[#f3f0ea] px-3 py-2 text-sm font-black text-[#3c342b]">
                      {selected.sourceLabel} / {formatPortTypeLabel(selected.port.type)}
                      {selected.port.speed ? ` ${selected.port.speed}` : ''}
                    </div>
                  </div>
                  <StatusBadge tone={connections.length > 0 ? 'success' : 'neutral'}>
                    {connections.length > 0 ? 'Connected' : 'Open'}
                  </StatusBadge>
                </div>

                <label className={formLabelClass}>
                  Custom label
                  <Input
                    value={selected.port.label ?? ''}
                    placeholder="Custom label"
                    aria-label={`${selected.sourceLabel} port ${selected.port.slotNumber} label`}
                    onChange={(event) => onUpdateItem(
                      selected.itemKey,
                      itemInputWithPorts(selected.item, updatePort(selected.item.ports ?? [], selected.port.id, { label: event.target.value })),
                    )}
                  />
                </label>

                {networkOnly ? (
                  <label className={formLabelClass}>
                    IP address
                    <Input
                      value={selected.port.ipAddress ?? ''}
                      placeholder="192.168.1.10"
                      aria-label={`${selected.sourceLabel} port ${selected.port.slotNumber} IP address`}
                      onChange={(event) => onUpdateItem(
                        selected.itemKey,
                        itemInputWithPorts(selected.item, updatePort(selected.item.ports ?? [], selected.port.id, { ipAddress: event.target.value })),
                      )}
                    />
                  </label>
                ) : null}

                <div className="grid gap-2">
                  <div className={labelClass}>Connection</div>
                  {connections.length === 0 ? (
                    <div className="grid gap-2 rounded-md bg-[#f8f3eb] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <span className="text-sm font-semibold text-[#75695d]">This port is open.</span>
                      <EndpointConnectButton
                        project={project}
                        endpoint={selected.endpoint}
                        label={selected.port.label || `${selected.sourceLabel} port ${selected.port.slotNumber}`}
                        pendingEndpoint={pendingEndpoint}
                        onConnect={onEndpointConnect}
                      />
                    </div>
                  ) : connections.map((connection) => (
                    <div key={connection.id} className="rounded-md bg-[#f8f3eb] p-3 text-sm font-semibold text-[#20242c]">
                      {describeConnectionEndpoint(project, getOppositeEndpoint(connection, selected.endpoint))}
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </InspectorSection>

      {networkOnly ? (
        <InspectorSection title="Network Trace" icon={Cable}>
          {trace ? (
            <NetworkTraceCard
              trace={trace}
              active={activeNetworkTraceKey === endpointKey(trace.start)}
              onSelectTrace={onSelectTrace}
            />
          ) : (
            <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-3 text-sm font-medium text-[#75695d]">
              No network trace available for this interface.
            </div>
          )}
        </InspectorSection>
      ) : null}
    </div>
  )
}

export function PcBuildSlotsTab({ project, host }: { project: ProjectState; host: InventoryItem }) {
  const hostKey = runtimeItemKey(host)
  const assignments = sortAssignmentsForDisplay(project, hostKey)

  return (
    <InspectorSection title="PC Build Slots" icon={Layers3} badge={<StatusBadge>{PC_BUILD_COMPONENT_ORDER.length}</StatusBadge>}>
      <div className="grid gap-2">
        {PC_BUILD_COMPONENT_ORDER.map((type) => {
          const matches = assignments.filter((assignment) => assignment.type === type)
          return (
            <div key={type} className={cn('grid gap-2 rounded-lg border p-3', slotTone(type))}>
              <div className="flex items-center justify-between gap-2">
                <div className={cn(labelClass, 'text-[10px]')}>{SLOT_LABELS[type]}</div>
                <StatusBadge tone={matches.length > 0 ? 'success' : 'neutral'}>
                  {matches.length > 0 ? `${matches.length} assigned` : 'Open'}
                </StatusBadge>
              </div>
              {matches.length > 0 ? matches.map((assignment) => {
                const assignedItem = project.items[assignment.itemId]
                return assignedItem ? <SlotItemCard key={assignment.id} item={assignedItem} /> : null
              }) : (
                <div className="rounded-md border border-dashed border-white/80 bg-white/35 p-3 text-sm font-semibold text-[#75695d]">
                  No {SLOT_LABELS[type].toLowerCase()} assigned.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </InspectorSection>
  )
}


export function PcBuildInspectorTabs({
  project,
  item,
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
  onUpdateConnectionLabel,
  onRemoveConnection,
  attentionActions,
  attentionWorkspaceId = null,
  requestedTab,
}: {
  project: ProjectState
  item: InventoryItem
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
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
  attentionActions: AttentionActions
  attentionWorkspaceId?: number | null
  requestedTab?: string | null
}) {
  const canViewAgents = usePermission('agents.view')
  const projectId = project.metadata.projectId ?? 1
  const showAttention = useAttentionTabVisibility({
    projectId, workspaceId: attentionWorkspaceId, hostType: 'pcBuild', hostId: item.id, requestedTab,
  })
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
  const status = getAgentHostStatus(agentStatus, 'pcBuild', item.id)
  const registered = isAgentHostRegistered(agentStatus, 'pcBuild', item.id)
  const hasSavedStatus = hasAgentHostStatus(agentStatus, 'pcBuild', item.id)
  const telemetry = useAgentTelemetry({
    hostType: 'pcBuild',
    hostId: item.id,
    enabled: canViewAgents && !demoMode && (registered || hasSavedStatus),
  })
  const liveStatus = telemetry.data?.status
    ? { ...status, ...telemetry.data.status, details: status.details, upgradeCommands: status.upgradeCommands }
    : status
  const showServices = (registered || hasSavedStatus)
    && (status.details?.services ?? agentSectionAvailable(liveStatus, 'host.services', liveStatus.services))
  const showContainers = (registered || hasSavedStatus)
    && (status.details?.containers ?? agentSectionAvailable(liveStatus, 'containers', liveStatus.containers))

  return (
    <InspectorTabs
      defaultValue="specs"
      requestedValue={requestedTab}
      status={<InventoryFormStatus saveError={editor.saveError} />}
      tabs={[
        {
          value: 'specs',
          label: 'Specs',
          content: <EditableSpecsSection title="PC Build Details" editor={editor} auditWarnings={auditWarnings} displayName agentSuggestions={agentHardwareSuggestions} />,
        },
        { value: 'slots', label: 'Slots', content: <PcBuildSlotsTab project={project} host={draftItem} /> },
        {
          value: 'ports',
          label: 'Ports',
          content: (
            <HostedPortsTab
              project={project}
              host={draftItem}
              activeNetworkTraceKey={activeNetworkTraceKey}
              pendingEndpoint={pendingEndpoint}
              onUpdateItem={onUpdateItem}
              onSelectTrace={onSelectNetworkTrace}
              onEndpointConnect={onEndpointConnectionClick}
            />
          ),
        },
        {
          value: 'network',
          label: 'Network',
          content: (
            <HostedPortsTab
              project={project}
              host={draftItem}
              networkOnly
              activeNetworkTraceKey={activeNetworkTraceKey}
              pendingEndpoint={pendingEndpoint}
              onUpdateItem={onUpdateItem}
              onSelectTrace={onSelectNetworkTrace}
              onEndpointConnect={onEndpointConnectionClick}
            />
          ),
        },
        {
          value: 'power',
          label: 'Power',
          content: (
            <PowerEndpointsTab
              project={project}
              item={draftItem}
              onUpdateConnectionLabel={onUpdateConnectionLabel}
              onRemoveConnection={onRemoveConnection}
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
            />
          ),
        },
        ...(showAttention ? [{
          value: 'attention',
          label: 'Attention',
          content: <AttentionTab projectId={projectId} workspaceId={attentionWorkspaceId} hostType="pcBuild" hostId={item.id} actions={attentionActions} />,
        }] : []),
      ]}
    />
  )
}
