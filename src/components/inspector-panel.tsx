import {
  Activity,
  AlertTriangle,
  Cable,
  Copy,
  HardDrive,
  Info,
  Layers3,
  Network,
  PlugZap,
  Terminal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { createAgentEnrollment } from '@/lib/agent-api'
import { getSlotStatus, SLOT_LABELS, sortAssignmentsForDisplay } from '@/lib/constraints'
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
  InventorySpecs,
  ProjectState,
} from '@/types/inventory'
import type { AgentServerStatus, AgentState, AgentStatusSummary } from '@/types/agent'

type SpecRow = {
  label: string
  value: string
}

const RAM_SPEED_OPTIONS: Record<string, number[]> = {
  DDR3L: [1066, 1333, 1600, 1866],
  DDR4: [2133, 2400, 2666, 2933, 3200],
  DDR5: [4800, 5200, 5600, 6000, 6400],
}

const STORAGE_FORM_FACTOR_OPTIONS = ['2230', '2242', '2260', '2280', '22110', '2.5-inch', 'eMMC']
const GPU_FORM_FACTOR_OPTIONS = ['Low profile', 'Full height']
const SERVER_FORM_FACTOR_OPTIONS = ['Tiny', 'Mini', 'Micro', 'Small', 'SFF', 'Tower', 'Mini-ITX', 'Micro-ATX', 'ATX', 'E-ATX']
const SERVER_NETWORK_SLOT_OPTIONS = ['On board', 'PCIe', 'M.2 A+E', 'M.2 2230 A/E']
const SERVER_WIRELESS_OPTIONS = ['Yes', 'No', 'Wi-Fi card supported or installed']
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
  const labels: Record<InventoryItem['type'], string> = {
    cpu: 'CPU',
    gpu: 'GPU',
    nas: 'NAS',
    network: 'Network Card',
    patchPanel: 'Patch Panel',
    ram: 'RAM',
    server: 'Server',
    storage: 'Storage',
    switch: 'Switch',
  }

  return labels[type]
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
}: {
  tabs: InspectorTab[]
  defaultValue?: string
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
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} forceMount className="m-0 min-w-0 space-y-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
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

function formatSpecLabel(key: string): string {
  const labels: Record<string, string> = {
    displayOutputs: 'Display Outputs',
    graphicsClockMhz: 'Graphics Clock',
    memoryBandwidthGbps: 'Memory Bandwidth',
    memoryBusBit: 'Memory Bus',
    memorySpeedGbps: 'Memory Speed',
    openCl: 'OpenCL',
    openGl: 'OpenGL',
    pcie: 'PCIe',
    poeBudgetWatts: 'PoE Budget',
    powerWatts: 'Power',
    rackUnits: 'Rack Units',
    rayTracingUnits: 'Ray Tracing Units',
    shaderModel: 'Shader Model',
    slotWidth: 'Slot Width',
    vramGb: 'VRAM',
    xeCores: 'Xe Cores',
  }

  if (labels[key]) {
    return labels[key]
  }

  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
}

function formatSpecValue(key: string, value: InventorySpecs[string]): string {
  if (key === 'vramGb') {
    return `${value}GB`
  }

  if (key === 'memoryBusBit') {
    return `${value}-bit`
  }

  if (key === 'memoryBandwidthGbps') {
    return `${value}GB/s`
  }

  if (key === 'memorySpeedGbps') {
    return `${value}Gbps`
  }

  if (key === 'powerWatts') {
    return typeof value === 'number' ? `${value}W` : String(value)
  }

  if (key === 'poeBudgetWatts') {
    return typeof value === 'number' ? `${value}W` : String(value)
  }

  if (key === 'rackUnits') {
    return `${value}U`
  }

  if (key === 'graphicsClockMhz') {
    return `${value}MHz`
  }

  return String(value)
}

