import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { flexRender } from '@tanstack/react-table'
import { getCoreRowModel, useLegacyTable, type LegacyColumnDef } from '@tanstack/react-table/legacy'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ArrowUpDown, Link, Server, TriangleAlert, type LucideIcon } from 'lucide-react'
import { ComputeHostIcon } from '@/components/compute-host-icon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SYSTEMS_COLUMN_LABELS } from '@/components/workbook/systems/systems-columns'
import { shouldVirtualizeSystems, systemsColumnTrack } from '@/components/workbook/systems/systems-table-model'
import type { SystemsSortDirection, SystemsSortKey } from '@/lib/systems-preferences'
import { cn } from '@/lib/utils'
import type { SystemsColumnKey, SystemsDensity, SystemsHostRow, SystemsMemoryBreakdown, SystemsViewColumn } from '@/types/systems'
import { SystemsAgentStatus, SystemsRegistryStatus } from './systems-status'
import { SystemsUtilizationBar } from './systems-utilization-bar'

const DEFAULT_WIDTHS: Record<SystemsColumnKey, number> = {
  type: 44,
  name: 220,
  manufacturer: 190,
  cpu: 180,
  memory: 170,
  storage: 170,
  attention: 52,
  agent: 92,
  registry: 52,
  operatingSystem: 170,
  uptime: 110,
  lanIp: 130,
}

const COMPACT_COLUMNS = new Set<SystemsColumnKey>(['type', 'attention', 'agent', 'registry'])

type SortProps = Readonly<{
  sortKey: SystemsSortKey
  sortDirection: SystemsSortDirection
  onSort(key: SystemsSortKey): void
}>

type SystemsTableProps = SortProps & Readonly<{
  systems: readonly SystemsHostRow[]
  columns: readonly SystemsViewColumn[]
  density: SystemsDensity
  widths: Partial<Record<SystemsColumnKey, number>>
  selectedItemId: string | null
  onSelect(itemId: string): void
  onAttention(itemId: string): void
  onWidthsChange(widths: Partial<Record<SystemsColumnKey, number>>): void
}>

function SortButton({
  column,
  label,
  compactIcon: CompactIcon,
  ...sort
}: SortProps & { column: SystemsSortKey; label: string; compactIcon?: LucideIcon }) {
  const active = sort.sortKey === column
  const Icon = !active ? ArrowUpDown : sort.sortDirection === 'ascending' ? ArrowUp : ArrowDown
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={CompactIcon ? 'icon-sm' : 'sm'}
      className={cn(
        'h-7 max-w-full justify-start gap-1 px-0 text-[11px] font-semibold uppercase text-[#665f57] hover:bg-transparent hover:text-[#20242c]',
        CompactIcon && 'w-full justify-center gap-0.5',
      )}
      aria-label={`Sort by ${label}`}
      onClick={() => sort.onSort(column)}
    >
      {CompactIcon ? <CompactIcon className="size-3.5" /> : <span className="truncate">{label}</span>}
      <Icon className="size-3 shrink-0" />
    </Button>
  )
  if (!CompactIcon) return button
  return <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent>Sort by {label}</TooltipContent></Tooltip>
}

function MetricCell({
  label,
  value,
  kind,
  memoryBreakdown,
}: {
  label: string | null
  value: number | null
  kind: 'cpu' | 'memory' | 'storage'
  memoryBreakdown?: SystemsMemoryBreakdown | null
}) {
  return (
    <div className="min-w-0 overflow-hidden">
      <div className="truncate text-xs text-[#38342f]" title={label ?? undefined}>{label ?? 'Not assigned'}</div>
      {value == null ? null : <div className="mt-1"><SystemsUtilizationBar value={value} kind={kind} memoryBreakdown={memoryBreakdown} /></div>}
    </div>
  )
}

function formatUptime(value: number | null) {
  if (value == null || value < 0) return 'Unknown'
  const days = Math.floor(value / 86_400)
  const hours = Math.floor((value % 86_400) / 3_600)
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((value % 3_600) / 60)
  return `${hours}h ${minutes}m`
}

