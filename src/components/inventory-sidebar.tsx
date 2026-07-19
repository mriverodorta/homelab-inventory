import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  Archive,
  ChevronDown,
  Cpu,
  Database,
  HardDrive,
  ListChecks,
  MemoryStick,
  MonitorUp,
  Network,
  Plus,
  RotateCcw,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { InventoryActionsMenu } from '@/components/inventory-actions-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InventoryItemDialog } from '@/components/inventory-item-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatPortSummary, formatRamSpec } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { isArchivedItem } from '@/lib/project'
import { cn } from '@/lib/utils'
import { filterAndSortInventory, isItemAssigned } from '@/lib/sort'
import type { InventoryItemInput } from '@/lib/db'
import type { InventoryFilters, InventoryStatusFilter } from '@/lib/sort'
import type { InventoryItem, InventoryType, ProjectState } from '@/types/inventory'

const TYPE_LABELS: Record<InventoryType, string> = {
  server: 'Server',
  nas: 'NAS',
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'Storage',
  gpu: 'GPU',
  network: 'Network',
  switch: 'Switch',
  patchPanel: 'Patch Panel',
}

const TYPE_ORDER: InventoryType[] = [
  'server',
  'nas',
  'switch',
  'patchPanel',
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
]

const TYPE_COLORS: Record<InventoryType, string> = {
  server: 'border-l-[#adc19b]',
  nas: 'border-l-[#9eb6c8]',
  cpu: 'border-l-[#8bb3bd]',
  ram: 'border-l-[#ddb668]',
  storage: 'border-l-[#b5a58f]',
  gpu: 'border-l-[#d57b69]',
  network: 'border-l-[#86a989]',
  switch: 'border-l-[#81a6a0]',
  patchPanel: 'border-l-[#a995c8]',
}

function TypeIcon({ type }: { type: InventoryType }) {
  const className = 'size-4'

  if (type === 'server') {
    return <Server className={className} />
  }

  if (type === 'nas') {
    return <Database className={className} />
  }

  if (type === 'cpu') {
    return <Cpu className={className} />
  }

  if (type === 'ram') {
    return <MemoryStick className={className} />
  }

  if (type === 'storage') {
    return <HardDrive className={className} />
  }

  if (type === 'gpu') {
    return <MonitorUp className={className} />
  }

  if (type === 'switch') {
    return <Network className={className} />
  }

  if (type === 'patchPanel') {
    return <Server className={className} />
  }

  return <Network className={className} />
}

function compactSpec(item: InventoryItem): string | null {
  const specs = item.specs ?? {}

  if (item.type === 'ram') {
    return formatRamSpec(item)
  }

  if (item.type === 'storage') {
    return null
  }

  if (item.type === 'network') {
    return `${specs.speedMbps ?? '?'}Mbps / ${specs.formFactor ?? 'network'}`
  }

  if (item.type === 'cpu') {
    return `${specs.cores ?? '?'}C/${specs.threads ?? '?'}T`
  }

  if (item.type === 'gpu') {
    return `${specs.vramGb ?? '?'}GB VRAM`
  }

  if (item.type === 'nas') {
    return `${specs.driveBays ?? '?'} bays / ${specs.m2Slots ?? 0} M.2`
  }

  if (item.type === 'switch' || item.type === 'patchPanel') {
    return formatPortSummary(item)
  }

  return String(specs.formFactor ?? 'Server')
}

