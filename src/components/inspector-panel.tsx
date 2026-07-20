import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  Cable,
  Copy,
  Info,
  Layers3,
  Network,
  PlugZap,
  Terminal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ComponentInspectorTabs } from '@/components/component-inspector-tabs'
import { HostCompatibilityTab } from '@/components/host-compatibility-tab'
import { InventoryActionsMenu } from '@/components/inventory-actions-menu'
import {
  inventoryFormValuesToInput,
  inventoryItemToFormValues,
  inventoryPortsToFormPatch,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import { PortGroupsEditor } from '@/components/inventory-form/port-groups-editor'
import {
  InventoryFormStatus,
  InventorySpecsFormContent,
} from '@/components/inventory-form/specs-tab-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  describeConnectionEndpoint,
  getCableAppearance,
} from '@/lib/cables'
import { getItemAuditWarnings, type AuditWarning } from '@/lib/audit'
import {
  clearAgentStatus,
  createAgentEnrollment,
  revokeAgentRegistration,
} from '@/lib/agent-api'
import type { InventoryItemInput } from '@/lib/db'
import { useInventoryItemEditor } from '@/hooks/use-inventory-item-editor'
import {
  getCompatibleDestinationGroups,
  getEndpointGroupForHost,
} from '@/lib/connection-endpoints'
import { getSlotStatus, SLOT_LABELS, sortAssignmentsForDisplay } from '@/lib/constraints'
import { isHostCompatibilityEnabled } from '@/lib/compatibility'
import { setHostCompatibilityEnabled } from '@/lib/compatibility-policy'
import { PC_BUILD_COMPONENT_ORDER } from '@/lib/pc-build'
import { getPowerEndpoints } from '@/lib/power-topology'
import { cn } from '@/lib/utils'
import {
  formatCapacity,
  formatPortSummary,
  formatRamModuleCapacity,
  PORT_ROLE_LABELS,
} from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import {
  connectionEndpointAvailable,
  endpointKey,
  getConnectionPort,
  portsCompatible,
} from '@/lib/project'
import {
  PATCH_PANEL_ROW_ORDER_PROPERTY,
  getPatchPanelRowOrderValue,
  getSwappedPatchPanelRowOrderValue,
} from '@/lib/patch-panel'
import {
  getItemNetworkTraces,
  getPatchPanelNetworkTraces,
  traceNetworkPath,
  type NetworkTrace,
} from '@/lib/network-trace'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  ConnectionRouteSide,
  ComponentType,
  InventoryConnection,
  InventoryItem,
  InventoryPort,
  InventoryPortRole,
  InventoryPortType,
  InventoryProperties,
  ProjectState,
} from '@/types/inventory'
import type { AgentServerStatus, AgentState, AgentStatusSummary } from '@/types/agent'

const NETWORK_INTERFACE_PORT_TYPES = new Set<InventoryPortType>(['rj45', 'sfp', 'sfp-plus'])
const PORT_TYPE_OPTIONS: InventoryPortType[] = [
  'rj45',
  'sfp',
  'sfp-plus',
  'hdmi',
  'displayport',
  'mini-displayport',
  'barrel',
]
const EMPTY_SELECT_VALUE = '__empty__'
const PORT_ROLE_NONE_VALUE = '__none__'
const SWITCH_PORT_ROLE_OPTIONS: InventoryPortRole[] = [
  'access',
  'trunk',
  'uplink',
  'management',
  'disabled',
]
const CONNECTION_ROUTE_SIDE_OPTIONS: ConnectionRouteSide[] = ['auto', 'top', 'right', 'bottom', 'left']

const inspectorSurfaceClass = 'border-[#e3d7c8] bg-[#fffdf8] shadow-[0_16px_34px_rgba(60,52,43,0.08)]'
const inspectorPanelClass = 'border-[#e5dccf] bg-white/88 shadow-[0_10px_28px_rgba(60,52,43,0.06)]'
const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'
const formLabelClass = 'grid gap-1.5 text-sm font-semibold text-[#20242c]'

function itemTypeLabel(type: InventoryItem['type']): string {
  const labels: Partial<Record<InventoryItem['type'], string>> = {
    cpu: 'CPU',
    cpuCooler: 'CPU Cooler',
    case: 'Case',
    gpu: 'GPU',
    motherboard: 'Motherboard',
    monitor: 'Monitor',
    nas: 'NAS',
    network: 'Network Card',
    patchPanel: 'Patch Panel',
    pcBuild: 'PC Build',
    powerAdapter: 'Power Adapter',
    powerStrip: 'Power Strip',
    powerSupply: 'Power Supply',
    ram: 'RAM',
    server: 'Server',
    soundCard: 'Sound Card',
    storage: 'Storage',
    switch: 'Switch',
    ups: 'UPS',
    wireless: 'Wireless Card',
  }

  return labels[type] ?? type
}

function InspectorSection({
  title,
  icon: Icon,
  badge,
  children,
  className,
}: {
  title: string
  icon?: LucideIcon
  badge?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn(inspectorPanelClass, 'gap-3 overflow-visible rounded-lg py-3', className)} size="sm">
      <CardHeader className="grid-cols-[1fr_auto] items-center gap-3 px-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-[0.15em] text-[#75695d]">
          {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
          <span className="truncate">{title}</span>
        </CardTitle>
        {badge ? <CardAction>{badge}</CardAction> : null}
      </CardHeader>
      <CardContent className="px-3">{children}</CardContent>
    </Card>
  )
}

function StatusBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  className?: string
}) {
  const toneClass = {
    danger: 'border-[#dfb3a5] bg-[#fff4ee] text-[#7a2c1d]',
    info: 'border-[#b8d4dc] bg-[#d7eef2] text-[#102f36]',
    neutral: 'border-[#e5dccf] bg-[#f3f0ea] text-[#75695d]',
    success: 'border-[#a7d8cd] bg-[#d3eee7] text-[#143733]',
    warning: 'border-[#e8d392] bg-[#fff2c7] text-[#3d2a08]',
  }[tone]

  return (
    <Badge
      variant="outline"
      className={cn('h-6 rounded-md px-2 text-[10px] font-black uppercase tracking-[0.08em]', toneClass, className)}
    >
      {children}
    </Badge>
  )
}

type InspectorTab = {
  value: string
  label: string
  content: ReactNode
}