function getSpecRows(item: InventoryItem): SpecRow[] {
  const specs = item.specs ?? {}

  if (item.type === 'storage') {
    return Object.entries(specs).flatMap(([key, value]) => {
      if (key === 'formFactor') {
        return []
      }

      return [{
        label: key === 'capacityTb' || key === 'capacityGb' ? 'Capacity' : formatSpecLabel(key),
        value: key === 'capacityTb' || key === 'capacityGb' ? formatCapacity(specs) : String(value),
      }]
    })
  }

  if (item.type === 'ram') {
    return Object.entries(specs).flatMap(([key, value]) => {
      if (key === 'speedMt' || key === 'secondarySpeedMt') {
        return []
      }

      if (key !== 'capacityGb' || typeof value !== 'number') {
        return [
          {
            label: formatSpecLabel(key),
            value: String(value),
          },
        ]
      }

      return [
        {
          label: 'Capacity',
          value: `${value}GB`,
        },
        {
          label: 'Module',
          value: formatRamModuleCapacity(value),
        },
      ]
    })
  }

  if (item.type === 'cpu') {
    const identityRows: SpecRow[] = [
      typeof item.manufacturer === 'string'
        ? { label: 'Manufacturer', value: item.manufacturer }
        : null,
      typeof item.family === 'string' ? { label: 'Family', value: item.family } : null,
      typeof item.number === 'string' ? { label: 'Number', value: item.number } : null,
    ].filter((row): row is SpecRow => row !== null)
    const specRows = Object.entries(specs).flatMap(([key, value]) => {
      if (key === 'processor') {
        return []
      }

      if (key === 'baseClockGhz') {
        return [{
          label: 'Base Clock',
          value: `${value}GHz`,
        }]
      }

      if (key === 'boostClockGhz') {
        return [{
          label: 'Boost Clock',
          value: `${value}GHz`,
        }]
      }

      return [{
        label: formatSpecLabel(key),
        value: String(value),
      }]
    })

    return [...identityRows, ...specRows]
  }

  if (item.type === 'gpu') {
    const identityRows: SpecRow[] = [
      typeof item.manufacturer === 'string'
        ? { label: 'Manufacturer', value: item.manufacturer }
        : null,
      typeof item.model === 'string' ? { label: 'Model', value: item.model } : null,
    ].filter((row): row is SpecRow => row !== null)
    const specRows = Object.entries(specs).flatMap(([key, value]) => {
      if (key === 'formFactor') {
        return []
      }

      return [{
        label: formatSpecLabel(key),
        value: formatSpecValue(key, value),
      }]
    })

    return [...identityRows, ...specRows]
  }

  if (item.type === 'switch' || item.type === 'patchPanel' || item.type === 'server' || item.type === 'nas') {
    const identityRows: SpecRow[] = [
      typeof item.manufacturer === 'string'
        ? { label: 'Manufacturer', value: item.manufacturer }
        : null,
      typeof item.model === 'string' ? { label: 'Model', value: item.model } : null,
      item.ports && item.ports.length > 0
        ? { label: 'Ports', value: formatPortSummary(item) }
        : null,
    ].filter((row): row is SpecRow => row !== null)
    const specRows = Object.entries(specs).map(([key, value]) => ({
      label: formatSpecLabel(key),
      value: formatSpecValue(key, value),
    }))

    return [...identityRows, ...specRows]
  }

  return Object.entries(specs).map(([key, value]) => ({
    label: formatSpecLabel(key),
    value: String(value),
  }))
}

function SpecRows({ item }: { item: InventoryItem }) {
  const specs = getSpecRows(item)

  if (specs.length === 0) {
    return <p className="rounded-md bg-[#f8f3eb] p-3 text-sm font-medium text-[#75695d]">No extra specs recorded.</p>
  }

  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {specs.map((spec) => (
        <div key={spec.label} className="min-w-0 rounded-md border border-[#eee6db] bg-[#fbf8f2] p-2.5">
          <dt className={cn(labelClass, 'text-[9px]')}>{spec.label}</dt>
          <dd className="mt-1 truncate text-sm font-black text-[#20242c]">{spec.value}</dd>
        </div>
      ))}
    </dl>
  )
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