function DraggableInventoryItem({
  item,
  assigned,
  selectionMode,
  selected,
  onSelect,
  onToggleSelected,
  onDuplicate,
  onArchive,
  onRestore,
  onDelete,
  busy,
}: {
  item: InventoryItem
  assigned: boolean
  selectionMode: boolean
  selected: boolean
  onSelect: (itemId: string) => void
  onToggleSelected: (itemId: string) => void
  onDuplicate: (item: InventoryItem) => void
  onArchive: (item: InventoryItem) => void
  onRestore: (item: InventoryItem) => void
  onDelete: (item: InventoryItem) => void
  busy: boolean
}) {
  const itemRuntimeKey = runtimeItemKey(item)
  const archived = isArchivedItem(item)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `inventory:${itemRuntimeKey}`,
    data: {
      kind: 'inventory',
      itemId: itemRuntimeKey,
    },
    disabled: assigned || archived || selectionMode,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    touchAction: 'pan-y',
    WebkitTouchCallout: 'none',
  } satisfies CSSProperties
  const itemSpec = compactSpec(item)

  return (
    <div className="relative">
      <button
        ref={setNodeRef}
        type="button"
        data-testid="inventory-item"
        data-inventory-item-id={itemRuntimeKey}
        style={style}
        className={`w-full rounded-md border border-white/10 border-l-4 bg-[#303642] px-3 py-2 pr-11 text-left text-[#f7f1e8] shadow-sm transition hover:bg-[#394150] ${archived ? 'opacity-65' : ''} ${selected ? 'ring-2 ring-[#ddb668]' : ''} ${TYPE_COLORS[item.type]} ${isDragging ? 'opacity-60' : ''}`}
        onClick={() => selectionMode ? onToggleSelected(itemRuntimeKey) : !archived && onSelect(itemRuntimeKey)}
        aria-pressed={selectionMode ? selected : undefined}
        {...(!assigned && !archived && !selectionMode ? listeners : {})}
        {...(!assigned && !archived && !selectionMode ? attributes : {})}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{item.name}</div>
            {itemSpec ? <div className="mt-0.5 truncate text-xs text-[#cfc6b8]">{itemSpec}</div> : null}
          </div>
          <TypeIcon type={item.type} />
        </div>
        {assigned || archived ? (
          <Badge variant="outline" className="mt-2 border-white/20 text-[10px] text-[#d8d0c5]">
            {archived ? 'Archived' : 'Assigned'}
          </Badge>
        ) : null}
      </button>
      {selectionMode ? (
        <input
          type="checkbox"
          aria-label={`Select ${item.name}`}
          checked={selected}
          onChange={() => onToggleSelected(itemRuntimeKey)}
          className="absolute right-3 top-1/2 size-4 -translate-y-1/2 accent-[#ddb668]"
        />
      ) : archived ? (
        <InventoryActionsMenu
          archived
          itemName={item.name}
          busy={busy}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#f7f1e8]"
          onRestore={() => onRestore(item)}
          onDelete={() => onDelete(item)}
        />
      ) : (
        <InventoryActionsMenu
          itemName={item.name}
          busy={busy}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#f7f1e8]"
          onEdit={() => onSelect(itemRuntimeKey)}
          onDuplicate={() => onDuplicate(item)}
          onArchive={() => onArchive(item)}
        />
      )}
    </div>
  )
}