function InspectorTabs({
  tabs,
  defaultValue,
  status,
}: {
  tabs: InspectorTab[]
  defaultValue?: string
  status?: ReactNode
}) {
  if (tabs.length === 0) {
    return null
  }

  return (
    <Tabs defaultValue={defaultValue ?? tabs[0].value} className="min-w-0 gap-4">
      <TabsList
        variant="line"
        className="sticky top-[-1.25rem] z-10 flex !h-auto w-full justify-start gap-2 overflow-x-auto overflow-y-hidden border-b border-[#e5dccf] bg-[#fbf7ef]/95 px-0 py-1 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="!h-9 flex-none rounded-none px-2 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d] data-active:text-[#20242c]"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {status}
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} forceMount className="m-0 min-w-0 space-y-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

function itemFromEditorValues(item: InventoryItem, values: InventoryFormValues): InventoryItem {
  try {
    const input = inventoryFormValuesToInput(values)

    return {
      ...item,
      ...input,
      subtype: input.subtype,
      manufacturer: input.manufacturer,
      secondaryManufacturer: input.secondaryManufacturer,
      family: input.family,
      model: input.model,
      number: input.number,
      specs: input.specs,
      properties: input.properties,
      ports: input.ports,
      notes: input.notes,
    }
  } catch {
    return item
  }
}

function itemInputWithPorts(item: InventoryItem, ports: InventoryPort[]): InventoryItemInput {
  return inventoryFormValuesToInput({
    ...inventoryItemToFormValues(item),
    ...inventoryPortsToFormPatch(ports),
  })
}

function formatBytes(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'Unknown'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)}${units[unitIndex]}`
}

function formatRelativeAge(ageMs: number | null | undefined): string {
  if (typeof ageMs !== 'number') {
    return 'Never'
  }

  if (ageMs < 60_000) {
    return `${Math.max(1, Math.round(ageMs / 1000))}s ago`
  }

  if (ageMs < 3_600_000) {
    return `${Math.round(ageMs / 60_000)}m ago`
  }

  return `${Math.round(ageMs / 3_600_000)}h ago`
}

function agentStateTone(state: AgentState): string {
  if (state === 'online') {
    return 'bg-[#d3eee7] text-[#143733]'
  }

  if (state === 'stale') {
    return 'bg-[#fff2c7] text-[#3d2a08]'
  }

  if (state === 'offline') {
    return 'bg-[#fff4ee] text-[#7a2c1d]'
  }

  if (state === 'unknown') {
    return 'bg-[#d7eef2] text-[#102f36]'
  }

  return 'bg-[#f3f0ea] text-[#75695d]'
}

function getServerAgentStatus(
  summary: AgentStatusSummary | null,
  serverId: string,
): AgentServerStatus {
  const existing = summary?.servers[serverId]

  if (existing) {
    return existing
  }

  if (summary?.registeredServerIds.includes(serverId)) {
    return {
      serverId,
      state: 'unknown',
      connected: true,
      ageMs: null,
    }
  }

  return {
    serverId,
    state: 'unregistered',
    connected: false,
    ageMs: null,
  }
}

function formatPortTypeLabel(type: InventoryPortType): string {
  if (type === 'sfp-plus') {
    return 'SFP+'
  }

  if (type === 'displayport') {
    return 'DP'
  }

  if (type === 'mini-displayport') {
    return 'MiniDP'
  }

  return type.toUpperCase()
}

function updatePort(
  ports: InventoryPort[],
  portId: string | number,
  patch: Partial<Pick<InventoryPort, 'ipAddress' | 'label' | 'notes' | 'role' | 'type'>>,
): InventoryPort[] {
  return ports.map((port) =>
    String(port.id) === String(portId)
      ? Object.fromEntries(
          Object.entries({
            ...port,
            ...patch,
          }).filter(([, value]) => value !== '' && value !== undefined),
        ) as InventoryPort
      : port,
  )
}

type ConnectionState = 'open' | 'partial' | 'connected' | 'conflict'

function getEndpointConnections(project: ProjectState, endpoint: ConnectionEndpoint): InventoryConnection[] {
  const key = endpointKey(endpoint)

  return (project.connections ?? []).filter(
    (connection) => endpointKey(connection.from) === key || endpointKey(connection.to) === key,
  )
}

function getEndpointConnectionState(project: ProjectState, endpoint: ConnectionEndpoint): ConnectionState {
  const connections = getEndpointConnections(project, endpoint)

  if (connections.length > 1) {
    return 'conflict'
  }

  return connections.length === 0 ? 'open' : 'connected'
}

function getPortConnectionState(
  project: ProjectState,
  item: InventoryItem,
  port: InventoryPort,
): ConnectionState {
  const itemRuntimeKey = runtimeItemKey(item)

  if (port.endpoints && port.endpoints.length > 0) {
    const endpointStates = port.endpoints.map((endpoint) =>
      getEndpointConnectionState(project, {
          itemId: itemRuntimeKey,
          portId: port.id,
          endpointId: endpoint.id,
        }),
    )

    if (endpointStates.includes('conflict')) {
      return 'conflict'
    }

    const connectedCount = endpointStates.filter((state) => state === 'connected').length

    if (connectedCount === 0) {
      return 'open'
    }

    return connectedCount === port.endpoints.length ? 'connected' : 'partial'
  }

  return getEndpointConnectionState(project, { itemId: itemRuntimeKey, portId: port.id })
}

function connectionStateTone(state: ConnectionState): string {
  if (state === 'conflict') {
    return 'border-[#dfb3a5] bg-[#fff4ee] text-[#7a2c1d]'
  }

  if (state === 'connected') {
    return 'border-[#a7d8cd] bg-[#d3eee7] text-[#143733]'
  }

  if (state === 'partial') {
    return 'border-[#e8d392] bg-[#fff2c7] text-[#3d2a08]'
  }

  return 'border-[#e5dccf] bg-[#f3f0ea] text-[#75695d]'
}

function connectionStateLabel(state: ConnectionState): string {
  if (state === 'conflict') {
    return 'Conflict'
  }

  if (state === 'connected') {
    return 'Connected'
  }

  if (state === 'partial') {
    return 'Partial'
  }

  return 'Open'
}

function getOppositeEndpoint(connection: InventoryConnection, endpoint: ConnectionEndpoint): ConnectionEndpoint {
  return endpointKey(connection.from) === endpointKey(endpoint) ? connection.to : connection.from
}

function describeConnectedEndpoint(project: ProjectState, endpoint: ConnectionEndpoint): string {
  const connections = getEndpointConnections(project, endpoint)

  if (connections.length === 0) {
    return 'Open'
  }

  if (connections.length > 1) {
    return `${connections.length} connections`
  }

  return describeConnectionEndpoint(project, getOppositeEndpoint(connections[0], endpoint))
}

function endpointIsCompatible(
  project: ProjectState,
  pendingEndpoint: ConnectionEndpoint | null,
  endpoint: ConnectionEndpoint,
): boolean {
  if (!pendingEndpoint || endpointKey(pendingEndpoint) === endpointKey(endpoint)) {
    return true
  }

  const pendingPort = getConnectionPort(project, pendingEndpoint)
  const port = getConnectionPort(project, endpoint)

  return Boolean(pendingPort && port && portsCompatible(pendingPort.type, port.type))
}

function EndpointConnectButton({
  project,
  endpoint,
  label,
  pendingEndpoint,
  onConnect,
}: {
  project: ProjectState
  endpoint: ConnectionEndpoint
  label: string
  pendingEndpoint: ConnectionEndpoint | null
  onConnect: (endpoint: ConnectionEndpoint) => void
}) {
  const state = getEndpointConnectionState(project, endpoint)
  const selected = pendingEndpoint ? endpointKey(pendingEndpoint) === endpointKey(endpoint) : false
  const compatible = endpointIsCompatible(project, pendingEndpoint, endpoint)
  const disabled = state !== 'open' || !compatible

  return (
    <Button
      type="button"
      variant={selected ? 'default' : 'outline'}
      size="sm"
      className={`h-8 gap-1 px-2 text-[11px] ${selected ? '' : 'bg-white'}`}
      disabled={disabled && !selected}
      aria-label={selected ? `Cancel ${label}` : `Connect ${label}`}
      onClick={() => onConnect(endpoint)}
    >
      <Cable className="size-3" />
      {selected ? 'Cancel' : compatible ? 'Connect' : 'Invalid'}
    </Button>
  )
}

function portChipClass(state: ConnectionState): string {
  if (state === 'connected') {
    return 'border-[#a7d8cd] bg-[#d3eee7] text-[#143733]'
  }

  if (state === 'partial') {
    return 'border-[#e8d392] bg-[#fff2c7] text-[#3d2a08]'
  }

  if (state === 'conflict') {
    return 'border-[#dfb3a5] bg-[#fff4ee] text-[#7a2c1d]'
  }

  return 'border-[#e5dccf] bg-[#f3f0ea] text-[#3c342b]'
}

function PortDetailPanel({
  project,
  item,
  port,
  pendingEndpoint,
  onUpdate,
  onEndpointConnect,
}: {
  project: ProjectState
  item: InventoryItem
  port: InventoryPort
  pendingEndpoint: ConnectionEndpoint | null
  onUpdate: (ports: InventoryPort[]) => void
  onEndpointConnect: (endpoint: ConnectionEndpoint) => void
}) {
  const ports = item.ports ?? []
  const itemRuntimeKey = runtimeItemKey(item)
  const canEditType = item.type === 'patchPanel'
  const canEditRole = item.type === 'switch'
  const portState = getPortConnectionState(project, item, port)
  const normalEndpoint = { itemId: itemRuntimeKey, portId: port.id }
  const portConnectionSummary = describeConnectedEndpoint(project, normalEndpoint)

  return (
    <div className="grid gap-3 rounded-lg border border-[#e5dccf] bg-[#fffdf8] p-3 shadow-[0_8px_22px_rgba(60,52,43,0.05)]">
      <div className="grid min-w-0 gap-2 sm:grid-cols-[68px_minmax(0,1fr)_auto] sm:items-end">
        <div className="rounded-md bg-[#20242c] px-3 py-2 text-center text-[#fffdf8]">
          <div className="text-[8px] font-black uppercase tracking-[0.12em] opacity-65">
            Port
          </div>
          <div className="font-mono text-xl font-black leading-none">
            {String(port.slotNumber).padStart(2, '0')}
          </div>
        </div>

        <div className="min-w-0">
          <div className={cn(labelClass, 'mb-1 text-[9px]')}>
            Type
          </div>
          {canEditType ? (
            <Select
              value={port.type}
              onValueChange={(value) => {
                onUpdate(updatePort(ports, port.id, { type: value as InventoryPortType }))
              }}
            >
              <SelectTrigger className="h-9 w-full min-w-0 px-2 text-sm" aria-label={`Port ${port.slotNumber} type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PORT_TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {formatPortTypeLabel(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="truncate rounded-md bg-[#f3f0ea] px-3 py-2 text-sm font-black text-[#3c342b]">
              {port.speed ? `${formatPortTypeLabel(port.type)} ${port.speed}` : formatPortTypeLabel(port.type)}
              {port.poe ? ' PoE' : ''}
            </div>
          )}
        </div>

        <div>
          <div className={cn(labelClass, 'mb-1 text-left text-[9px] sm:text-right')}>
            Status
          </div>
          <span
            className={`inline-flex h-9 items-center rounded-md border px-3 text-[10px] font-black uppercase tracking-[0.06em] ${connectionStateTone(portState)}`}
          >
            {connectionStateLabel(portState)}
          </span>
        </div>
      </div>

      <label className={formLabelClass}>
        Custom label
        <Input
          value={port.label ?? ''}
          placeholder="Custom label"
          aria-label={`Port ${port.slotNumber} label`}
          onChange={(event) => {
            onUpdate(updatePort(ports, port.id, { label: event.target.value }))
          }}
        />
      </label>

      {port.endpoints && port.endpoints.length > 0 ? (
        <div className="grid gap-2">
          {port.endpoints.map((endpoint) => {
            const connectionEndpoint = {
              itemId: itemRuntimeKey,
              portId: port.id,
              endpointId: endpoint.id,
            }
            const endpointState = getEndpointConnectionState(project, connectionEndpoint)
            const endpointLabel = `${String(port.slotNumber).padStart(2, '0')} ${endpoint.side}`
            const connectedTo = describeConnectedEndpoint(project, connectionEndpoint)

            return (
              <div key={endpoint.id} className="grid min-w-0 gap-2 rounded-md bg-[#f8f3eb] p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-[#75695d]">
                      {endpoint.side}
                    </span>
                    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-black ${connectionStateTone(endpointState)}`}>
                      {connectionStateLabel(endpointState)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] font-medium text-[#75695d]">
                    {connectedTo}
                  </div>
                </div>
                <EndpointConnectButton
                  project={project}
                  endpoint={connectionEndpoint}
                  label={endpointLabel}
                  pendingEndpoint={pendingEndpoint}
                  onConnect={onEndpointConnect}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid min-w-0 gap-2 rounded-md bg-[#f8f3eb] p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0 truncate text-sm font-medium text-[#75695d]">
            {portConnectionSummary}
          </div>
          <EndpointConnectButton
            project={project}
            endpoint={normalEndpoint}
            label={port.label || `Port ${port.slotNumber}`}
            pendingEndpoint={pendingEndpoint}
            onConnect={onEndpointConnect}
          />
        </div>
      )}

      <label className={formLabelClass}>
        Port notes
        <Input
          value={port.notes ?? ''}
          placeholder="Port notes"
          aria-label={`Port ${port.slotNumber} notes`}
          onChange={(event) => {
            onUpdate(updatePort(ports, port.id, { notes: event.target.value }))
          }}
        />
      </label>

      {canEditRole ? (
        <label className={formLabelClass}>
          Role
          <Select
            value={port.role ?? PORT_ROLE_NONE_VALUE}
            onValueChange={(value) => {
              onUpdate(
                updatePort(ports, port.id, {
                  role: value === PORT_ROLE_NONE_VALUE
                    ? undefined
                    : value as InventoryPortRole,
                }),
              )
            }}
          >
            <SelectTrigger className="w-full" aria-label={`Port ${port.slotNumber} role`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PORT_ROLE_NONE_VALUE}>No role</SelectItem>
              {SWITCH_PORT_ROLE_OPTIONS.map((role) => (
                <SelectItem key={role} value={role}>
                  {PORT_ROLE_LABELS[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}
    </div>
  )
}

function PortTabsEditor({
  project,
  item,
  pendingEndpoint,
  onUpdate,
  onEndpointConnect,
}: {
  project: ProjectState
  item: InventoryItem
  pendingEndpoint: ConnectionEndpoint | null
  onUpdate: (ports: InventoryPort[]) => void
  onEndpointConnect: (endpoint: ConnectionEndpoint) => void
}) {
  const ports = useMemo(
    () => (item.ports ?? []).slice().sort((first, second) => first.slotNumber - second.slotNumber),
    [item.ports],
  )
  const [selectedPortKey, setSelectedPortKey] = useState(() => ports[0] ? String(ports[0].id) : '')
  const selectedPort = ports.find((port) => String(port.id) === selectedPortKey) ?? ports[0] ?? null

  useEffect(() => {
    if (ports.length === 0) {
      setSelectedPortKey('')
      return
    }

    if (!ports.some((port) => String(port.id) === selectedPortKey)) {
      setSelectedPortKey(String(ports[0].id))
    }
  }, [ports, selectedPortKey])

  if (ports.length === 0) {
    return (
      <InspectorSection title="Port occupancy" icon={PlugZap}>
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-3 text-sm font-medium text-[#75695d]">
          No ports recorded.
        </div>
      </InspectorSection>
    )
  }

  return (
    <InspectorSection
      title="Port occupancy"
      icon={PlugZap}
      badge={<StatusBadge>{ports.length} ports</StatusBadge>}
    >
      <Tabs value={selectedPort ? String(selectedPort.id) : ''} onValueChange={setSelectedPortKey} className="gap-4 overflow-visible">
        <TabsList className="flex !h-auto w-full flex-wrap items-stretch justify-start gap-2 overflow-visible bg-transparent p-0 pb-1">
          {ports.map((port) => {
            const state = getPortConnectionState(project, item, port)

            return (
              <TabsTrigger
                key={port.id}
                value={String(port.id)}
                className={cn(
                  '!h-auto flex-none rounded-md border px-2.5 py-1.5 text-[#20242c] shadow-none data-active:ring-2 data-active:ring-[#ddb668]',
                  portChipClass(state),
                )}
              >
                <span className="grid leading-none">
                  <span className="text-[9px] font-black uppercase tracking-[0.06em] opacity-70">
                    {formatPortTypeLabel(port.type)}
                  </span>
                  <span className="mt-1 font-mono text-base font-black">
                    {String(port.slotNumber).padStart(2, '0')}
                  </span>
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {selectedPort ? (
          <TabsContent value={String(selectedPort.id)} className="m-0">
            <PortDetailPanel
              project={project}
              item={item}
              port={selectedPort}
              pendingEndpoint={pendingEndpoint}
              onUpdate={onUpdate}
              onEndpointConnect={onEndpointConnect}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </InspectorSection>
  )
}

function PatchPanelLabelGrid({
  item,
  onUpdate,
}: {
  item: InventoryItem
  onUpdate: (ports: InventoryPort[]) => void
}) {
  const ports = item.ports ?? []

  if (item.type !== 'patchPanel' || ports.length === 0) {
    return null
  }

  return (
    <InspectorSection
      title="Keystone Labels"
      icon={PlugZap}
      badge={<StatusBadge>{ports.length}</StatusBadge>}
    >
      <div className="grid grid-cols-2 gap-2">
        {ports
          .slice()
          .sort((first, second) => first.slotNumber - second.slotNumber)
          .map((port) => (
            <label
              key={port.id}
              className="grid grid-cols-[2rem_1fr] items-center gap-1.5 rounded-md border border-[#e5dccf] bg-[#fffdf8] p-1.5 text-xs font-bold text-[#75695d]"
            >
              <span className="text-center text-[11px] text-[#20242c]">
                {String(port.slotNumber).padStart(2, '0')}
              </span>
              <Input
                value={port.label ?? ''}
                placeholder="Label"
                className="h-7 text-xs"
                aria-label={`Keystone ${port.slotNumber} label`}
                onChange={(event) => {
                  onUpdate(updatePort(ports, port.id, { label: event.target.value }))
                }}
              />
            </label>
          ))}
      </div>
    </InspectorSection>
  )
}

function PatchPanelRowDisplayControls({
  item,
  onUpdateProperties,
}: {
  item: InventoryItem
  onUpdateProperties: (properties: InventoryProperties) => void
}) {
  if (item.type !== 'patchPanel') {
    return null
  }

  const rowOrder = getPatchPanelRowOrderValue(item)
  const currentOrder = rowOrder === 'front-back'
    ? 'Front row on top, back row on bottom'
    : 'Back row on top, front row on bottom'

  return (
    <InspectorSection
      title="Row Display"
      icon={ArrowUpDown}
      badge={<StatusBadge>{rowOrder === 'front-back' ? 'Front top' : 'Back top'}</StatusBadge>}
    >
      <div className="grid gap-3">
        <div className="rounded-md border border-[#eee6db] bg-[#f8f3eb] p-3">
          <div className={cn(labelClass, 'text-[9px]')}>Current layout</div>
          <div className="mt-1 text-sm font-black text-[#20242c]">{currentOrder}</div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 justify-center gap-2"
          onClick={() => {
            onUpdateProperties({
              [PATCH_PANEL_ROW_ORDER_PROPERTY]: getSwappedPatchPanelRowOrderValue(item),
            })
          }}
        >
          <ArrowUpDown className="size-4" />
          Swap Rows
        </Button>
      </div>
    </InspectorSection>
  )
}

function ConnectionEditor({
  project,
  item,
  onCreate,
  onUpdateLabel,
  onRemove,
}: {
  project: ProjectState
  item: InventoryItem
  onCreate: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onUpdateLabel: (connectionId: string | number, label: string) => void
  onRemove: (connectionId: string | number) => void
}) {
  const selectedEndpointGroup = useMemo(
    () => getEndpointGroupForHost(project, item),
    [item, project],
  )
  const selectedEndpointOptions = useMemo(
    () => selectedEndpointGroup?.options ?? [],
    [selectedEndpointGroup],
  )
  const availableFromOptions = useMemo(
    () =>
      selectedEndpointOptions.filter((option) =>
        connectionEndpointAvailable(project, option.endpoint),
      ),
    [project, selectedEndpointOptions],
  )
  const relatedConnections = useMemo(
    () =>
      (project.connections ?? []).filter(
        (connection) =>
          connection.from.itemId === runtimeItemKey(item) ||
          connection.to.itemId === runtimeItemKey(item),
      ),
    [item, project.connections],
  )
  const [fromKey, setFromKey] = useState(EMPTY_SELECT_VALUE)
  const [destinationItemId, setDestinationItemId] = useState(EMPTY_SELECT_VALUE)
  const [toKey, setToKey] = useState(EMPTY_SELECT_VALUE)

  const selectedFrom = availableFromOptions.find((option) => option.key === fromKey) ?? null
  const destinationGroups = useMemo(
    () => selectedFrom ? getCompatibleDestinationGroups(project, selectedFrom) : [],
    [project, selectedFrom],
  )
  const destinationGroup = destinationGroups.find((group) => group.key === destinationItemId) ?? null
  const destinationEndpointOptions = useMemo(
    () => destinationGroup?.options ?? [],
    [destinationGroup],
  )
  const selectedTo = destinationEndpointOptions.find((option) => option.key === toKey) ?? null

  useEffect(() => {
    setFromKey((current) =>
      availableFromOptions.some((option) => option.key === current)
        ? current
        : availableFromOptions[0]?.key ?? EMPTY_SELECT_VALUE,
    )
  }, [availableFromOptions])

  useEffect(() => {
    setDestinationItemId((current) =>
      destinationGroups.some((group) => group.key === current)
        ? current
        : destinationGroups[0]?.key ?? EMPTY_SELECT_VALUE,
    )
  }, [destinationGroups])

  useEffect(() => {
    setToKey((current) =>
      destinationEndpointOptions.some((option) => option.key === current)
        ? current
        : destinationEndpointOptions[0]?.key ?? EMPTY_SELECT_VALUE,
    )
  }, [destinationEndpointOptions])

  if (selectedEndpointOptions.length === 0) {
    return null
  }

  return (
    <InspectorSection
      title="Connections"
      icon={Cable}
      badge={relatedConnections.length > 0 ? <StatusBadge tone="success">{relatedConnections.length}</StatusBadge> : undefined}
    >

      {relatedConnections.length > 0 ? (
        <div className="mb-3 space-y-2">
          {relatedConnections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              project={project}
              onUpdateLabel={onUpdateLabel}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : null}

      {availableFromOptions.length > 0 && destinationGroups.length > 0 ? (
        <div className="grid min-w-0 gap-2 rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
          <Select value={fromKey} onValueChange={setFromKey}>
            <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-xs" aria-label="Source port">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[min(520px,calc(100vw-2rem))]">
              {availableFromOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  <span className="block max-w-[460px] truncate">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={destinationItemId} onValueChange={setDestinationItemId}>
            <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-xs" aria-label="Destination item">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[min(520px,calc(100vw-2rem))]">
              {destinationGroups.map((group) => (
                <SelectItem key={group.key} value={group.key}>
                  <span className="block max-w-[460px] truncate">{group.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={toKey === EMPTY_SELECT_VALUE ? '' : toKey}
            onValueChange={setToKey}
            disabled={destinationEndpointOptions.length === 0}
          >
            <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-xs" aria-label="Destination port">
              <SelectValue placeholder="No compatible open port" />
            </SelectTrigger>
            <SelectContent className="max-w-[min(520px,calc(100vw-2rem))]">
              {destinationEndpointOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  <span className="block max-w-[460px] truncate">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            className="h-9 w-full"
            disabled={!selectedFrom || !selectedTo}
            onClick={() => {
              if (selectedFrom && selectedTo) {
                onCreate(selectedFrom.endpoint, selectedTo.endpoint)
              }
            }}
          >
            Connect
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-3 text-xs text-[#75695d]">
          No open ports available.
        </div>
      )}
    </InspectorSection>
  )
}

function ConnectionRow({
  connection,
  project,
  onUpdateLabel,
  onRemove,
}: {
  connection: InventoryConnection
  project: ProjectState
  onUpdateLabel: (connectionId: string | number, label: string) => void
  onRemove: (connectionId: string | number) => void
}) {
  const appearance = getCableAppearance(project, connection)

  return (
    <div className="rounded-md border border-[#e5dccf] bg-white p-2.5 text-xs shadow-[0_4px_14px_rgba(60,52,43,0.04)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em]"
          style={{ backgroundColor: appearance.color, color: '#fffdf8' }}
        >
          {appearance.label}
        </span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[#75695d]">
          {connection.type}
        </span>
      </div>
      <label className="mb-2 grid gap-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#75695d]">
        Label
        <Input
          value={connection.label ?? ''}
          placeholder="Cable label"
          className="h-8 text-xs normal-case tracking-normal"
          onChange={(event) => onUpdateLabel(connection.id, event.target.value)}
        />
      </label>
      <div className="space-y-1 text-[#5f554b]">
        <div className="rounded-md bg-[#f8f3eb] p-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#75695d]">From</div>
          <div className="mt-0.5 font-semibold text-[#20242c]">
            {describeConnectionEndpoint(project, connection.from)}
          </div>
        </div>
        <div className="rounded-md bg-[#f8f3eb] p-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#75695d]">To</div>
          <div className="mt-0.5 font-semibold text-[#20242c]">
            {describeConnectionEndpoint(project, connection.to)}
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onRemove(connection.id)}
        >
          Remove
        </Button>
      </div>
    </div>
  )
}

function ConnectionDetails({
  project,
  connection,
  onUpdateLabel,
  onUpdateRoute,
  onRemove,
}: {
  project: ProjectState
  connection: InventoryConnection
  onUpdateLabel: (connectionId: string | number, label: string) => void
  onUpdateRoute: (connectionId: string | number, route: ConnectionRoutePreferences) => void
  onRemove: (connectionId: string | number) => void
}) {
  const appearance = getCableAppearance(project, connection)
  const route = connection.route ?? {}

  function updateRoute(nextRoute: ConnectionRoutePreferences) {
    onUpdateRoute(connection.id, nextRoute)
  }

  function updateRouteSide(key: 'sourceSide' | 'targetSide', side: ConnectionRouteSide) {
    updateRoute({
      ...route,
      [key]: side === 'auto' ? undefined : side,
    })
  }

  function clearBendPoints() {
    updateRoute({
      ...route,
      bendPoints: undefined,
    })
  }

  return (
    <Card className={cn(inspectorSurfaceClass, 'overflow-visible rounded-lg')} size="sm">
      <CardHeader className="grid-cols-[1fr_auto] items-start gap-3">
        <div className="min-w-0">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base font-black text-[#20242c]">
            <Cable className="size-4 shrink-0 text-[#75695d]" />
            <span className="truncate">{connection.label?.trim() || 'Cable'}</span>
          </CardTitle>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#75695d]">
            {connection.type}
          </div>
        </div>
        <CardAction>
          <span
            className="inline-flex rounded-md border px-2 py-1 text-xs font-black leading-none"
            style={{
              borderColor: appearance.color,
              color: appearance.color,
            }}
          >
            {appearance.label}
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        <label className={formLabelClass}>
          Label
          <Input
            value={connection.label ?? ''}
            placeholder="Cable label"
            onChange={(event) => onUpdateLabel(connection.id, event.target.value)}
          />
        </label>

        <div className="space-y-3">
          <div className="rounded-md bg-[#f8f3eb] p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#75695d]">
              From
            </div>
            <div className="mt-1 text-sm font-semibold leading-snug text-[#20242c]">
              {describeConnectionEndpoint(project, connection.from)}
            </div>
          </div>
          <div className="rounded-md bg-[#f8f3eb] p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#75695d]">
              To
            </div>
            <div className="mt-1 text-sm font-semibold leading-snug text-[#20242c]">
              {describeConnectionEndpoint(project, connection.to)}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
          <div className={labelClass}>
            Route
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={formLabelClass}>
              From side
              <Select
                value={route.sourceSide ?? 'auto'}
                onValueChange={(value) => updateRouteSide('sourceSide', value as ConnectionRouteSide)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTION_ROUTE_SIDE_OPTIONS.map((side) => (
                    <SelectItem key={side} value={side}>
                      {side === 'auto' ? 'Auto' : side[0].toUpperCase() + side.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className={formLabelClass}>
              To side
              <Select
                value={route.targetSide ?? 'auto'}
                onValueChange={(value) => updateRouteSide('targetSide', value as ConnectionRouteSide)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTION_ROUTE_SIDE_OPTIONS.map((side) => (
                    <SelectItem key={side} value={side}>
                      {side === 'auto' ? 'Auto' : side[0].toUpperCase() + side.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-8 w-full text-xs"
            disabled={!route.bendPoints?.length}
            onClick={clearBendPoints}
          >
            Reset Bend Points
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-9 w-full"
          onClick={() => onRemove(connection.id)}
        >
          Remove Cable
        </Button>
      </CardContent>
    </Card>
  )
}

function AuditSection({ warnings }: { warnings: AuditWarning[] }) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <InspectorSection
      title="Audit"
      icon={AlertTriangle}
      badge={<StatusBadge tone="warning">{warnings.length}</StatusBadge>}
    >
      <div className="space-y-2">
        {warnings.map((warning) => (
          <div
            key={warning.id}
            className="flex gap-2 rounded-md border border-[#e8d392] bg-[#fff8df] p-2 text-xs font-semibold leading-snug text-[#5d4814]"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{warning.message}</span>
          </div>
        ))}
      </div>
    </InspectorSection>
  )
}

function NetworkTraceSection({
  project,
  item,
  activeTraceKey,
  onSelectTrace,
}: {
  project: ProjectState
  item: InventoryItem
  activeTraceKey: string | null
  onSelectTrace: (endpoint: ConnectionEndpoint) => void
}) {
  const traces = item.type === 'patchPanel'
    ? getPatchPanelNetworkTraces(project, item)
    : getItemNetworkTraces(project, item)

  if (traces.length === 0) {
    return null
  }

  return (
    <InspectorSection
      title="Network Trace"
      icon={Activity}
      badge={<StatusBadge tone="success">RJ45</StatusBadge>}
    >
      <div className="space-y-2">
        {traces.map((trace) => (
          <NetworkTraceCard
            key={endpointKey(trace.start)}
            trace={trace}
            active={activeTraceKey === endpointKey(trace.start)}
            onSelectTrace={onSelectTrace}
          />
        ))}
      </div>
    </InspectorSection>
  )
}

function NetworkTraceCard({
  trace,
  active,
  onSelectTrace,
}: {
  trace: NetworkTrace
  active: boolean
  onSelectTrace: (endpoint: ConnectionEndpoint) => void
}) {
  return (
    <button
      type="button"
      className={`block w-full rounded-md border bg-[#fffdf8] p-2 text-left text-xs transition ${
        active ? 'border-[#ddb668] ring-2 ring-[#ddb668]/45' : 'border-[#e5dccf] hover:border-[#d6ccbd]'
      }`}
      onClick={() => onSelectTrace(trace.start)}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-black uppercase tracking-[0.08em] text-[#75695d]">
          Path
        </span>
        <span
          className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
            trace.complete ? 'bg-[#d3eee7] text-[#143733]' : 'bg-[#fff2c7] text-[#3d2a08]'
          }`}
        >
          {trace.complete ? 'Complete' : 'Incomplete'}
        </span>
      </div>
      <ol className="space-y-1.5">
        {trace.steps.map((step, index) => (
          <li key={`${endpointKey(step.endpoint)}-${index}`} className="flex gap-2">
            <span
              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black ${
                step.state === 'open'
                  ? 'bg-[#fff2c7] text-[#3d2a08]'
                  : step.state === 'internal'
                    ? 'bg-[#d8ddf4] text-[#1b2448]'
                    : 'bg-[#d3eee7] text-[#143733]'
              }`}
            >
              {index + 1}
            </span>
            <span className="min-w-0 leading-snug text-[#3c342b]">{step.label}</span>
          </li>
        ))}
      </ol>
    </button>
  )
}

function getAgentString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key]

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatAgentPort(port: Record<string, unknown>): { primary: string; secondary: string } {
  const protocol = getAgentString(port, 'protocol')?.toUpperCase() ?? 'PORT'
  const address = getAgentString(port, 'address') ?? '0.0.0.0'
  const rawPort = port.port
  const portValue = typeof rawPort === 'number' || typeof rawPort === 'string' ? rawPort : '?'
  const process = getAgentString(port, 'process') ?? ''

  return {
    primary: `${protocol} ${address}:${portValue}`,
    secondary: process.replace(/\s+/g, ' '),
  }
}

function AgentTelemetryLine({
  primary,
  secondary,
}: {
  primary: string
  secondary?: string | null
}) {
  return (
    <div className="min-w-0 rounded-md bg-[#f7f2eb] px-2 py-1.5">
      <div className="truncate text-xs font-black text-[#20242c]">{primary}</div>
      {secondary ? (
        <div className="truncate text-[11px] font-semibold text-[#75695d]">{secondary}</div>
      ) : null}
    </div>
  )
}

function AgentTelemetrySection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <div className="rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]">
          {title}
        </div>
        {typeof count === 'number' ? (
          <span className="rounded bg-[#f3f0ea] px-1.5 py-0.5 text-[10px] font-black text-[#75695d]">
            {count}
          </span>
        ) : null}
      </div>
      <div className="grid gap-1.5">{children}</div>
    </div>
  )
}

function AgentSetupPanel({
  server,
  status,
  registered,
  hasSavedStatus,
  demoMode,
}: {
  server: InventoryItem
  status: AgentServerStatus
  registered: boolean
  hasSavedStatus: boolean
  demoMode: boolean
}) {
  const queryClient = useQueryClient()
  const [endpoint, setEndpoint] = useState(() => window.location.origin)
  const [copied, setCopied] = useState(false)
  const enrollmentMutation = useMutation({
    mutationFn: () => createAgentEnrollment(server.id, endpoint),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })
  const revokeMutation = useMutation({
    mutationFn: () => revokeAgentRegistration(server.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })
  const clearStatusMutation = useMutation({
    mutationFn: () => clearAgentStatus(server.id),
    onSuccess: (summary) => queryClient.setQueryData(['agent-status'], summary),
  })
  const command = enrollmentMutation.data?.installCommand ?? ''
  const firstDisk = status.disks?.[0]
  const ips = status.network?.flatMap((network) => network.addresses ?? []) ?? []
  const cpuModel = typeof status.cpu?.model === 'string' ? status.cpu.model : null
  const memoryUsed = status.memory?.usedBytes
  const memoryTotal = status.memory?.totalBytes
  const diskUsed = firstDisk?.usedBytes
  const diskTotal = firstDisk?.sizeBytes
  const containers = status.containers ?? []
  const services = status.services ?? []
  const listeningPorts = status.listeningPorts ?? []
  const kubernetesRole = getAgentString(status.kubernetes, 'role')
  const kubernetesVersion = getAgentString(status.kubernetes, 'version')
  const loadAverage = status.loadAverage?.slice(0, 3).map((value) => value.toFixed(2)).join(' / ')

  async function copyCommand() {
    if (!command) {
      return
    }

    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <InspectorSection
      title="Agent"
      icon={Terminal}
      badge={<span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${agentStateTone(status.state)}`}>{status.state}</span>}
    >

      <div className="rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[#75695d]">Last Seen</dt>
            <dd className="font-semibold text-[#20242c]">{formatRelativeAge(status.ageMs)}</dd>
          </div>
          {status.hostname ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">Hostname</dt>
              <dd className="truncate font-semibold text-[#20242c]">{status.hostname}</dd>
            </div>
          ) : null}
          {ips.length > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">IPs</dt>
              <dd className="truncate text-right font-semibold text-[#20242c]">{ips.join(', ')}</dd>
            </div>
          ) : null}
          {cpuModel ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">CPU</dt>
              <dd className="truncate text-right font-semibold text-[#20242c]">{cpuModel}</dd>
            </div>
          ) : null}
          {typeof memoryUsed === 'number' || typeof memoryTotal === 'number' ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">RAM</dt>
              <dd className="font-semibold text-[#20242c]">
                {formatBytes(memoryUsed)} / {formatBytes(memoryTotal)}
              </dd>
            </div>
          ) : null}
          {typeof diskUsed === 'number' || typeof diskTotal === 'number' ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">Disk</dt>
              <dd className="font-semibold text-[#20242c]">
                {formatBytes(diskUsed)} / {formatBytes(diskTotal)}
              </dd>
            </div>
          ) : null}
          {loadAverage ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#75695d]">Load Avg</dt>
              <dd className="font-semibold text-[#20242c]">{loadAverage}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {containers.length > 0 || listeningPorts.length > 0 || services.length > 0 || kubernetesRole ? (
        <div className="mt-3 grid gap-2">
          {containers.length > 0 ? (
            <AgentTelemetrySection title="Containers" count={containers.length}>
              {containers.slice(0, 5).map((container, index) => (
                <AgentTelemetryLine
                  key={`${getAgentString(container, 'id') ?? index}`}
                  primary={getAgentString(container, 'name') ?? getAgentString(container, 'image') ?? 'Container'}
                  secondary={[
                    getAgentString(container, 'image'),
                    getAgentString(container, 'status'),
                    getAgentString(container, 'ports'),
                  ].filter(Boolean).join(' / ')}
                />
              ))}
            </AgentTelemetrySection>
          ) : null}

          {kubernetesRole ? (
            <AgentTelemetrySection title="K3s">
              <AgentTelemetryLine
                primary={kubernetesRole === 'control-plane' ? 'Control plane' : 'Worker'}
                secondary={kubernetesVersion}
              />
            </AgentTelemetrySection>
          ) : null}

          {listeningPorts.length > 0 ? (
            <AgentTelemetrySection title="LAN Listening Ports" count={listeningPorts.length}>
              {listeningPorts.slice(0, 6).map((port, index) => {
                const formatted = formatAgentPort(port)

                return (
                  <AgentTelemetryLine
                    key={`${formatted.primary}-${index}`}
                    primary={formatted.primary}
                    secondary={formatted.secondary}
                  />
                )
              })}
            </AgentTelemetrySection>
          ) : null}

          {services.length > 0 ? (
            <AgentTelemetrySection title="Running Services" count={services.length}>
              {services.slice(0, 6).map((service, index) => (
                <AgentTelemetryLine
                  key={`${getAgentString(service, 'unit') ?? index}`}
                  primary={getAgentString(service, 'unit') ?? 'service'}
                  secondary={getAgentString(service, 'description')}
                />
              ))}
            </AgentTelemetrySection>
          ) : null}
        </div>
      ) : null}

      {demoMode ? (
        <div className="mt-3 rounded-md border border-[#dfc483] bg-[#fff8df] p-3 text-sm font-semibold text-[#5d4814]">
          Agent setup is disabled in public demo mode.
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          <label className={formLabelClass}>
            Agent endpoint
            <Input
              value={endpoint}
              placeholder="http://192.168.1.10:8798"
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            className="justify-start gap-2"
            disabled={enrollmentMutation.isPending || endpoint.trim() === ''}
            onClick={() => enrollmentMutation.mutate()}
          >
            <Terminal data-icon="inline-start" />
            {enrollmentMutation.isPending ? 'Generating...' : 'Setup Agent'}
          </Button>
          {enrollmentMutation.isError ? (
            <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-2 text-xs font-semibold text-[#7a2c1d]">
              {enrollmentMutation.error instanceof Error
                ? enrollmentMutation.error.message
                : 'Agent setup command could not be generated.'}
            </div>
          ) : null}
          {command ? (
            <div className="grid gap-2">
              <textarea
                readOnly
                value={command}
                className="min-h-28 resize-y rounded-md border border-[#d6ccbd] bg-[#20242c] p-2 font-mono text-xs leading-relaxed text-[#fffdf8]"
                aria-label="Agent install command"
              />
              <Button type="button" className="gap-2" onClick={() => void copyCommand()}>
                <Copy data-icon="inline-start" />
                {copied ? 'Copied' : 'Copy Command'}
              </Button>
            </div>
          ) : null}
          {registered || hasSavedStatus ? (
            <div className="mt-2 grid gap-2 border-t border-[#e5dccf] pt-3">
              <div className="text-xs font-semibold leading-relaxed text-[#75695d]">
                Revoke the registration before clearing saved telemetry. These actions also remove agent blockers reported by inventory archive checks.
              </div>
              {registered ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={revokeMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Revoke the agent registration for ${server.name}?`)) {
                      revokeMutation.mutate()
                    }
                  }}
                >
                  {revokeMutation.isPending ? 'Revoking...' : 'Revoke Registration'}
                </Button>
              ) : null}
              {hasSavedStatus ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={registered || clearStatusMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Clear saved agent telemetry for ${server.name}?`)) {
                      clearStatusMutation.mutate()
                    }
                  }}
                >
                  {clearStatusMutation.isPending ? 'Clearing...' : 'Clear Saved Telemetry'}
                </Button>
              ) : null}
              {revokeMutation.isError || clearStatusMutation.isError ? (
                <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-2 text-xs font-semibold text-[#7a2c1d]">
                  {(revokeMutation.error ?? clearStatusMutation.error) instanceof Error
                    ? (revokeMutation.error ?? clearStatusMutation.error)?.message
                    : 'Agent cleanup could not be completed.'}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </InspectorSection>
  )
}

function getSlotItemParts(item: InventoryItem): string[] {
  const specs = item.specs ?? {}

  if (item.type === 'cpu') {
    return [
      item.manufacturer,
      item.family,
      item.number,
      typeof specs.cores === 'number' && typeof specs.threads === 'number'
        ? `${specs.cores}C/${specs.threads}T`
        : null,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  }

  if (item.type === 'ram') {
    const capacity = typeof specs.capacityGb === 'number' ? `${specs.capacityGb}GB` : null
    const module = typeof specs.capacityGb === 'number' ? formatRamModuleCapacity(specs.capacityGb) : null
    const speed = typeof specs.speedMt === 'number' ? `${specs.speedMt}MHz` : null

    return [
      capacity,
      typeof specs.generation === 'string' ? specs.generation : null,
      module,
      speed,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  }

  if (item.type === 'storage') {
    return [
      formatCapacity(specs),
      typeof specs.interface === 'string' ? specs.interface : null,
      typeof specs.formFactor === 'string' ? specs.formFactor : null,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0 && part !== 'Unknown')
  }

  if (item.type === 'gpu' || item.type === 'network') {
    return [
      item.manufacturer,
      item.model,
      formatPortSummary(item),
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  }

  return []
}

function slotTone(type: ComponentType): string {
  const tones: Partial<Record<ComponentType, string>> = {
    cpu: 'border-[#b8d4dc] bg-[#d7eef2]',
    gpu: 'border-[#dfb3a5] bg-[#fff4ee]',
    network: 'border-[#a7d8cd] bg-[#d3eee7]',
    ram: 'border-[#e8d392] bg-[#fff2c7]',
    storage: 'border-[#d6ccbd] bg-[#f3ead8]',
  }

  return tones[type] ?? 'border-[#e5dccf] bg-[#f3f0ea]'
}

function SlotItemCard({ item }: { item: InventoryItem }) {
  const parts = getSlotItemParts(item)

  return (
    <div className="rounded-md border border-white/70 bg-white/75 p-2 shadow-[0_4px_12px_rgba(60,52,43,0.05)]">
      <div className="truncate text-sm font-black text-[#20242c]">{item.name}</div>
      {parts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {parts.map((part) => (
            <span
              key={part}
              className="rounded-md bg-[#fffdf8] px-1.5 py-0.5 text-[10px] font-black text-[#3c342b]"
            >
              {part}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function EquipmentSlotsTab({
  project,
  host,
  title,
  allowedTypes,
}: {
  project: ProjectState
  host: InventoryItem
  title: string
  allowedTypes?: ComponentType[]
}) {
  const hostRuntimeKey = runtimeItemKey(host)
  const assignments = sortAssignmentsForDisplay(project, hostRuntimeKey)
  const slotStatus = getSlotStatus(project, hostRuntimeKey)
    .filter((slot) => !allowedTypes || allowedTypes.includes(slot.type))

  return (
    <InspectorSection
      title={title}
      icon={Layers3}
      badge={<StatusBadge>{slotStatus.length}</StatusBadge>}
    >
      <div className="grid gap-2">
        {slotStatus.map((slot) => {
          const matches = assignments.filter((assignment) => assignment.type === slot.type)

          return (
            <div
              key={slot.type}
              className={cn('grid gap-2 rounded-lg border p-3', slotTone(slot.type))}
            >
              <div className="flex items-center justify-between gap-2">
                <div className={cn(labelClass, 'text-[10px]')}>
                  {SLOT_LABELS[slot.type]}
                </div>
                <StatusBadge tone={matches.length > 0 ? 'success' : 'neutral'}>
                  {slot.limit === null
                    ? `${matches.length} added`
                    : matches.length > 0 ? 'Filled' : 'Open'}
                </StatusBadge>
              </div>
              {matches.length > 0 ? (
                <div className="grid gap-2">
                  {matches.map((assignment) => {
                    const item = project.items[assignment.itemId]

                    return item ? <SlotItemCard key={assignment.id} item={item} /> : null
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-white/80 bg-white/35 p-3 text-sm font-semibold text-[#75695d]">
                  No {SLOT_LABELS[slot.type].toLowerCase()} assigned.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </InspectorSection>
  )
}

type ServerNetworkPortOption = {
  key: string
  endpoint: ConnectionEndpoint
  item: InventoryItem
  itemKey: string
  port: InventoryPort
  sourceLabel: string
}

function getServerNetworkPortOptions(project: ProjectState, server: InventoryItem): ServerNetworkPortOption[] {
  const serverRuntimeKey = runtimeItemKey(server)
  const boardOptions = (server.ports ?? [])
    .filter((port) => NETWORK_INTERFACE_PORT_TYPES.has(port.type) && !port.endpoints)
    .map((port) => {
      const endpoint = { itemId: serverRuntimeKey, portId: port.id }

      return {
        key: endpointKey(endpoint),
        endpoint,
        item: server,
        itemKey: serverRuntimeKey,
        port,
        sourceLabel: 'Board',
      }
    })

  const cardOptions = sortAssignmentsForDisplay(project, serverRuntimeKey)
    .filter((assignment) => assignment.type === 'network')
    .flatMap((assignment) => {
      const item = project.items[assignment.itemId]

      if (!item) {
        return []
      }

      const itemKey = runtimeItemKey(item)

      return (item.ports ?? [])
        .filter((port) => NETWORK_INTERFACE_PORT_TYPES.has(port.type) && !port.endpoints)
        .map((port) => {
          const endpoint = {
            itemId: serverRuntimeKey,
            hostedItemId: itemKey,
            portId: port.id,
          }

          return {
            key: endpointKey(endpoint),
            endpoint,
            item,
            itemKey,
            port,
            sourceLabel: item.name,
          }
        })
    })

  return [...boardOptions, ...cardOptions].sort((first, second) => {
    if (first.sourceLabel !== second.sourceLabel) {
      return first.sourceLabel.localeCompare(second.sourceLabel)
    }

    return first.port.slotNumber - second.port.slotNumber
  })
}

function ServerNetworkTab({
  project,
  server,
  status,
  activeNetworkTraceKey,
  onUpdateServerPorts,
  onUpdateItem,
  onSelectTrace,
}: {
  project: ProjectState
  server: InventoryItem
  status: AgentServerStatus
  activeNetworkTraceKey: string | null
  onUpdateServerPorts: (ports: InventoryPort[]) => void
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onSelectTrace: (endpoint: ConnectionEndpoint) => void
}) {
  const options = useMemo(() => getServerNetworkPortOptions(project, server), [project, server])
  const [selectedKey, setSelectedKey] = useState(() => options[0]?.key ?? '')
  const selected = options.find((option) => option.key === selectedKey) ?? options[0] ?? null
  const trace = selected ? traceNetworkPath(project, selected.endpoint) : null
  const connections = selected ? getEndpointConnections(project, selected.endpoint) : []
  const agentIps = status.network?.flatMap((adapter) => adapter.addresses ?? []) ?? []

  useEffect(() => {
    if (options.length === 0) {
      setSelectedKey('')
      return
    }

    if (!options.some((option) => option.key === selectedKey)) {
      setSelectedKey(options[0].key)
    }
  }, [options, selectedKey])

  if (options.length === 0) {
    return (
      <InspectorSection title="Network Interfaces" icon={Network}>
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-3 text-sm font-medium text-[#75695d]">
          No physical network interfaces recorded.
        </div>
      </InspectorSection>
    )
  }

  return (
    <div className="space-y-4">
      <InspectorSection
        title="Network Interfaces"
        icon={Network}
        badge={<StatusBadge>{options.length} ports</StatusBadge>}
      >
        <Tabs value={selected?.key ?? ''} onValueChange={setSelectedKey} className="gap-4 overflow-visible">
          <TabsList className="flex !h-auto w-full flex-wrap items-stretch justify-start gap-2 overflow-visible bg-transparent p-0 pb-1">
            {options.map((option) => {
              const state = getEndpointConnectionState(project, option.endpoint)

              return (
                <TabsTrigger
                  key={option.key}
                  value={option.key}
                  className={cn(
                    '!h-auto flex-none rounded-md border px-2.5 py-1.5 text-[#20242c] shadow-none data-active:ring-2 data-active:ring-[#ddb668]',
                    portChipClass(state),
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
              )
            })}
          </TabsList>

          {selected ? (
            <TabsContent value={selected.key} className="m-0">
              <div className="grid gap-3 rounded-lg border border-[#e5dccf] bg-[#fffdf8] p-3 shadow-[0_8px_22px_rgba(60,52,43,0.05)]">
                <div className="grid gap-2 sm:grid-cols-[68px_minmax(0,1fr)_auto] sm:items-end">
                  <div className="rounded-md bg-[#20242c] px-3 py-2 text-center text-[#fffdf8]">
                    <div className="text-[8px] font-black uppercase tracking-[0.12em] opacity-65">
                      Port
                    </div>
                    <div className="font-mono text-xl font-black leading-none">
                      {String(selected.port.slotNumber).padStart(2, '0')}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className={cn(labelClass, 'mb-1 text-[9px]')}>Interface</div>
                    <div className="truncate rounded-md bg-[#f3f0ea] px-3 py-2 text-sm font-black text-[#3c342b]">
                      {selected.sourceLabel} / {formatPortTypeLabel(selected.port.type)}
                      {selected.port.speed ? ` ${selected.port.speed}` : ''}
                    </div>
                  </div>
                  <div>
                    <div className={cn(labelClass, 'mb-1 text-left text-[9px] sm:text-right')}>Status</div>
                    <span
                      className={`inline-flex h-9 items-center rounded-md border px-3 text-[10px] font-black uppercase tracking-[0.06em] ${connectionStateTone(getEndpointConnectionState(project, selected.endpoint))}`}
                    >
                      {connectionStateLabel(getEndpointConnectionState(project, selected.endpoint))}
                    </span>
                  </div>
                </div>

                <label className={formLabelClass}>
                  IP address
                  <Input
                    value={selected.port.ipAddress ?? ''}
                    placeholder="192.168.1.10"
                    inputMode="decimal"
                    aria-label={`Port ${selected.port.slotNumber} IP address`}
                    onChange={(event) => {
                      const ports = updatePort(selected.item.ports ?? [], selected.port.id, {
                        ipAddress: event.target.value,
                      })

                      if (selected.itemKey === runtimeItemKey(server)) {
                        onUpdateServerPorts(ports)
                        return
                      }

                      onUpdateItem(selected.itemKey, itemInputWithPorts(selected.item, ports))
                    }}
                  />
                </label>

                <div className="grid gap-2">
                  <div className={labelClass}>Connection</div>
                  {connections.length === 0 ? (
                    <div className="rounded-md bg-[#f8f3eb] p-3 text-sm font-semibold text-[#75695d]">
                      This interface is open.
                    </div>
                  ) : (
                    connections.map((connection) => (
                      <div key={connection.id} className="grid gap-2 rounded-md border border-[#eee6db] bg-[#fbf8f2] p-3">
                        <div>
                          <div className={cn(labelClass, 'text-[9px]')}>From</div>
                          <div className="mt-1 text-sm font-black text-[#20242c]">
                            {describeConnectionEndpoint(project, selected.endpoint)}
                          </div>
                        </div>
                        <div>
                          <div className={cn(labelClass, 'text-[9px]')}>To</div>
                          <div className="mt-1 text-sm font-black text-[#20242c]">
                            {describeConnectionEndpoint(project, getOppositeEndpoint(connection, selected.endpoint))}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </InspectorSection>

      {agentIps.length > 0 ? (
        <InspectorSection title="Agent IPs" icon={Activity}>
          <div className="flex flex-wrap gap-1.5">
            {agentIps.map((ip) => (
              <span key={ip} className="rounded-md bg-[#d7eef2] px-2 py-1 text-[11px] font-black text-[#102f36]">
                {ip}
              </span>
            ))}
          </div>
        </InspectorSection>
      ) : null}

      <InspectorSection
        title="Network Trace"
        icon={Cable}
        badge={selected?.port.type ? <StatusBadge tone="success">{formatPortTypeLabel(selected.port.type)}</StatusBadge> : null}
      >
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
    </div>
  )
}

function ComingSoonSection() {
  return (
    <InspectorSection title="Services" icon={Activity}>
      <div className="rounded-lg border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-5 text-center">
        <div className="text-sm font-black text-[#20242c]">Coming Soon</div>
        <p className="mt-1 text-xs font-medium text-[#75695d]">
          Service discovery and app health will live here.
        </p>
      </div>
    </InspectorSection>
  )
}

function EditableSpecsSection({
  title,
  editor,
  auditWarnings,
  displayName = false,
}: {
  title: string
  editor: ReturnType<typeof useInventoryItemEditor>
  auditWarnings: AuditWarning[]
  displayName?: boolean
}) {
  return (
    <>
      <InspectorSection title={title} icon={Info}>
        <InventorySpecsFormContent
          values={editor.values}
          errors={editor.errors}
          onChange={editor.updateValues}
          includeCompatibility={false}
        />
        {displayName ? (
          <label className={cn(formLabelClass, 'mt-3')}>
            Display name
            <Input
              aria-label="Display name"
              value={editor.values.properties?.displayName ?? ''}
              placeholder="Server name"
              onChange={(event) => editor.updateValues({
                properties: {
                  ...editor.values.properties,
                  displayName: event.target.value,
                },
              })}
            />
          </label>
        ) : null}
      </InspectorSection>
      <AuditSection warnings={auditWarnings} />
    </>
  )
}

function updateEditorPorts(
  editor: ReturnType<typeof useInventoryItemEditor>,
  ports: InventoryPort[],
): void {
  editor.updateValues(inventoryPortsToFormPatch(ports), 'immediate')
}

function ServerInspectorTabs({
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
  auditWarnings: AuditWarning[]
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
  const status = getServerAgentStatus(agentStatus, String(server.id))
  const registered = agentStatus?.registeredServerIds.some((serverId) => String(serverId) === String(server.id)) ?? false
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

function SwitchInspectorTabs({
  project,
  item,
  pendingEndpoint,
  auditWarnings,
  onUpdateItem,
  onCreateConnection,
  onEndpointConnectionClick,
  onUpdateConnectionLabel,
  onRemoveConnection,
}: {
  project: ProjectState
  item: InventoryItem
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: AuditWarning[]
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
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
              title="Switch Details"
              editor={editor}
              auditWarnings={auditWarnings}
            />
          ),
        },
        {
          value: 'ports',
          label: 'Ports',
          content: (
            <>
              <PortGroupsEditor
                type="switch"
                groups={editor.values.portGroups}
                error={editor.errors.portGroups}
                onChange={(portGroups) => editor.updateValues({ portGroups }, 'immediate')}
              />
              <PortTabsEditor
                project={project}
                item={draftItem}
                pendingEndpoint={pendingEndpoint}
                onUpdate={handlePortsUpdate}
                onEndpointConnect={onEndpointConnectionClick}
              />
            </>
          ),
        },
        {
          value: 'connections',
          label: 'Connections',
          content: (
            <ConnectionEditor
              project={project}
              item={draftItem}
              onCreate={onCreateConnection}
              onUpdateLabel={onUpdateConnectionLabel}
              onRemove={onRemoveConnection}
            />
          ),
        },
      ]}
    />
  )
}

function NasAgentSection() {
  return (
    <InspectorSection title="Agent" icon={Terminal}>
      <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-4 text-sm font-semibold text-[#75695d]">
        Agent setup is not available for NAS yet.
      </div>
    </InspectorSection>
  )
}

function NasInspectorTabs({
  project,
  item,
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
}: {
  project: ProjectState
  item: InventoryItem
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: AuditWarning[]
  activeNetworkTraceKey: string | null
  onUpdateProject: (project: ProjectState) => void
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
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
              title="NAS Details"
              editor={editor}
              auditWarnings={auditWarnings}
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
              allowedTypes={['storage', 'network']}
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
                item={draftItem}
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
              project={project}
              item={draftItem}
              activeTraceKey={activeNetworkTraceKey}
              onSelectTrace={onSelectNetworkTrace}
            />
          ),
        },
        {
          value: 'agent',
          label: 'Agent',
          content: <NasAgentSection />,
        },
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
      ]}
    />
  )
}

function PatchPanelInspectorTabs({
  project,
  item,
  pendingEndpoint,
  auditWarnings,
  activeNetworkTraceKey,
  onUpdateItem,
  onCreateConnection,
  onEndpointConnectionClick,
  onSelectNetworkTrace,
  onUpdateConnectionLabel,
  onRemoveConnection,
}: {
  project: ProjectState
  item: InventoryItem
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: AuditWarning[]
  activeNetworkTraceKey: string | null
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
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
              title="Patch Panel Details"
              editor={editor}
              auditWarnings={auditWarnings}
            />
          ),
        },
        {
          value: 'ports',
          label: 'Ports',
          content: (
            <>
              <PatchPanelRowDisplayControls
                item={draftItem}
                onUpdateProperties={(properties) => editor.updateValues({
                  properties: {
                    ...editor.values.properties,
                    ...properties,
                  },
                }, 'immediate')}
              />
              <PatchPanelLabelGrid item={draftItem} onUpdate={handlePortsUpdate} />
              <PortGroupsEditor
                type="patchPanel"
                groups={editor.values.portGroups}
                error={editor.errors.portGroups}
                onChange={(portGroups) => editor.updateValues({ portGroups }, 'immediate')}
              />
              <PortTabsEditor
                project={project}
                item={draftItem}
                pendingEndpoint={pendingEndpoint}
                onUpdate={handlePortsUpdate}
                onEndpointConnect={onEndpointConnectionClick}
              />
            </>
          ),
        },
        {
          value: 'connections',
          label: 'Connections',
          content: (
            <ConnectionEditor
              project={project}
              item={draftItem}
              onCreate={onCreateConnection}
              onUpdateLabel={onUpdateConnectionLabel}
              onRemove={onRemoveConnection}
            />
          ),
        },
        {
          value: 'network',
          label: 'Network',
          content: (
            <NetworkTraceSection
              project={project}
              item={draftItem}
              activeTraceKey={activeNetworkTraceKey}
              onSelectTrace={onSelectNetworkTrace}
            />
          ),
        },
      ]}
    />
  )
}

function isEditableComponent(item: InventoryItem): item is InventoryItem & { type: ComponentType } {
  return [
    'cpu',
    'ram',
    'storage',
    'gpu',
    'network',
    'motherboard',
    'cpuCooler',
    'case',
    'powerSupply',
    'soundCard',
    'wireless',
    'powerAdapter',
  ].includes(item.type)
}

const LEGACY_COMPONENT_INSPECTOR_TYPES = new Set<ComponentType>([
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
])

type HostedPortOption = {
  key: string
  endpoint: ConnectionEndpoint
  item: InventoryItem
  itemKey: string
  port: InventoryPort
  sourceLabel: string
}

function getPcBuildPortOptions(
  project: ProjectState,
  host: InventoryItem,
  networkOnly = false,
): HostedPortOption[] {
  const hostKey = runtimeItemKey(host)
  const portedTypes = new Set<ComponentType>([
    'motherboard',
    'gpu',
    'network',
    'soundCard',
    'wireless',
  ])

  return sortAssignmentsForDisplay(project, hostKey)
    .filter((assignment) => portedTypes.has(assignment.type))
    .flatMap((assignment) => {
      const item = project.items[assignment.itemId]
      if (!item) return []

      const itemKey = runtimeItemKey(item)
      return (item.ports ?? [])
        .filter((port) => !port.endpoints && (!networkOnly || NETWORK_INTERFACE_PORT_TYPES.has(port.type)))
        .map((port) => {
          const endpoint = {
            itemId: hostKey,
            hostedItemId: itemKey,
            portId: port.id,
          }

          return {
            key: endpointKey(endpoint),
            endpoint,
            item,
            itemKey,
            port,
            sourceLabel: assignment.type === 'motherboard' ? 'Motherboard' : item.name,
          }
        })
    })
}

function HostedPortsTab({
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
  const options = useMemo(
    () => getPcBuildPortOptions(project, host, networkOnly),
    [host, networkOnly, project],
  )
  const [selectedKey, setSelectedKey] = useState(() => options[0]?.key ?? '')
  const selected = options.find((option) => option.key === selectedKey) ?? options[0] ?? null
  const connections = selected ? getEndpointConnections(project, selected.endpoint) : []
  const trace = networkOnly && selected ? traceNetworkPath(project, selected.endpoint) : null

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

function PcBuildSlotsTab({ project, host }: { project: ProjectState; host: InventoryItem }) {
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

function PowerEndpointsTab({
  project,
  item,
  onUpdateConnectionLabel,
  onRemoveConnection,
}: {
  project: ProjectState
  item: InventoryItem
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const itemKey = runtimeItemKey(item)
  const endpoints = getPowerEndpoints(project).filter((candidate) => candidate.endpoint.itemId === itemKey)
  const [selectedKey, setSelectedKey] = useState(() => endpoints[0] ? endpointKey(endpoints[0].endpoint) : '')
  const selected = endpoints.find((candidate) => endpointKey(candidate.endpoint) === selectedKey) ?? endpoints[0] ?? null
  const connections = selected ? getEndpointConnections(project, selected.endpoint) : []

  useEffect(() => {
    if (endpoints.length === 0) setSelectedKey('')
    else if (!endpoints.some((candidate) => endpointKey(candidate.endpoint) === selectedKey)) {
      setSelectedKey(endpointKey(endpoints[0].endpoint))
    }
  }, [endpoints, selectedKey])

  return (
    <InspectorSection
      title={item.type === 'ups' || item.type === 'powerStrip' ? 'Outlets' : 'Power'}
      icon={PlugZap}
      badge={<StatusBadge>{endpoints.length}</StatusBadge>}
    >
      {endpoints.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-3 text-sm font-medium text-[#75695d]">
          No power endpoint is available. Assign the required power component first.
        </div>
      ) : (
        <Tabs value={selected ? endpointKey(selected.endpoint) : ''} onValueChange={setSelectedKey} className="gap-4">
          <TabsList className="flex !h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
            {endpoints.map((candidate, index) => {
              const key = endpointKey(candidate.endpoint)
              return (
                <TabsTrigger key={key} value={key} className="!h-auto rounded-md border px-3 py-2 data-active:ring-2 data-active:ring-[#ddb668]">
                  <span className="grid leading-none">
                    <span className="text-[9px] font-black uppercase tracking-[0.06em] opacity-70">
                      {candidate.direction === 'output' ? 'Outlet' : 'Input'}
                    </span>
                    <span className="mt-1 font-mono text-base font-black">{String(index + 1).padStart(2, '0')}</span>
                  </span>
                </TabsTrigger>
              )
            })}
          </TabsList>
          {selected ? (
            <TabsContent value={endpointKey(selected.endpoint)} className="m-0 grid gap-3 rounded-lg border border-[#e5dccf] bg-[#fffdf8] p-3">
              <div className="rounded-md bg-[#f3f0ea] p-3">
                <div className={labelClass}>{selected.direction}</div>
                <div className="mt-1 text-sm font-black text-[#20242c]">{selected.label}</div>
              </div>
              {connections.length === 0 ? (
                <div className="rounded-md bg-[#f8f3eb] p-3 text-sm font-semibold text-[#75695d]">Open</div>
              ) : connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  project={project}
                  onUpdateLabel={onUpdateConnectionLabel}
                  onRemove={onRemoveConnection}
                />
              ))}
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </InspectorSection>
  )
}

function PcBuildInspectorTabs({
  project,
  item,
  agentStatus,
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
}: {
  project: ProjectState
  item: InventoryItem
  agentStatus: AgentStatusSummary | null
  demoMode: boolean
  activeNetworkTraceKey: string | null
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: AuditWarning[]
  onUpdateProject: (project: ProjectState) => void
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
  const status = getServerAgentStatus(agentStatus, String(item.id))
  const registered = agentStatus?.registeredServerIds.some((id) => String(id) === String(item.id)) ?? false
  const hasSavedStatus = Boolean(agentStatus?.servers[String(item.id)])

  return (
    <InspectorTabs
      defaultValue="specs"
      status={<InventoryFormStatus saveError={editor.saveError} />}
      tabs={[
        {
          value: 'specs',
          label: 'Specs',
          content: <EditableSpecsSection title="PC Build Details" editor={editor} auditWarnings={auditWarnings} displayName />,
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
        { value: 'services', label: 'Services', content: <ComingSoonSection /> },
        {
          value: 'agent',
          label: 'Agent',
          content: (
            <AgentSetupPanel
              server={draftItem}
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
      ]}
    />
  )
}

function StandalonePowerEquipmentTabs({
  project,
  item,
  pendingEndpoint,
  auditWarnings,
  onUpdateItem,
  onEndpointConnectionClick,
  onUpdateConnectionLabel,
  onRemoveConnection,
}: {
  project: ProjectState
  item: InventoryItem
  pendingEndpoint: ConnectionEndpoint | null
  auditWarnings: AuditWarning[]
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const editor = useInventoryItemEditor({ item, onSave: (input) => onUpdateItem(runtimeItemKey(item), input) })
  const draftItem = itemFromEditorValues(item, editor.values)
  const inspectedItem = item.type === 'monitor'
    ? { ...draftItem, ports: draftItem.ports ?? item.ports }
    : draftItem
  const handlePortsUpdate = (ports: InventoryPort[]) => updateEditorPorts(editor, ports)

  return (
    <InspectorTabs
      defaultValue="specs"
      status={<InventoryFormStatus saveError={editor.saveError} />}
      tabs={[
        {
          value: 'specs',
          label: 'Specs',
          content: <EditableSpecsSection title={`${itemTypeLabel(item.type)} Details`} editor={editor} auditWarnings={auditWarnings} />,
        },
        {
          value: item.type === 'monitor' ? 'ports' : 'outlets',
          label: item.type === 'monitor' ? 'Ports' : 'Outlets',
          content: (
            <>
              {item.type === 'monitor' && (inspectedItem.ports?.length ?? 0) > 0 ? (
                <PortTabsEditor
                  project={project}
                  item={inspectedItem}
                  pendingEndpoint={pendingEndpoint}
                  onUpdate={handlePortsUpdate}
                  onEndpointConnect={onEndpointConnectionClick}
                />
              ) : null}
              <PowerEndpointsTab
                project={project}
                item={inspectedItem}
                onUpdateConnectionLabel={onUpdateConnectionLabel}
                onRemoveConnection={onRemoveConnection}
              />
            </>
          ),
        },
      ]}
    />
  )
}

function ComponentItemEditor({
  project,
  item,
  validationMessage,
  pendingEndpoint,
  onUpdateItem,
  onEndpointConnectionClick,
}: {
  project: ProjectState
  item: InventoryItem & { type: ComponentType }
  validationMessage: string | null
  pendingEndpoint: ConnectionEndpoint | null
  onUpdateItem: (itemId: string, input: InventoryItemInput) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
}) {
  const editor = useInventoryItemEditor({
    item,
    onSave: (input) => onUpdateItem(runtimeItemKey(item), input),
  })
  const draftItem = itemFromEditorValues(item, editor.values)
  const handlePortsUpdate = (ports: InventoryPort[]) => updateEditorPorts(editor, ports)

  if (!LEGACY_COMPONENT_INSPECTOR_TYPES.has(item.type)) {
    const tabs: InspectorTab[] = [
      {
        value: 'specs',
        label: 'Specs',
        content: (
          <InspectorSection title={`${itemTypeLabel(item.type)} Details`} icon={Info}>
            <InventorySpecsFormContent
              values={editor.values}
              errors={editor.errors}
              onChange={editor.updateValues}
              includeCompatibility={false}
            />
          </InspectorSection>
        ),
      },
    ]

    if (item.type === 'motherboard') {
      tabs.push({
        value: 'ports',
        label: 'Ports',
        content: (
          <>
            <PortGroupsEditor
              type="motherboard"
              groups={editor.values.portGroups}
              error={editor.errors.portGroups}
              onChange={(portGroups) => editor.updateValues({ portGroups }, 'immediate')}
            />
            <PortTabsEditor
              project={project}
              item={draftItem}
              pendingEndpoint={pendingEndpoint}
              onUpdate={handlePortsUpdate}
              onEndpointConnect={onEndpointConnectionClick}
            />
          </>
        ),
      })
    }

    return (
      <InspectorTabs
        defaultValue="specs"
        status={<InventoryFormStatus validationMessage={validationMessage} saveError={editor.saveError} />}
        tabs={tabs}
      />
    )
  }

  return (
    <ComponentInspectorTabs
      project={project}
      item={draftItem}
      values={editor.values}
      errors={editor.errors}
      validationMessage={validationMessage}
      saveError={editor.saveError}
      onChange={editor.updateValues}
    />
  )
}

export function InspectorPanel({
  project,
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
  onDuplicateItem = () => undefined,
  onArchiveItem = () => undefined,
  lifecycleBusy = false,
  onCreateConnection,
  onSelectNetworkTrace,
  onEndpointConnectionClick,
  onCancelPendingConnection,
  onUpdateConnectionLabel,
  onUpdateConnectionRoute,
  onRemoveConnection,
}: {
  project: ProjectState
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
  onDuplicateItem?: (item: InventoryItem) => void
  onArchiveItem?: (item: InventoryItem) => void
  lifecycleBusy?: boolean
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
  onCancelPendingConnection: () => void
  onUpdateConnectionLabel: (connectionId: string | number, label: string) => void
  onUpdateConnectionRoute: (connectionId: string | number, route: ConnectionRoutePreferences) => void
  onRemoveConnection: (connectionId: string | number) => void
}) {
  const selectedItem = selectedItemId ? project.items[selectedItemId] ?? null : null
  const selectedConnection = selectedConnectionId
    ? project.connections.find((connection) => String(connection.id) === String(selectedConnectionId)) ?? null
    : null
  const selectedItemRuntimeKey = selectedItem ? runtimeItemKey(selectedItem) : null
  const auditWarnings = selectedItemRuntimeKey ? getItemAuditWarnings(project, selectedItemRuntimeKey) : []
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
      className={`fixed bottom-0 right-0 top-0 z-40 flex min-h-0 w-[min(96vw,680px)] flex-col overflow-x-hidden border-l border-[#d6ccbd] bg-[radial-gradient(circle_at_top_left,#fffdf8_0%,#fbf7ef_44%,#f3ede4_100%)] shadow-[-22px_0_46px_rgba(32,36,44,0.18)] transition-transform duration-200 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
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
              showEdit={false}
              onEdit={() => undefined}
              onDuplicate={() => onDuplicateItem(selectedItem)}
              onArchive={() => onArchiveItem(selectedItem)}
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

        <section className="space-y-4">
          {selectedConnection ? (
            <ConnectionDetails
              project={project}
              connection={selectedConnection}
              onUpdateLabel={onUpdateConnectionLabel}
              onUpdateRoute={onUpdateConnectionRoute}
              onRemove={onRemoveConnection}
            />
          ) : selectedItem ? (
            <>
              {selectedItem.type === 'server' ? (
                <ServerInspectorTabs
                  project={project}
                  server={selectedItem}
                  agentStatus={agentStatus}
                  demoMode={demoMode}
                  activeNetworkTraceKey={activeNetworkTraceKey}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  onUpdateProject={onUpdateProject}
                  onUpdateItem={onUpdateItem}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                />
              ) : selectedItem.type === 'switch' ? (
                <SwitchInspectorTabs
                  project={project}
                  item={selectedItem}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  onUpdateItem={onUpdateItem}
                  onCreateConnection={onCreateConnection}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onUpdateConnectionLabel={onUpdateConnectionLabel}
                  onRemoveConnection={onRemoveConnection}
                />
              ) : selectedItem.type === 'nas' ? (
                <NasInspectorTabs
                  project={project}
                  item={selectedItem}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  activeNetworkTraceKey={activeNetworkTraceKey}
                  onUpdateProject={onUpdateProject}
                  onUpdateItem={onUpdateItem}
                  onCreateConnection={onCreateConnection}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onUpdateConnectionLabel={onUpdateConnectionLabel}
                  onRemoveConnection={onRemoveConnection}
                />
              ) : selectedItem.type === 'patchPanel' ? (
                <PatchPanelInspectorTabs
                  project={project}
                  item={selectedItem}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  activeNetworkTraceKey={activeNetworkTraceKey}
                  onUpdateItem={onUpdateItem}
                  onCreateConnection={onCreateConnection}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onUpdateConnectionLabel={onUpdateConnectionLabel}
                  onRemoveConnection={onRemoveConnection}
                />
              ) : selectedItem.type === 'pcBuild' ? (
                <PcBuildInspectorTabs
                  project={project}
                  item={selectedItem}
                  agentStatus={agentStatus}
                  demoMode={demoMode}
                  activeNetworkTraceKey={activeNetworkTraceKey}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  onUpdateProject={onUpdateProject}
                  onUpdateItem={onUpdateItem}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onUpdateConnectionLabel={onUpdateConnectionLabel}
                  onRemoveConnection={onRemoveConnection}
                />
              ) : selectedItem.type === 'monitor'
                || selectedItem.type === 'ups'
                || selectedItem.type === 'powerStrip' ? (
                <StandalonePowerEquipmentTabs
                  project={project}
                  item={selectedItem}
                  pendingEndpoint={pendingConnectionEndpoint}
                  auditWarnings={auditWarnings}
                  onUpdateItem={onUpdateItem}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                  onUpdateConnectionLabel={onUpdateConnectionLabel}
                  onRemoveConnection={onRemoveConnection}
                />
              ) : isEditableComponent(selectedItem) ? (
                <>
                  <ComponentItemEditor
                    key={runtimeItemKey(selectedItem)}
                    project={project}
                    item={selectedItem}
                    validationMessage={null}
                    pendingEndpoint={pendingConnectionEndpoint}
                    onUpdateItem={onUpdateItem}
                    onEndpointConnectionClick={onEndpointConnectionClick}
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
      </div>
    </aside>
  )
}
