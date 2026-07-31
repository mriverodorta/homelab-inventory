import { useContext, useEffect, useMemo, useState } from 'react'
import { Cable, PlugZap } from 'lucide-react'
import {
  connectionStateLabel,
  connectionStateTone,
  describeConnectedEndpoint,
  endpointIsCompatible,
  formatPortTypeLabel,
  getEndpointConnectionState,
  getPortConnectionState,
  updatePort,
} from '@/components/inspector/connections/endpoint-state'
import { portChipClass } from '@/components/inspector/connections/port-chip-state'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { InspectorTopologyContext } from '@/components/inspector/inspector-topology-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PORT_ROLE_LABELS } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import { cn } from '@/lib/utils'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortRole,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'

const PORT_TYPE_OPTIONS: InventoryPortType[] = [
  'rj45',
  'sfp',
  'sfp-plus',
  'hdmi',
  'displayport',
  'mini-displayport',
  'barrel',
]
const PORT_ROLE_NONE_VALUE = '__none__'
const SWITCH_PORT_ROLE_OPTIONS: InventoryPortRole[] = [
  'access',
  'trunk',
  'uplink',
  'management',
  'disabled',
]
const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'
const formLabelClass = 'grid gap-1.5 text-sm font-semibold text-[#20242c]'

export function EndpointConnectButton({
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
  const topology = useContext(InspectorTopologyContext)
  const state = getEndpointConnectionState(project, endpoint)
  const selected = pendingEndpoint ? endpointKey(pendingEndpoint) === endpointKey(endpoint) : false
  const compatible = endpointIsCompatible(
    pendingEndpoint,
    endpoint,
    topology.compatibleEndpointKeys,
  )
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

export function PortTabsEditor({
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
