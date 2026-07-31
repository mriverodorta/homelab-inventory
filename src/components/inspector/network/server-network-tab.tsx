import { useContext, useEffect, useMemo, useState } from 'react'
import { Activity, Cable, Network } from 'lucide-react'
import {
  connectionStateLabel,
  connectionStateTone,
  formatPortTypeLabel,
  getEndpointConnectionState,
  getEndpointConnections,
  getOppositeEndpoint,
  portChipClass,
  updatePort,
} from '@/components/inspector/connections/connection-editor'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { InspectorTopologyContext } from '@/components/inspector/inspector-topology-context'
import { getServerNetworkPortOptions } from '@/components/inspector/network/server-network-options'
import { itemInputWithPorts } from '@/components/inspector/shared/item-editor-adapters'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  PresentedNetworkTrace as NetworkTrace,
} from '@/hooks/use-topology-query'
import { describeConnectionEndpoint } from '@/lib/cables'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import { cn } from '@/lib/utils'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'
import type { AgentServerStatus } from '@/types/agent'

const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'
const formLabelClass = 'grid gap-1.5 text-sm font-semibold text-[#20242c]'

export function NetworkTraceSection({
  item,
  activeTraceKey,
  onSelectTrace,
}: {
  item: InventoryItem
  activeTraceKey: string | null
  onSelectTrace: (endpoint: ConnectionEndpoint) => void
}) {
  const topology = useContext(InspectorTopologyContext)
  const traces = topology.data?.networkTracesByItemId.get(runtimeItemKey(item)) ?? []

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

export function NetworkTraceCard({
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

export function ServerNetworkTab({
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
  const topology = useContext(InspectorTopologyContext)
  const options = useMemo(() => getServerNetworkPortOptions(project, server), [project, server])
  const [selectedKey, setSelectedKey] = useState(() => options[0]?.key ?? '')
  const selected = options.find((option) => option.key === selectedKey) ?? options[0] ?? null
  const trace = selected
    ? topology.data?.networkTraceByEndpointKey.get(endpointKey(selected.endpoint)) ?? null
    : null
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
