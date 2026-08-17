import { useMemo, useState } from 'react'
import { ExternalLink, Search, Server, Share2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getAgentHostStatus } from '@/components/inspector/agent/server-agent-status'
import {
  manufacturerModelLabel,
  physicalClassLabel,
  usageRoleLabel,
} from '@/components/workbook/systems-table-columns'
import { runtimeItemKey } from '@/lib/item-keys'
import type { AgentState, AgentStatusSummary } from '@/types/agent'
import type { InventoryItem, ProjectState } from '@/types/inventory'
import { cn } from '@/lib/utils'
import { ComputeHostIcon } from '@/components/compute-host-icon'

const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])

function agentTone(state: AgentState) {
  if (state === 'online') return 'bg-[#dceee7] text-[#285b48] border-[#a9cebf]'
  if (state === 'stale') return 'bg-[#fff1ce] text-[#735119] border-[#dfc47e]'
  if (state === 'offline') return 'bg-[#f9e3de] text-[#853b31] border-[#dfb1a8]'
  return 'bg-[#efede8] text-[#6e675f] border-[#d5cfc5]'
}

type SystemsWorkspaceProps = {
  project: ProjectState
  agentStatus: AgentStatusSummary | null
  registryLinkedItemKeys: ReadonlySet<string>
  onSelectItem(itemId: string): void
}

export function SystemsWorkspace({
  project,
  agentStatus,
  registryLinkedItemKeys,
  onSelectItem,
}: SystemsWorkspaceProps) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'server' | 'nas' | 'pcBuild'>('all')
  const hosts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return Object.values(project.items)
      .filter((item) => HOST_TYPES.has(item.type) && !item.archivedAt)
      .filter((item) => typeFilter === 'all' || item.type === typeFilter)
      .filter((item) => {
        if (!normalized) return true
        return [item.name, item.manufacturer, item.model, item.hardwareClass, item.usageRole]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(normalized))
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [project.items, query, typeFilter])

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden bg-[#f8f6f1]">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d8d0c5] bg-[#fffdf8] px-5 pb-4 pt-16 lg:px-7">
          <div>
            <h1 className="text-xl font-semibold text-[#20242c]">Systems</h1>
            <p className="mt-1 text-sm text-[#756d62]">Compute hosts available to this project.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[#81786e]" />
              <Input
                value={query}
                className="h-9 w-[min(260px,70vw)] bg-white pl-8"
                placeholder="Search systems"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex h-9 items-center rounded-md border border-[#d1c8bc] bg-white p-0.5" aria-label="System type filter">
              {(['all', 'server', 'nas', 'pcBuild'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={cn(
                    'h-7 rounded px-2 text-xs font-medium text-[#6f675f]',
                    typeFilter === type && 'bg-[#292d33] text-white',
                  )}
                  onClick={() => setTypeFilter(type)}
                >
                  {type === 'pcBuild' ? 'PC' : type === 'all' ? 'All' : type === 'nas' ? 'NAS' : 'Server'}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {hosts.length ? (
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#eeeae3] text-[11px] font-semibold uppercase text-[#736b62]">
                <tr>
                  <th className="border-b border-[#d3cbc0] px-5 py-2.5">Name</th>
                  <th className="border-b border-[#d3cbc0] px-4 py-2.5">Physical class</th>
                  <th className="border-b border-[#d3cbc0] px-4 py-2.5">Usage role</th>
                  <th className="border-b border-[#d3cbc0] px-4 py-2.5">Manufacturer / model</th>
                  <th className="border-b border-[#d3cbc0] px-4 py-2.5">Agent</th>
                  <th className="border-b border-[#d3cbc0] px-4 py-2.5">Registry</th>
                  <th className="w-12 border-b border-[#d3cbc0] px-3 py-2.5"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((host) => (
                  <SystemRow
                    key={runtimeItemKey(host)}
                    host={host}
                    project={project}
                    agentStatus={agentStatus}
                    registryLinked={registryLinkedItemKeys.has(runtimeItemKey(host))}
                    onSelect={() => onSelectItem(runtimeItemKey(host))}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid h-full min-h-64 place-items-center px-6 text-center">
              <div className="max-w-sm">
                <Server className="mx-auto size-8 text-[#8b8175]" />
                <h2 className="mt-3 text-base font-semibold">No systems found</h2>
                <p className="mt-1 text-sm text-[#756d62]">
                  Add a server, NAS, or custom PC to this project, or change the current filters.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function SystemRow({
  host,
  project,
  agentStatus,
  registryLinked,
  onSelect,
}: {
  host: InventoryItem
  project: ProjectState
  agentStatus: AgentStatusSummary | null
  registryLinked: boolean
  onSelect(): void
}) {
  const runtimeKey = runtimeItemKey(host)
  const status = getAgentHostStatus(agentStatus, host.type as 'server' | 'nas' | 'pcBuild', host.id)
  const assignedComponents = project.assignments.filter((assignment) => assignment.serverId === runtimeKey).length

  return (
    <tr className="border-b border-[#e4ded5] bg-[#fffdf8] hover:bg-[#f5f1ea]">
      <td className="px-5 py-3">
        <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={onSelect}>
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#e8e2d8] text-[#554d44]">
            <ComputeHostIcon host={host} className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block max-w-[320px] truncate font-semibold text-[#20242c]">{host.name}</span>
            <span className="block text-xs text-[#81786e]">{assignedComponents} assigned component{assignedComponents === 1 ? '' : 's'}</span>
          </span>
        </button>
      </td>
      <td className="px-4 py-3 text-[#4f4a44]">{physicalClassLabel(host)}</td>
      <td className="px-4 py-3 text-[#4f4a44]">{usageRoleLabel(host)}</td>
      <td className="px-4 py-3 text-[#4f4a44]">{manufacturerModelLabel(host)}</td>
      <td className="px-4 py-3"><Badge variant="outline" className={agentTone(status.state)}>{status.state}</Badge></td>
      <td className="px-4 py-3">
        {registryLinked ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4e655d]"><Share2 className="size-3.5" /> Linked</span>
        ) : <span className="text-xs text-[#948b80]">Local</span>}
      </td>
      <td className="px-3 py-3">
        <Button size="icon-sm" variant="ghost" aria-label={`Open ${host.name}`} onClick={onSelect}><ExternalLink /></Button>
      </td>
    </tr>
  )
}