function TypeCell({ system }: { system: SystemsHostRow }) {
  const label = system.type === 'nas' ? 'NAS' : system.hardwareClass === 'desktop' && system.usageRole !== 'server' ? 'PC' : 'Server'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex text-[#554d44]">
          <ComputeHostIcon host={{ type: system.type, hardwareClass: system.hardwareClass ?? undefined, usageRole: system.usageRole ?? undefined }} className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function AttentionCell({ system, onOpen }: { system: SystemsHostRow; onOpen(): void }) {
  if (system.attentionCount <= 0) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-7 text-[#9a6b16] hover:bg-[#f7ebca] hover:text-[#79510d]"
      aria-label={`Open ${system.attentionCount} attention ${system.attentionCount === 1 ? 'item' : 'items'} for ${system.name}`}
      onClick={(event) => { event.stopPropagation(); onOpen() }}
    >
      <span className="text-xs font-bold tabular-nums">{system.attentionCount}</span>
    </Button>
  )
}

function cellContent(key: SystemsColumnKey, system: SystemsHostRow, onAttention: () => void) {
  switch (key) {
    case 'type': return <TypeCell system={system} />
    case 'name': return <div className="truncate font-semibold text-[#20242c]" title={system.name}>{system.name}</div>
    case 'manufacturer': return <div className="min-w-0 text-xs text-[#4f4a44]"><div className="truncate" title={system.manufacturer ?? undefined}>{system.manufacturer ?? 'Unknown manufacturer'}</div>{system.model ? <div className="truncate text-[#81786e]" title={system.model}>{system.model}</div> : null}</div>
    case 'cpu': return <MetricCell label={system.cpuLabel} value={system.cpuPercent} kind="cpu" />
    case 'memory': return <MetricCell label={system.memoryLabel} value={system.memoryPercent} kind="memory" memoryBreakdown={system.memoryBreakdown} />
    case 'storage': return <MetricCell label={system.storageLabel} value={system.storagePercent} kind="storage" />
    case 'attention': return <AttentionCell system={system} onOpen={onAttention} />
    case 'agent': return <SystemsAgentStatus system={system} />
    case 'registry': return <SystemsRegistryStatus linked={system.registryLinked} name={system.name} />
    case 'operatingSystem': return <div className="truncate text-xs" title={system.operatingSystem ?? undefined}>{system.operatingSystem ?? 'Unknown'}</div>
    case 'uptime': return <div className="truncate text-xs tabular-nums">{formatUptime(system.uptimeSeconds)}</div>
    case 'lanIp': return <div className="truncate text-xs tabular-nums" title={system.lanIp ?? undefined}>{system.lanIp ?? 'Unknown'}</div>
  }
}

function tableColumns(orderedColumns: readonly SystemsViewColumn[], onAttention: (itemId: string) => void): LegacyColumnDef<SystemsHostRow>[] {
  return orderedColumns.map((column) => ({
    id: column.key,
    accessorFn: (row) => row,
    header: SYSTEMS_COLUMN_LABELS[column.key],
    cell: ({ row }) => cellContent(column.key, row.original, () => onAttention(row.original.itemKey)),
  }))
}

function stickyStyle(key: SystemsColumnKey, widths: Record<SystemsColumnKey, number>): CSSProperties | undefined {
  if (key === 'type') return { position: 'sticky', left: 0, zIndex: 2 }
  if (key === 'name') return { position: 'sticky', left: widths.type, zIndex: 2 }
  return undefined
}

export function SystemsTable({
  systems,
  columns,
  density,
  widths: customWidths,
  selectedItemId,
  onSelect,
  onAttention,
  onWidthsChange,
  ...sort
}: SystemsTableProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const lastFocusedItem = useRef<string | null>(null)
  const previousSelectedItem = useRef(selectedItemId)
  const orderedColumns = useMemo(() => [...columns].filter((column) => column.visible).sort((left, right) => left.order - right.order), [columns])
  const widths = useMemo(() => ({ ...DEFAULT_WIDTHS, ...customWidths }), [customWidths])
  const gridTemplate = orderedColumns.map((column) => systemsColumnTrack(
    column.key,
    widths[column.key],
    customWidths[column.key] !== undefined,
  )).join(' ')
  const totalWidth = orderedColumns.reduce((total, column) => total + widths[column.key], 0)
  const definitions = useMemo(() => tableColumns(orderedColumns, onAttention), [onAttention, orderedColumns])
  const table = useLegacyTable({ data: [...systems], columns: definitions, getCoreRowModel: getCoreRowModel() })
  const rows = table.getRowModel().rows
  const rowHeight = density === 'dense' ? 48 : 64
  const virtualized = shouldVirtualizeSystems(rows.length)
  const virtualizer = useVirtualizer({
    count: virtualized ? rows.length : 0,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    initialRect: { width: 1_200, height: 640 },
  })

  useEffect(() => {
    if (previousSelectedItem.current && !selectedItemId && lastFocusedItem.current) rowRefs.current.get(lastFocusedItem.current)?.focus()
    previousSelectedItem.current = selectedItemId
  }, [selectedItemId])

  const focusRow = (index: number) => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, index))]
    if (!target) return
    if (virtualized) virtualizer.scrollToIndex(target.index, { align: 'auto' })
    requestAnimationFrame(() => rowRefs.current.get(target.original.itemKey)?.focus())
  }
  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, index: number, itemId: string) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); focusRow(index + 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusRow(index - 1) }
    else if (event.key === 'Home') { event.preventDefault(); focusRow(0) }
    else if (event.key === 'End') { event.preventDefault(); focusRow(rows.length - 1) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); lastFocusedItem.current = itemId; onSelect(itemId) }
  }
  const resizeColumn = (key: SystemsColumnKey, event: ReactPointerEvent) => {
    if (COMPACT_COLUMNS.has(key)) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = widths[key]
    const move = (moveEvent: PointerEvent) => onWidthsChange({ ...customWidths, [key]: Math.max(80, Math.min(800, startWidth + moveEvent.clientX - startX)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  if (!systems.length) {
    return <div className="grid h-full min-h-64 place-items-center px-6 text-center"><div className="max-w-sm"><Server className="mx-auto size-8 text-[#8b8175]" /><h2 className="mt-3 text-base font-semibold">No systems found</h2><p className="mt-1 text-sm text-[#756d62]">Change the current search, view, or filters.</p></div></div>
  }

  const renderRow = (row: (typeof rows)[number], style?: CSSProperties) => (
    <div
      key={row.id}
      ref={(node) => { if (node) rowRefs.current.set(row.original.itemKey, node); else rowRefs.current.delete(row.original.itemKey) }}
      role="row"
      tabIndex={0}
      aria-selected={selectedItemId === row.original.itemKey}
      data-row-key={row.original.itemKey}
      className="group grid cursor-pointer border-b border-[#e4ded5] bg-[#fffdf8] outline-none hover:bg-[#f5f1ea] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6651a3] aria-selected:bg-[#eee9f6]"
      style={{ gridTemplateColumns: gridTemplate, minWidth: totalWidth, height: rowHeight, ...style }}
      onClick={() => { lastFocusedItem.current = row.original.itemKey; onSelect(row.original.itemKey) }}
      onKeyDown={(event) => handleRowKeyDown(event, row.index, row.original.itemKey)}
    >
      {row.getVisibleCells().map((cell) => {
        const key = cell.column.id as SystemsColumnKey
        return (
          <div
            key={cell.id}
            role="cell"
            className={cn('flex min-w-0 items-center overflow-hidden px-3 py-2 text-sm', COMPACT_COLUMNS.has(key) && 'justify-center px-1 text-center', (key === 'type' || key === 'name') && (selectedItemId === row.original.itemKey ? 'bg-[#eee9f6]' : 'bg-[#fffdf8] group-hover:bg-[#f5f1ea]'))}
            style={stickyStyle(key, widths)}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        )
      })}
    </div>
  )

  const virtualItems = virtualizer.getVirtualItems()
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" role="table" aria-label="Systems" data-testid="systems-table-shell">
      <div ref={headerRef} className="shrink-0 overflow-hidden border-b border-[#d3cbc0] bg-[#eeeae3]" role="rowgroup" data-testid="systems-table-header">
        <div role="row" className="grid h-10" style={{ gridTemplateColumns: gridTemplate, minWidth: totalWidth }}>
          {table.getHeaderGroups()[0]?.headers.map((header) => {
            const key = header.column.id as SystemsColumnKey
            const CompactIcon = key === 'type' ? Server : key === 'attention' ? TriangleAlert : key === 'registry' ? Link : undefined
            return (
              <div key={header.id} role="columnheader" className={cn('group relative flex min-w-0 items-center overflow-hidden px-3', COMPACT_COLUMNS.has(key) && 'justify-center px-1 text-center', (key === 'type' || key === 'name') && 'bg-[#eeeae3]')} style={stickyStyle(key, widths)}>
                <SortButton column={key} label={SYSTEMS_COLUMN_LABELS[key]} compactIcon={CompactIcon} {...sort} />
                {COMPACT_COLUMNS.has(key) ? null : (
                  <button
                    type="button"
                    aria-label={`Resize ${SYSTEMS_COLUMN_LABELS[key]} column`}
                    className="absolute inset-y-1 right-0 w-1 cursor-col-resize rounded bg-transparent hover:bg-[#8071aa] focus-visible:bg-[#8071aa]"
                    onPointerDown={(event) => resizeColumn(key, event)}
                    onDoubleClick={() => { const next = { ...customWidths }; delete next[key]; onWidthsChange(next) }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto" role="rowgroup" data-testid="systems-table-body" onScroll={(event) => { if (headerRef.current) headerRef.current.scrollLeft = event.currentTarget.scrollLeft }}>
        {virtualized ? (
          <div className="relative" style={{ height: virtualizer.getTotalSize(), minWidth: totalWidth }}>
            {virtualItems.map((virtualRow) => renderRow(rows[virtualRow.index], { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }))}
          </div>
        ) : rows.map((row) => renderRow(row))}
      </div>
    </div>
  )
}
