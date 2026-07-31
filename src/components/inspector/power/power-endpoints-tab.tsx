import { useContext, useEffect, useState } from 'react'
import { PlugZap } from 'lucide-react'
import { ConnectionRow, getEndpointConnections } from '@/components/inspector/connections/connection-editor'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { InspectorTopologyContext } from '@/components/inspector/inspector-topology-context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import type {
  InventoryItem,
  ProjectState,
} from '@/types/inventory'

const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'

export function PowerEndpointsTab({
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
  const topology = useContext(InspectorTopologyContext)
  const itemKey = runtimeItemKey(item)
  const endpoints = (topology.data?.power.endpoints ?? [])
    .filter((candidate) => candidate.endpoint.itemId === itemKey)
  const [selectedKey, setSelectedKey] = useState(() => endpoints[0] ? endpointKey(endpoints[0].endpoint) : '')
  const selected = endpoints.find((candidate) => endpointKey(candidate.endpoint) === selectedKey) ?? endpoints[0] ?? null
  const connections = selected ? getEndpointConnections(project, selected.endpoint) : []
  const selectedOutletName = selected && item.type === 'powerStrip'
    ? item.smart?.outlets.find((entry) => entry.portId === selected.endpoint.portId)?.name
    : undefined

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
                {selectedOutletName ? (
                  <div className="mt-1 text-xs font-semibold text-[#75695d]">{selectedOutletName}</div>
                ) : null}
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