function PortEditor({
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
  const ports = item.ports ?? []
  const itemRuntimeKey = runtimeItemKey(item)
  const canEditType = item.type === 'patchPanel'
  const canEditRole = item.type === 'switch'

  if (ports.length === 0) {
    return null
  }

  return (
    <InspectorSection
      title="Port occupancy"
      icon={PlugZap}
      badge={<StatusBadge>{ports.length} ports</StatusBadge>}
    >
      <div className="grid gap-2">
          {ports.map((port) => {
            const portState = getPortConnectionState(project, item, port)
            const normalEndpoint = { itemId: itemRuntimeKey, portId: port.id }
            const portConnectionSummary = describeConnectedEndpoint(project, normalEndpoint)

            return (
              <div
                key={port.id}
                className="grid min-w-0 gap-2 rounded-md border border-[#eee6db] bg-[#fffdf8] p-2.5 shadow-[0_4px_14px_rgba(60,52,43,0.04)]"
              >
                <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2">
                  <div className="rounded-md bg-[#20242c] px-2 py-1.5 text-center text-[#fffdf8]">
                    <div className="text-[8px] font-black uppercase tracking-[0.12em] opacity-65">
                      Slot
                    </div>
                    <div className="font-mono text-base font-black leading-none">
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
                        <SelectTrigger className="h-8 w-full min-w-0 px-2 text-xs" aria-label={`Port ${port.slotNumber} type`}>
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
                      <div className="truncate rounded-md bg-[#f3f0ea] px-2 py-1.5 text-xs font-black text-[#3c342b]">
                        {port.speed ? `${formatPortTypeLabel(port.type)} ${port.speed}` : formatPortTypeLabel(port.type)}
                        {port.poe ? ' PoE' : ''}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className={cn(labelClass, 'mb-1 text-right text-[9px]')}>
                      Status
                    </div>
                    <span
                      className={`block rounded-md border px-2 py-1.5 text-center text-[10px] font-black uppercase tracking-[0.06em] ${connectionStateTone(portState)}`}
                    >
                      {connectionStateLabel(portState)}
                    </span>
                  </div>
                </div>

                <Input
                  value={port.label ?? ''}
                  placeholder="Custom label"
                  className="h-8 min-w-0 text-xs"
                  aria-label={`Port ${port.slotNumber} label`}
                  onChange={(event) => {
                    onUpdate(updatePort(ports, port.id, { label: event.target.value }))
                  }}
                />

                {port.endpoints && port.endpoints.length > 0 ? (
                  <div className="grid gap-1">
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
                    <div className="min-w-0 truncate text-[11px] font-medium text-[#75695d]">
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
                <Input
                  value={port.notes ?? ''}
                  placeholder="Port notes"
                  className="h-8 min-w-0 text-xs"
                  aria-label={`Port ${port.slotNumber} notes`}
                  onChange={(event) => {
                    onUpdate(updatePort(ports, port.id, { notes: event.target.value }))
                  }}
                />
                {canEditRole ? (
                  <label className="grid min-w-0 grid-cols-[50px_minmax(0,1fr)] items-center gap-2 text-xs font-bold text-[#75695d]">
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
                      <SelectTrigger className="h-8 w-full min-w-0 text-xs" aria-label={`Port ${port.slotNumber} role`}>
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
          })}
      </div>
    </InspectorSection>
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

type EndpointOption = {
  key: string
  endpoint: ConnectionEndpoint
  item: InventoryItem
  port: InventoryPort
  label: string
}

function getEndpointOptions(item: InventoryItem): EndpointOption[] {
  const itemRuntimeKey = runtimeItemKey(item)

  return (item.ports ?? []).flatMap((port) => {
    if (port.endpoints && port.endpoints.length > 0) {
      return port.endpoints.map((endpoint) => {
        const connectionEndpoint = {
          itemId: itemRuntimeKey,
          portId: port.id,
          endpointId: endpoint.id,
        }

        return {
          key: endpointKey(connectionEndpoint),
          endpoint: connectionEndpoint,
          item,
          port,
          label: `${port.label?.trim() || String(port.slotNumber).padStart(2, '0')} ${endpoint.side} · ${formatPortTypeLabel(port.type)}`,
        }
      })
    }

    const connectionEndpoint = {
      itemId: itemRuntimeKey,
      portId: port.id,
    }

    return [
      {
        key: endpointKey(connectionEndpoint),
        endpoint: connectionEndpoint,
        item,
        port,
        label: `${port.label || String(port.slotNumber).padStart(2, '0')} · ${
          port.speed ? `${formatPortTypeLabel(port.type)} ${port.speed}` : formatPortTypeLabel(port.type)
        }`,
      },
    ]
  })
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
  const allItemsWithPorts = useMemo(
    () =>
      Object.values(project.items)
        .filter((candidate) => (candidate.ports ?? []).length > 0)
        .sort((first, second) => first.name.localeCompare(second.name)),
    [project.items],
  )
  const selectedEndpointOptions = useMemo(() => getEndpointOptions(item), [item])
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
  const destinationItems = useMemo(
    () => allItemsWithPorts.filter((candidate) => runtimeItemKey(candidate) !== runtimeItemKey(item)),
    [allItemsWithPorts, item],
  )
  const [fromKey, setFromKey] = useState(EMPTY_SELECT_VALUE)
  const [destinationItemId, setDestinationItemId] = useState(EMPTY_SELECT_VALUE)
  const [toKey, setToKey] = useState(EMPTY_SELECT_VALUE)

  const selectedFrom = availableFromOptions.find((option) => option.key === fromKey) ?? null
  const destinationItem = destinationItems.find((candidate) => runtimeItemKey(candidate) === destinationItemId) ?? null
  const destinationEndpointOptions = useMemo(() => {
    if (!selectedFrom || !destinationItem) {
      return []
    }

    return getEndpointOptions(destinationItem).filter(
      (option) =>
        portsCompatible(selectedFrom.port.type, option.port.type) &&
        connectionEndpointAvailable(project, option.endpoint),
    )
  }, [destinationItem, project, selectedFrom])
  const selectedTo = destinationEndpointOptions.find((option) => option.key === toKey) ?? null

  useEffect(() => {
    setFromKey(availableFromOptions[0]?.key ?? EMPTY_SELECT_VALUE)
  }, [availableFromOptions])

  useEffect(() => {
    setDestinationItemId(destinationItems[0] ? runtimeItemKey(destinationItems[0]) : EMPTY_SELECT_VALUE)
  }, [destinationItems])

  useEffect(() => {
    setToKey(destinationEndpointOptions[0]?.key ?? EMPTY_SELECT_VALUE)
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

      {availableFromOptions.length > 0 && destinationItems.length > 0 ? (
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
              {destinationItems.map((candidate) => (
                <SelectItem key={runtimeItemKey(candidate)} value={runtimeItemKey(candidate)}>
                  <span className="block max-w-[460px] truncate">{candidate.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={toKey === EMPTY_SELECT_VALUE ? undefined : toKey}
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
    <Card className={cn(inspectorSurfaceClass, 'overflow-visible rounded-lg py-3')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[#20242c]">
            <Cable className="size-4 text-[#75695d]" />
            {connection.label?.trim() || 'Cable'}
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#75695d]">
            {connection.type}
          </div>
        </div>
        <span
          className="rounded-md border px-2 py-1 text-xs font-black leading-none"
          style={{
            borderColor: appearance.color,
            color: appearance.color,
          }}
        >
          {appearance.label}
        </span>
      </div>

      <label className={cn(formLabelClass, 'mt-4')}>
        Label
        <Input
          value={connection.label ?? ''}
          placeholder="Cable label"
          onChange={(event) => onUpdateLabel(connection.id, event.target.value)}
        />
      </label>

      <div className="mt-4 space-y-3">
        <div className="rounded-md bg-[#f8f3eb] p-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#75695d]">
            From
          </div>
          <div className="mt-1 text-sm font-semibold leading-snug text-[#20242c]">
            {describeConnectionEndpoint(project, connection.from)}
          </div>
        </div>
        <div className="rounded-md bg-[#f8f3eb] p-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#75695d]">
            To
          </div>
          <div className="mt-1 text-sm font-semibold leading-snug text-[#20242c]">
            {describeConnectionEndpoint(project, connection.to)}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
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
        className="mt-4 h-9 w-full"
        onClick={() => onRemove(connection.id)}
      >
        Remove Cable
      </Button>
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

function uniqueOptions(options: string[], current: unknown): string[] {
  const currentValue = typeof current === 'string' && current.trim() ? current.trim() : null

  return currentValue && !options.includes(currentValue) ? [...options, currentValue] : options
}

function ServerSpecsForm({
  server,
  onUpdateIdentity,
  onUpdateSpecs,
  onUpdateProperties,
}: {
  server: InventoryItem
  onUpdateIdentity: (identity: Partial<Pick<InventoryItem, 'name' | 'manufacturer' | 'model'>>) => void
  onUpdateSpecs: (specs: Record<string, InventorySpecs[string] | undefined>) => void
  onUpdateProperties: (properties: InventoryProperties) => void
}) {
  const properties = server.properties ?? {}
  const specs = server.specs ?? {}
  const formFactor = typeof specs.formFactor === 'string' ? specs.formFactor : undefined
  const networkSlot = typeof specs.networkSlot === 'string' ? specs.networkSlot : undefined
  const wireless = typeof specs.wireless === 'string' ? specs.wireless : undefined

  return (
    <InspectorSection title="Server Details" icon={Info}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={formLabelClass}>
          Inventory name
          <Input
            value={server.name}
            placeholder="Dell OptiPlex Micro 7090"
            onChange={(event) => onUpdateIdentity({ name: event.target.value })}
          />
        </label>
        <label className={formLabelClass}>
          Display name
          <Input
            value={properties.displayName ?? ''}
            placeholder="Server name"
            onChange={(event) => onUpdateProperties({ displayName: event.target.value })}
          />
        </label>
        <label className={formLabelClass}>
          Manufacturer
          <Input
            value={server.manufacturer ?? ''}
            placeholder="Dell"
            onChange={(event) => onUpdateIdentity({ manufacturer: event.target.value })}
          />
        </label>
        <label className={formLabelClass}>
          Model
          <Input
            value={server.model ?? ''}
            placeholder="OptiPlex Micro 7090"
            onChange={(event) => onUpdateIdentity({ model: event.target.value })}
          />
        </label>
        <label className={formLabelClass}>
          Form factor
          <Select
            value={formFactor}
            onValueChange={(value) => onUpdateSpecs({ formFactor: value })}
          >
            <SelectTrigger className="w-full" aria-label="Server form factor">
              <SelectValue placeholder="Select form factor" />
            </SelectTrigger>
            <SelectContent>
              {uniqueOptions(SERVER_FORM_FACTOR_OPTIONS, formFactor).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className={formLabelClass}>
          Network slot
          <Select
            value={networkSlot}
            onValueChange={(value) => onUpdateSpecs({ networkSlot: value })}
          >
            <SelectTrigger className="w-full" aria-label="Server network slot">
              <SelectValue placeholder="Select network slot" />
            </SelectTrigger>
            <SelectContent>
              {uniqueOptions(SERVER_NETWORK_SLOT_OPTIONS, networkSlot).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className={cn(formLabelClass, 'sm:col-span-2')}>
          Wireless
          <Select
            value={wireless}
            onValueChange={(value) => onUpdateSpecs({ wireless: value })}
          >
            <SelectTrigger className="w-full" aria-label="Server wireless">
              <SelectValue placeholder="Select wireless support" />
            </SelectTrigger>
            <SelectContent>
              {uniqueOptions(SERVER_WIRELESS_OPTIONS, wireless).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </InspectorSection>
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
  demoMode,
}: {
  server: InventoryItem
  status: AgentServerStatus
  demoMode: boolean
}) {
  const [endpoint, setEndpoint] = useState(() => window.location.origin)
  const [copied, setCopied] = useState(false)
  const enrollmentMutation = useMutation({
    mutationFn: () => createAgentEnrollment(server.id, endpoint),
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
  const tones: Record<ComponentType, string> = {
    cpu: 'border-[#b8d4dc] bg-[#d7eef2]',
    gpu: 'border-[#dfb3a5] bg-[#fff4ee]',
    network: 'border-[#a7d8cd] bg-[#d3eee7]',
    ram: 'border-[#e8d392] bg-[#fff2c7]',
    storage: 'border-[#d6ccbd] bg-[#f3ead8]',
  }

  return tones[type]
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

function ServerSlotsTab({
  project,
  server,
}: {
  project: ProjectState
  server: InventoryItem
}) {
  const serverRuntimeKey = runtimeItemKey(server)
  const assignments = sortAssignmentsForDisplay(project, serverRuntimeKey)
  const slotStatus = getSlotStatus(project, serverRuntimeKey)

  return (
    <InspectorSection
      title="Server Slots"
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
  onUpdateItemPorts,
  onSelectTrace,
}: {
  project: ProjectState
  server: InventoryItem
  status: AgentServerStatus
  activeNetworkTraceKey: string | null
  onUpdateItemPorts: (itemId: string, ports: InventoryPort[]) => void
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
                      onUpdateItemPorts(
                        selected.itemKey,
                        updatePort(selected.item.ports ?? [], selected.port.id, {
                          ipAddress: event.target.value,
                        }),
                      )
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

function ServerInspectorTabs({
  project,
  server,
  agentStatus,
  demoMode,
  activeNetworkTraceKey,
  pendingEndpoint,
  auditWarnings,
  onUpdateServerIdentity,
  onUpdateServerSpecs,
  onUpdateServerProperties,
  onUpdateItemPorts,
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
  onUpdateServerIdentity: (
    serverId: string,
    identity: Partial<Pick<InventoryItem, 'name' | 'manufacturer' | 'model'>>,
  ) => void
  onUpdateServerSpecs: (
    serverId: string,
    specs: Record<string, InventorySpecs[string] | undefined>,
  ) => void
  onUpdateServerProperties: (serverId: string, properties: InventoryProperties) => void
  onUpdateItemPorts: (itemId: string, ports: InventoryPort[]) => void
  onSelectNetworkTrace: (endpoint: ConnectionEndpoint) => void
  onEndpointConnectionClick: (endpoint: ConnectionEndpoint) => void
}) {
  const serverRuntimeKey = runtimeItemKey(server)
  const status = getServerAgentStatus(agentStatus, String(server.id))

  return (
    <InspectorTabs
      defaultValue="specs"
      tabs={[
        {
          value: 'specs',
          label: 'Specs',
          content: (
            <>
              <ServerSpecsForm
                server={server}
                onUpdateIdentity={(identity) => onUpdateServerIdentity(serverRuntimeKey, identity)}
                onUpdateSpecs={(specs) => onUpdateServerSpecs(serverRuntimeKey, specs)}
                onUpdateProperties={(properties) => onUpdateServerProperties(serverRuntimeKey, properties)}
              />
              <AuditSection warnings={auditWarnings} />
              {server.notes ? (
                <p className="rounded-md border border-[#e5dccf] bg-[#f3f0ea] p-3 text-sm font-medium text-[#5f554b]">
                  {server.notes}
                </p>
              ) : null}
            </>
          ),
        },
        {
          value: 'slots',
          label: 'Slots',
          content: <ServerSlotsTab project={project} server={server} />,
        },
        {
          value: 'ports',
          label: 'Ports',
          content: (
            <PortTabsEditor
              project={project}
              item={server}
              pendingEndpoint={pendingEndpoint}
              onUpdate={(ports) => onUpdateItemPorts(serverRuntimeKey, ports)}
              onEndpointConnect={onEndpointConnectionClick}
            />
          ),
        },
        {
          value: 'network',
          label: 'Network',
          content: (
            <ServerNetworkTab
              project={project}
              server={server}
              status={status}
              activeNetworkTraceKey={activeNetworkTraceKey}
              onUpdateItemPorts={onUpdateItemPorts}
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
          content: <AgentSetupPanel server={server} status={status} demoMode={demoMode} />,
        },
      ]}
    />
  )
}

function StoragePropertiesForm({
  storage,
  onUpdateManufacturer,
  onUpdate,
}: {
  storage: InventoryItem
  onUpdateManufacturer: (manufacturer: string) => void
  onUpdate: (specs: Record<string, InventorySpecs[string] | undefined>) => void
}) {
  const formFactor = storage.specs?.formFactor

  return (
    <InspectorSection title="Storage Properties" icon={HardDrive}>
      <div className="grid gap-3">
        <label className={formLabelClass}>
          Manufacturer
          <Input
            value={storage.manufacturer ?? ''}
            placeholder="Storage manufacturer"
            onChange={(event) => onUpdateManufacturer(event.target.value)}
          />
        </label>
        <label className={formLabelClass}>
          Form factor
          <Select
            value={typeof formFactor === 'string' ? formFactor : undefined}
            onValueChange={(value) => {
              onUpdate({ formFactor: value === 'none' ? undefined : value })
            }}
          >
            <SelectTrigger className="w-full" aria-label="Storage form factor">
              <SelectValue placeholder="Select form factor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No form factor</SelectItem>
              {STORAGE_FORM_FACTOR_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </InspectorSection>
  )
}

function GpuPropertiesForm({
  gpu,
  onUpdateIdentity,
  onUpdate,
}: {
  gpu: InventoryItem
  onUpdateIdentity: (identity: Partial<Pick<InventoryItem, 'manufacturer' | 'model'>>) => void
  onUpdate: (specs: Record<string, InventorySpecs[string] | undefined>) => void
}) {
  const formFactor = gpu.specs?.formFactor

  return (
    <InspectorSection title="GPU Properties" icon={Layers3}>
      <div className="grid gap-3">
        <label className={formLabelClass}>
          Manufacturer
          <Input
            value={gpu.manufacturer ?? ''}
            placeholder="GPU manufacturer"
            onChange={(event) => onUpdateIdentity({ manufacturer: event.target.value })}
          />
        </label>
        <label className={formLabelClass}>
          Model
          <Input
            value={gpu.model ?? ''}
            placeholder="GPU model"
            onChange={(event) => onUpdateIdentity({ model: event.target.value })}
          />
        </label>
        <label className={formLabelClass}>
          Form factor
          <Select
            value={typeof formFactor === 'string' ? formFactor : undefined}
            onValueChange={(value) => {
              onUpdate({ formFactor: value === 'none' ? undefined : value })
            }}
          >
            <SelectTrigger className="w-full" aria-label="GPU form factor">
              <SelectValue placeholder="Select form factor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No form factor</SelectItem>
              {GPU_FORM_FACTOR_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </InspectorSection>
  )
}

function RamPropertiesForm({
  ram,
  onUpdateManufacturer,
  onUpdate,
}: {
  ram: InventoryItem
  onUpdateManufacturer: (
    manufacturer: string,
    key?: 'manufacturer' | 'secondaryManufacturer',
  ) => void
  onUpdate: (specs: Record<string, InventorySpecs[string] | undefined>) => void
}) {
  const generation = typeof ram.specs?.generation === 'string' ? ram.specs.generation : ''
  const speedMt = ram.specs?.speedMt
  const secondarySpeedMt = ram.specs?.secondarySpeedMt
  const speedOptions = RAM_SPEED_OPTIONS[generation] ?? []

  return (
    <InspectorSection title="RAM Sticks" icon={Layers3}>
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-md border border-[#eee6db] bg-white p-3">
          <div className={labelClass}>
            Stick 1
          </div>
          <label className={formLabelClass}>
            Manufacturer
            <Input
              value={ram.manufacturer ?? ''}
              placeholder="RAM manufacturer"
              onChange={(event) => onUpdateManufacturer(event.target.value)}
            />
          </label>
          <label className={formLabelClass}>
            Speed
            <Select
              value={typeof speedMt === 'number' ? String(speedMt) : undefined}
              onValueChange={(value) => {
                onUpdate({ speedMt: value === 'none' ? undefined : Number(value) })
              }}
              disabled={speedOptions.length === 0}
            >
              <SelectTrigger className="w-full" aria-label="RAM speed">
                <SelectValue placeholder="Select speed" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No speed</SelectItem>
                {speedOptions.map((speed) => (
                  <SelectItem key={speed} value={String(speed)}>
                    {speed}MHz
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="grid gap-3 rounded-md border border-[#e5dccf] bg-[#f8f3eb] p-3">
          <div className={labelClass}>
            Stick 2
          </div>
          <label className={formLabelClass}>
            Manufacturer
            <Input
              value={ram.secondaryManufacturer ?? ''}
              placeholder={ram.manufacturer ? `Same as ${ram.manufacturer}` : 'Same as stick 1'}
              onChange={(event) =>
                onUpdateManufacturer(event.target.value, 'secondaryManufacturer')
              }
            />
          </label>
          <label className={formLabelClass}>
            Speed
            <Select
              value={typeof secondarySpeedMt === 'number' ? String(secondarySpeedMt) : undefined}
              onValueChange={(value) => {
                onUpdate({ secondarySpeedMt: value === 'none' ? undefined : Number(value) })
              }}
              disabled={speedOptions.length === 0}
            >
              <SelectTrigger className="w-full" aria-label="RAM stick 2 speed">
                <SelectValue
                  placeholder={
                    typeof speedMt === 'number' ? `Same as ${speedMt}MHz` : 'Same as stick 1'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Same as stick 1</SelectItem>
                {speedOptions.map((speed) => (
                  <SelectItem key={speed} value={String(speed)}>
                    {speed}MHz
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </div>
    </InspectorSection>
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
  persistenceWarning,
  open,
  onClose,
  onUpdateServerIdentity,
  onUpdateServerSpecs,
  onUpdateServerProperties,
  onUpdateRamManufacturer,
  onUpdateRamSpecs,
  onUpdateStorageManufacturer,
  onUpdateStorageSpecs,
  onUpdateGpuIdentity,
  onUpdateGpuSpecs,
  onUpdateItemPorts,
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
  persistenceWarning: string | null
  open: boolean
  onClose: () => void
  onUpdateServerIdentity: (
    serverId: string,
    identity: Partial<Pick<InventoryItem, 'name' | 'manufacturer' | 'model'>>,
  ) => void
  onUpdateServerSpecs: (
    serverId: string,
    specs: Record<string, InventorySpecs[string] | undefined>,
  ) => void
  onUpdateServerProperties: (serverId: string, properties: InventoryProperties) => void
  onUpdateRamManufacturer: (
    ramId: string,
    manufacturer: string,
    key?: 'manufacturer' | 'secondaryManufacturer',
  ) => void
  onUpdateRamSpecs: (
    ramId: string,
    specs: Record<string, InventorySpecs[string] | undefined>,
  ) => void
  onUpdateStorageManufacturer: (storageId: string, manufacturer: string) => void
  onUpdateStorageSpecs: (
    storageId: string,
    specs: Record<string, InventorySpecs[string] | undefined>,
  ) => void
  onUpdateGpuIdentity: (
    gpuId: string,
    identity: Partial<Pick<InventoryItem, 'manufacturer' | 'model'>>,
  ) => void
  onUpdateGpuSpecs: (
    gpuId: string,
    specs: Record<string, InventorySpecs[string] | undefined>,
  ) => void
  onUpdateItemPorts: (itemId: string, ports: InventoryPort[]) => void
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
      className={`fixed bottom-0 right-0 top-0 z-40 flex min-h-0 w-[min(96vw,680px)] flex-col overflow-x-hidden border-l border-[#d6ccbd] bg-[radial-gradient(circle_at_top_left,#fffdf8_0%,#fbf7ef_44%,#f3ede4_100%)] shadow-[-22px_0_46px_rgba(32,36,44,0.18)] transition-transform duration-200 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!open}
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
          <div className="flex gap-2 rounded-lg border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#613126]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
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
                  onUpdateServerIdentity={onUpdateServerIdentity}
                  onUpdateServerSpecs={onUpdateServerSpecs}
                  onUpdateServerProperties={onUpdateServerProperties}
                  onUpdateItemPorts={onUpdateItemPorts}
                  onSelectNetworkTrace={onSelectNetworkTrace}
                  onEndpointConnectionClick={onEndpointConnectionClick}
                />
              ) : (
                <>
                  <InspectorSection title="Specifications" icon={Info}>
                    <SpecRows item={selectedItem} />
                  </InspectorSection>
                  {selectedItem.type === 'ram' ? (
                    <RamPropertiesForm
                      ram={selectedItem}
                      onUpdateManufacturer={(manufacturer, key) => {
                        if (key) {
                          onUpdateRamManufacturer(runtimeItemKey(selectedItem), manufacturer, key)
                        } else {
                          onUpdateRamManufacturer(runtimeItemKey(selectedItem), manufacturer)
                        }
                      }}
                      onUpdate={(specs) => onUpdateRamSpecs(runtimeItemKey(selectedItem), specs)}
                    />
                  ) : null}
                  {selectedItem.type === 'storage' ? (
                    <StoragePropertiesForm
                      storage={selectedItem}
                      onUpdateManufacturer={(manufacturer) =>
                        onUpdateStorageManufacturer(runtimeItemKey(selectedItem), manufacturer)
                      }
                      onUpdate={(specs) => onUpdateStorageSpecs(runtimeItemKey(selectedItem), specs)}
                    />
                  ) : null}
                  {selectedItem.type === 'gpu' ? (
                    <GpuPropertiesForm
                      gpu={selectedItem}
                      onUpdateIdentity={(identity) => onUpdateGpuIdentity(runtimeItemKey(selectedItem), identity)}
                      onUpdate={(specs) => onUpdateGpuSpecs(runtimeItemKey(selectedItem), specs)}
                    />
                  ) : null}
                  {selectedItem.type === 'nas' ||
                  selectedItem.type === 'switch' ||
                  selectedItem.type === 'patchPanel' ? (
                    <>
                      {selectedItem.type === 'patchPanel' ? (
                        <PatchPanelLabelGrid
                          item={selectedItem}
                          onUpdate={(ports) => onUpdateItemPorts(runtimeItemKey(selectedItem), ports)}
                        />
                      ) : null}
                      <PortEditor
                        project={project}
                        item={selectedItem}
                        pendingEndpoint={pendingConnectionEndpoint}
                        onUpdate={(ports) => onUpdateItemPorts(runtimeItemKey(selectedItem), ports)}
                        onEndpointConnect={onEndpointConnectionClick}
                      />
                      <ConnectionEditor
                        project={project}
                        item={selectedItem}
                        onCreate={onCreateConnection}
                        onUpdateLabel={onUpdateConnectionLabel}
                        onRemove={onRemoveConnection}
                      />
                    </>
                  ) : null}
                  {selectedItem.type === 'nas' ||
                  selectedItem.type === 'patchPanel' ? (
                    <NetworkTraceSection
                      project={project}
                      item={selectedItem}
                      activeTraceKey={activeNetworkTraceKey}
                      onSelectTrace={onSelectNetworkTrace}
                    />
                  ) : null}
                  <AuditSection warnings={auditWarnings} />
                  {selectedItem.notes ? (
                    <p className="rounded-md border border-[#e5dccf] bg-[#f3f0ea] p-3 text-sm font-medium text-[#5f554b]">
                      {selectedItem.notes}
                    </p>
                  ) : null}
                </>
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
