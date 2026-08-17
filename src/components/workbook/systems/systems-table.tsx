import { ArrowDown, ArrowUp, ArrowUpDown, Link, Server, type LucideIcon } from 'lucide-react'
import { ComputeHostIcon } from '@/components/compute-host-icon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SystemsSortDirection, SystemsSortKey } from '@/lib/systems-preferences'
import { cn } from '@/lib/utils'
import type { SystemsHostRow } from '@/types/systems'
import { SystemsAgentStatus, SystemsRegistryStatus } from './systems-status'
import { SystemsUtilizationBar } from './systems-utilization-bar'

type SortProps = Readonly<{
  sortKey: SystemsSortKey
  sortDirection: SystemsSortDirection
  onSort(key: SystemsSortKey): void
}>

function SortButton({
  column,
  label,
  compactIcon: CompactIcon,
  ...sort
}: SortProps & { column: SystemsSortKey; label: string; compactIcon?: LucideIcon }) {
  const active = sort.sortKey === column
  const Icon = !active ? ArrowUpDown : sort.sortDirection === 'ascending' ? ArrowUp : ArrowDown
  const compact = Boolean(CompactIcon)
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={compact ? 'icon-sm' : 'sm'}
      className={cn('h-7 text-[11px] font-semibold uppercase text-[#665f57] hover:bg-[#e2ddd5]', compact ? 'w-10 gap-0.5' : '-ml-2 gap-1')}
      aria-label={`Sort by ${label}`}
      onClick={() => sort.onSort(column)}
    >
      {CompactIcon ? <CompactIcon className="size-3.5" /> : label}
      <Icon className="size-3" />
    </Button>
  )
  if (!compact) return button
  return <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent>Sort by {label}</TooltipContent></Tooltip>
}

function MetricCell({ label, value, kind }: { label: string | null; value: number | null; kind: 'cpu' | 'memory' | 'storage' }) {
  return (
    <div className="min-w-24 max-w-64 overflow-hidden">
      <div className="truncate text-xs text-[#38342f]" title={label ?? undefined}>{label ?? 'Not assigned'}</div>
      {value == null ? null : <div className="mt-1"><SystemsUtilizationBar value={value} kind={kind} /></div>}
    </div>
  )
}

export function SystemsTable({
  systems,
  selectedItemId,
  onSelect,
  ...sort
}: {
  systems: readonly SystemsHostRow[]
  selectedItemId: string | null
  onSelect(itemId: string): void
} & SortProps) {
  if (!systems.length) {
    return (
      <div className="grid h-full min-h-64 place-items-center px-6 text-center">
        <div className="max-w-sm">
          <Server className="mx-auto size-8 text-[#8b8175]" />
          <h2 className="mt-3 text-base font-semibold">No systems found</h2>
          <p className="mt-1 text-sm text-[#756d62]">Change the current search or filters.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[1040px] table-auto border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[#eeeae3]">
          <tr>
            <th className="w-px border-b border-[#d3cbc0] px-2 py-1.5"><SortButton column="type" label="type" compactIcon={Server} {...sort} /></th>
            <th className="border-b border-[#d3cbc0] px-3 py-1.5"><SortButton column="name" label="Name" {...sort} /></th>
            <th className="border-b border-[#d3cbc0] px-3 py-1.5"><SortButton column="manufacturer" label="Manufacturer / model" {...sort} /></th>
            <th className="border-b border-[#d3cbc0] px-3 py-1.5"><SortButton column="cpu" label="CPU" {...sort} /></th>
            <th className="border-b border-[#d3cbc0] px-3 py-1.5"><SortButton column="memory" label="RAM" {...sort} /></th>
            <th className="border-b border-[#d3cbc0] px-3 py-1.5"><SortButton column="storage" label="Storage" {...sort} /></th>
            <th className="w-px border-b border-[#d3cbc0] px-3 py-1.5"><SortButton column="agent" label="Agent" {...sort} /></th>
            <th className="w-px border-b border-[#d3cbc0] px-2 py-1.5"><SortButton column="registry" label="registry" compactIcon={Link} {...sort} /></th>
          </tr>
        </thead>
        <tbody>
          {systems.map((system) => (
            <tr
              key={system.itemId}
              tabIndex={0}
              aria-selected={selectedItemId === system.itemKey}
              className="cursor-pointer border-b border-[#e4ded5] bg-[#fffdf8] outline-none hover:bg-[#f5f1ea] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6651a3] aria-selected:bg-[#eee9f6]"
              onClick={() => onSelect(system.itemKey)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelect(system.itemKey)
              }}
            >
              <td className="w-px overflow-hidden px-3 py-2.5">
                <Tooltip><TooltipTrigger asChild><span className="inline-flex text-[#554d44]"><ComputeHostIcon host={{ type: system.type, hardwareClass: system.hardwareClass ?? undefined, usageRole: system.usageRole ?? undefined }} className="size-4" /></span></TooltipTrigger><TooltipContent>{system.type === 'nas' ? 'NAS' : system.hardwareClass === 'desktop' && system.usageRole !== 'server' ? 'PC' : 'Server'}</TooltipContent></Tooltip>
              </td>
              <td className="max-w-72 overflow-hidden px-3 py-2.5"><div className="truncate font-semibold text-[#20242c]" title={system.name}>{system.name}</div></td>
              <td className="max-w-64 overflow-hidden px-3 py-2.5 text-xs text-[#4f4a44]">
                <div className="truncate" title={system.manufacturer ?? undefined}>{system.manufacturer ?? 'Unknown manufacturer'}</div>
                {system.model ? <div className="truncate text-[#81786e]" title={system.model}>{system.model}</div> : null}
              </td>
              <td className="overflow-hidden px-3 py-2.5"><MetricCell label={system.cpuLabel} value={system.cpuPercent} kind="cpu" /></td>
              <td className="overflow-hidden px-3 py-2.5"><MetricCell label={system.memoryLabel} value={system.memoryPercent} kind="memory" /></td>
              <td className="overflow-hidden px-3 py-2.5"><MetricCell label={system.storageLabel} value={system.storagePercent} kind="storage" /></td>
              <td className="w-px overflow-hidden px-3 py-2.5"><SystemsAgentStatus system={system} /></td>
              <td className="w-px overflow-hidden px-3 py-2.5"><SystemsRegistryStatus linked={system.registryLinked} name={system.name} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