export function InventorySidebar({
  project,
  onSelect,
  onCreateItem,
  onDuplicateItem = () => undefined,
  onArchiveItems = () => undefined,
  onRestoreItems = () => undefined,
  onDeleteItems = () => undefined,
  lifecycleRevision = 0,
  lifecycleBusy = false,
  onClose,
  width,
  className,
}: {
  project: ProjectState
  onSelect: (itemId: string) => void
  onCreateItem: (item: InventoryItemInput, quantity: number) => Promise<void>
  onDuplicateItem?: (item: InventoryItem) => void
  onArchiveItems?: (items: InventoryItem[]) => void
  onRestoreItems?: (items: InventoryItem[]) => void
  onDeleteItems?: (items: InventoryItem[]) => void
  lifecycleRevision?: number
  lifecycleBusy?: boolean
  onClose?: () => void
  width?: number
  className?: string
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [filters, setFilters] = useState<InventoryFilters>({
    query: '',
    type: 'all',
    status: 'available',
    sort: 'type',
  })
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set())
  const [collapsedTypes, setCollapsedTypes] = useState<Set<InventoryType>>(() => new Set())
  const items = filterAndSortInventory(project, filters)
  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIds.has(runtimeItemKey(item))),
    [items, selectedItemIds],
  )
  const allVisibleSelected = items.length > 0
    && items.every((item) => selectedItemIds.has(runtimeItemKey(item)))
  const allSelectedArchived = selectedItems.length > 0 && selectedItems.every(isArchivedItem)
  const allSelectedActive = selectedItems.length > 0 && selectedItems.every((item) => !isArchivedItem(item))
  const grouped = useMemo(
    () =>
      TYPE_ORDER.map((type) => ({
        type,
        items: items.filter((item) => item.type === type),
      })).filter((group) => group.items.length > 0),
    [items],
  )

  useEffect(() => {
    setSelectedItemIds(new Set())
  }, [lifecycleRevision])

  function toggleSelectionMode() {
    setSelectionMode((current) => !current)
    setSelectedItemIds(new Set())
  }

  function toggleSelected(itemId: string) {
    setSelectedItemIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  function selectVisibleItems() {
    setSelectedItemIds((current) => {
      const next = new Set(current)

      if (allVisibleSelected) {
        for (const item of items) next.delete(runtimeItemKey(item))
      } else {
        for (const item of items) next.add(runtimeItemKey(item))
      }

      return next
    })
  }

  function toggleType(type: InventoryType) {
    setCollapsedTypes((current) => {
      const next = new Set(current)

      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }

      return next
    })
  }

  return (
    <aside
      className={cn("flex min-h-0 shrink-0 flex-col bg-[#20242c] text-[#f7f1e8]", className)}
      style={width ? { width } : undefined}
    >
      <div className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight">Homelab Inventory</h1>
            <p className="text-xs text-[#cfc6b8]">Local hardware workbench</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className={cn(
                'shrink-0',
                selectionMode
                  ? 'bg-[#ddb668] text-[#20242c] hover:bg-[#e5c47d] hover:text-[#20242c]'
                  : 'text-[#f7f1e8] hover:bg-white/10 hover:text-[#f7f1e8]',
              )}
              aria-label={selectionMode ? 'Exit inventory selection' : 'Select inventory items'}
              aria-pressed={selectionMode}
              onClick={toggleSelectionMode}
            >
              <ListChecks className="size-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 bg-[#f7f1e8] text-[#20242c] hover:bg-[#e9dcc8]"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="size-3.5" />
              Add
            </Button>
            {onClose ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="shrink-0 text-[#f7f1e8] hover:bg-white/10 hover:text-[#f7f1e8]"
                aria-label="Close inventory"
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[#b9b0a4]" />
          <Input
            value={filters.query}
            placeholder="Search inventory"
            className="h-9 border-white/10 bg-[#11151b] pl-9 text-[#f7f1e8] placeholder:text-[#8d857b]"
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Select
            value={filters.type}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, type: value as InventoryType | 'all' }))
            }
          >
            <SelectTrigger className="h-9 border-white/10 bg-[#11151b] text-xs text-[#f7f1e8]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPE_ORDER.map((type) => (
                <SelectItem key={type} value={type}>
                  {TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.status}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, status: value as InventoryStatusFilter }))
            }
          >
            <SelectTrigger className="h-9 border-white/10 bg-[#11151b] text-xs text-[#f7f1e8]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {selectionMode ? (
          <div className="mt-3 rounded-md border border-white/10 bg-[#11151b] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#d8d0c5]">
                {selectedItems.length} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-[#f7f1e8] hover:bg-white/10 hover:text-[#f7f1e8]"
                onClick={selectVisibleItems}
              >
                {allVisibleSelected ? 'Clear visible' : 'Select visible'}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {allSelectedActive ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={lifecycleBusy}
                  onClick={() => onArchiveItems(selectedItems)}
                >
                  <Archive className="size-3.5" />
                  Archive
                </Button>
              ) : null}
              {allSelectedArchived ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={lifecycleBusy}
                    onClick={() => onRestoreItems(selectedItems)}
                  >
                    <RotateCcw className="size-3.5" />
                    Restore
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={lifecycleBusy}
                    onClick={() => onDeleteItems(selectedItems)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </>
              ) : null}
              {selectedItems.length > 0 && !allSelectedActive && !allSelectedArchived ? (
                <p className="text-xs text-amber-300">Select only active or only archived items.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="box-border w-[calc(100%-24px)] space-y-5 py-4 pl-4 pr-2">
          {grouped.map((group) => (
            <section key={group.type} className="rounded-md">
              <button
                type="button"
                className="mb-2 flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#b9b0a4] transition hover:bg-white/5 hover:text-[#f7f1e8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#adc19b]"
                aria-expanded={!collapsedTypes.has(group.type)}
                aria-controls={`inventory-group-${group.type}`}
                onClick={() => toggleType(group.type)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <TypeIcon type={group.type} />
                  <span>{TYPE_LABELS[group.type]}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-normal text-[#d8d0c5]">
                    {group.items.length}
                  </span>
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 transition-transform ${
                    collapsedTypes.has(group.type) ? '-rotate-90' : 'rotate-0'
                  }`}
                />
              </button>
              {!collapsedTypes.has(group.type) ? (
                <div id={`inventory-group-${group.type}`} className="space-y-2">
                  {group.items.map((item) => (
                    <DraggableInventoryItem
                      key={runtimeItemKey(item)}
                      item={item}
                      assigned={isItemAssigned(project, item)}
                      selectionMode={selectionMode}
                      selected={selectedItemIds.has(runtimeItemKey(item))}
                      onSelect={onSelect}
                      onToggleSelected={toggleSelected}
                      onDuplicate={onDuplicateItem}
                      onArchive={(selectedItem) => onArchiveItems([selectedItem])}
                      onRestore={(selectedItem) => onRestoreItems([selectedItem])}
                      onDelete={(selectedItem) => onDeleteItems([selectedItem])}
                      busy={lifecycleBusy}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ))}
          {grouped.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-[#11151b] p-4 text-sm text-[#cfc6b8]">
              No inventory items match the current filters.
            </div>
          ) : null}
        </div>
      </ScrollArea>
      <InventoryItemDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onCreate={onCreateItem}
      />
    </aside>
  )
}
