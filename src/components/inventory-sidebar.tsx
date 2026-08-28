import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Archive,
  AudioLines,
  BatteryCharging,
  Box,
  ChevronDown,
  CircuitBoard,
  Cpu,
  Fan,
  HardDrive,
  ListChecks,
  MemoryStick,
  Monitor,
  MonitorUp,
  Network,
  Plug,
  Plus,
  Power,
  RotateCcw,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { InventoryActionsMenu } from '@/components/inventory-actions-menu'
import { InventoryMetadataFilters } from '@/components/inventory/inventory-metadata-filters'
import { InventoryTagPreview } from '@/components/inventory/inventory-tag-preview'
import {
  useInventorySidebarController,
  type InventorySidebarController,
} from '@/components/inventory/use-inventory-sidebar-controller'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InventoryItemDialog } from '@/components/inventory/lazy-inventory-item-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatInventoryCompactSpec } from '@/lib/format'
import {
  getInventoryDragRole,
  isCanvasEquipmentType,
} from '@/lib/inventory-capabilities'
import { INVENTORY_CATEGORY_ORDER, INVENTORY_TYPE_LABELS } from '@/lib/inventory'
import { runtimeItemKey } from '@/lib/item-keys'
import { createInventoryVirtualRows } from '@/lib/inventory-virtual-rows'
import { isArchivedItem } from '@/lib/project'
import { cn } from '@/lib/utils'
import { filterAndSortInventory, isItemAssigned } from '@/lib/sort'
import type { AvailableGlobalInventoryItem, InventoryItemInput } from '@/lib/db'
import type { InventoryStatusFilter } from '@/lib/sort'
import type { InventoryItem, InventoryType, ProjectState } from '@/types/inventory'
import {
  readyInventoryMetadataFilters,
  type InventoryItemMetadataInput,
  type InventoryMetadataProjectionRow,
} from '@/types/inventory-metadata'
import { DEFAULT_REGISTRY_STATE, type RegistryState } from '@/types/registry'
import { usePermission } from '@/hooks/use-permission'
import { useInventoryMetadataCatalog, useInventoryMetadataProjectProjection } from '@/lib/inventory-metadata-query'
import { prefetchCatalogFacets } from '@/hooks/use-registry'
import { ComputeHostIcon } from '@/components/compute-host-icon'

const TYPE_COLORS: Record<InventoryType, string> = {
  server: 'border-l-[#adc19b]',
  pcBuild: 'border-l-[#8fa9bf]',
  cpu: 'border-l-[#8bb3bd]',
  cpuCooler: 'border-l-[#9fc7c1]',
  motherboard: 'border-l-[#789ca5]',
  ram: 'border-l-[#ddb668]',
  storage: 'border-l-[#b5a58f]',
  gpu: 'border-l-[#d57b69]',
  network: 'border-l-[#86a989]',
  soundCard: 'border-l-[#b29ac7]',
  case: 'border-l-[#9ca3af]',
  powerSupply: 'border-l-[#d3a45f]',
  powerAdapter: 'border-l-[#c99972]',
  nas: 'border-l-[#9eb6c8]',
  switch: 'border-l-[#81a6a0]',
  patchPanel: 'border-l-[#a995c8]',
  monitor: 'border-l-[#7797b8]',
  ups: 'border-l-[#c49a58]',
  powerStrip: 'border-l-[#b18a6b]',
}

function TypeIcon({ type, item }: { type: InventoryType; item?: InventoryItem }) {
  const className = 'size-4'

  if (type === 'server' || type === 'pcBuild' || type === 'nas') {
    return <ComputeHostIcon host={item ?? { type }} className={className} />
  }
  if (type === 'cpu') return <Cpu className={className} />
  if (type === 'cpuCooler') return <Fan className={className} />
  if (type === 'motherboard') return <CircuitBoard className={className} />
  if (type === 'ram') return <MemoryStick className={className} />
  if (type === 'storage') return <HardDrive className={className} />
  if (type === 'gpu') return <MonitorUp className={className} />
  if (type === 'network' || type === 'switch') return <Network className={className} />
  if (type === 'soundCard') return <AudioLines className={className} />
  if (type === 'case') return <Box className={className} />
  if (type === 'powerSupply') return <Power className={className} />
  if (type === 'powerAdapter' || type === 'powerStrip') return <Plug className={className} />
  if (type === 'patchPanel') return <Server className={className} />
  if (type === 'monitor') return <Monitor className={className} />
  if (type === 'ups') return <BatteryCharging className={className} />

  return <Server className={className} />
}

function DraggableInventoryItem({
  item,
  assigned,
  selectionMode,
  selected,
  onSelect,
  onToggleSelected,
  onDuplicate,
  onDuplicateToProject,
  onChangeScope,
  onRemoveFromProject,
  onArchive,
  onSaveAsTemplate,
  onRestore,
  onDelete,
  canEdit,
  canDuplicate,
  canArchive,
  canDelete,
  canDrag,
  busy,
  metadata,
}: {
  item: InventoryItem
  assigned: boolean
  selectionMode: boolean
  selected: boolean
  onSelect: (itemId: string) => void
  onToggleSelected: (itemId: string) => void
  onDuplicate: (item: InventoryItem) => void
  onDuplicateToProject: (item: InventoryItem) => void
  onChangeScope: (item: InventoryItem, scope: 'global' | 'project') => void
  onRemoveFromProject: (item: InventoryItem) => void
  onArchive: (item: InventoryItem) => void
  onSaveAsTemplate?: (item: InventoryItem) => void
  onRestore: (item: InventoryItem) => void
  onDelete: (item: InventoryItem) => void
  busy: boolean
  canEdit: boolean
  canDuplicate: boolean
  canArchive: boolean
  canDelete: boolean
  canDrag: boolean
  metadata?: InventoryMetadataProjectionRow
}) {
  const itemRuntimeKey = runtimeItemKey(item)
  const archived = isArchivedItem(item)
  const dragRole = getInventoryDragRole(item.type)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `inventory:${itemRuntimeKey}`,
    data: {
      kind: 'inventory',
      itemId: itemRuntimeKey,
      inventoryRole: dragRole,
    },
    disabled: assigned || archived || selectionMode || dragRole === null || !canDrag,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    touchAction: 'pan-y',
    WebkitTouchCallout: 'none',
  } satisfies CSSProperties
  const itemSpec = formatInventoryCompactSpec(item)

  return (
    <div className="relative">
      <button
        ref={setNodeRef}
        type="button"
        data-testid="inventory-item"
        data-inventory-item-id={itemRuntimeKey}
        data-inventory-drag-role={dragRole ?? undefined}
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
            {metadata?.tags.length ? <InventoryTagPreview tags={metadata.tags} compact /> : null}
            {itemSpec ? <div className="mt-0.5 truncate text-xs text-[#cfc6b8]">{itemSpec}</div> : null}
          </div>
          <TypeIcon type={item.type} item={item} />
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
          onRestore={canArchive ? () => onRestore(item) : undefined}
          onDelete={canDelete ? () => onDelete(item) : undefined}
        />
      ) : (
        <InventoryActionsMenu
          itemName={item.name}
          busy={busy}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#f7f1e8]"
          onEdit={canEdit ? () => onSelect(itemRuntimeKey) : undefined}
          onDuplicate={canDuplicate ? () => onDuplicate(item) : undefined}
          onDuplicateToProject={canDuplicate ? () => onDuplicateToProject(item) : undefined}
          onMakeGlobal={canEdit && item.scope === 'project' ? () => onChangeScope(item, 'global') : undefined}
          onMakeProjectBound={canEdit && item.scope === 'global' ? () => onChangeScope(item, 'project') : undefined}
          onRemoveFromProject={canEdit && item.scope === 'global' ? () => onRemoveFromProject(item) : undefined}
          onSaveAsTemplate={canEdit && onSaveAsTemplate ? () => onSaveAsTemplate(item) : undefined}
          onArchive={canArchive ? () => onArchive(item) : undefined}
        />
      )}
    </div>
  )
}

export type InventorySidebarProps = {
  controller?: InventorySidebarController
  project: ProjectState
  onSelect: (itemId: string) => void
  onCreateItem: (item: InventoryItemInput, quantity: number, metadata?: InventoryItemMetadataInput) => Promise<void>
  onDuplicateItem?: (item: InventoryItem) => void
  onDuplicateItemToProject?: (item: InventoryItem) => void
  onChangeItemScope?: (item: InventoryItem, scope: 'global' | 'project') => void
  onRemoveGlobalItemFromProject?: (item: InventoryItem) => void
  onArchiveItems?: (items: InventoryItem[]) => void
  onRestoreItems?: (items: InventoryItem[]) => void
  onDeleteItems?: (items: InventoryItem[]) => void
  onSaveAsTemplate?: (item: InventoryItem) => void
  registry?: RegistryState
  onDuplicatePrivateTemplate?: (id: number) => Promise<void>
  onDeletePrivateTemplate?: (id: number) => Promise<void>
  onOpenRegistrySettings?: () => void
  onCreateCatalogItem?: (templateKey: string, quantity: number, usageRole?: 'server' | 'desktop' | 'workstation' | 'other') => Promise<void>
  onAddGlobalInventory?: (item: AvailableGlobalInventoryItem) => Promise<void>
  globalInventoryEnabled?: boolean
  lifecycleRevision?: number
  lifecycleBusy?: boolean
  onClose?: () => void
  width?: number
  className?: string
}

function UncontrolledInventorySidebar(props: InventorySidebarProps) {
  const controller = useInventorySidebarController('device:anonymous:project:1:workspace:2')
  return <InventorySidebarContent {...props} controller={controller} />
}

export function InventorySidebar(props: InventorySidebarProps) {
  return props.controller
    ? <InventorySidebarContent {...props} controller={props.controller} />
    : <UncontrolledInventorySidebar {...props} />
}

function InventorySidebarContent({
  controller,
  project,
  onSelect,
  onCreateItem,
  onDuplicateItem = () => undefined,
  onDuplicateItemToProject = () => undefined,
  onChangeItemScope = () => undefined,
  onRemoveGlobalItemFromProject = () => undefined,
  onArchiveItems = () => undefined,
  onRestoreItems = () => undefined,
  onDeleteItems = () => undefined,
  onSaveAsTemplate,
  registry = DEFAULT_REGISTRY_STATE,
  onDuplicatePrivateTemplate,
  onDeletePrivateTemplate,
  onOpenRegistrySettings,
  onCreateCatalogItem,
  onAddGlobalInventory,
  globalInventoryEnabled = true,
  lifecycleRevision = 0,
  lifecycleBusy = false,
  onClose,
  width,
  className,
}: InventorySidebarProps & { controller: InventorySidebarController }) {
  const queryClient = useQueryClient()
  const canCreate = usePermission('inventory.create')
  const canEdit = usePermission('inventory.edit')
  const canArchive = usePermission('inventory.archive')
  const canDelete = usePermission('inventory.delete')
  const canEditCanvas = usePermission('canvas.edit')
  const canManageRegistry = usePermission('registry.manage')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const {
    filters,
    setFilters,
    metadataFilters,
    setMetadataFilters,
    selectionMode,
    setSelectionMode,
    selectedItemIds,
    setSelectedItemIds,
    collapsedTypes,
    setCollapsedTypes,
  } = controller
  const projectId = project.metadata.projectId ?? 1
  const metadataCatalog = useInventoryMetadataCatalog()
  const readyMetadataFilters = useMemo(() => readyInventoryMetadataFilters(metadataFilters), [metadataFilters])
  const metadataProjection = useInventoryMetadataProjectProjection(projectId, {
    scope: 'inventory',
    includeSearch: true,
    filters: readyMetadataFilters,
  })
  const metadataByKey = useMemo(() => new Map(
    (metadataProjection.data?.rows ?? []).map((row) => [`${row.itemType}:${row.legacyId}`, row]),
  ), [metadataProjection.data?.rows])
  const metadataItemKeys = useMemo(() => readyMetadataFilters.length === 0
    ? null
    : new Set((metadataProjection.data?.rows ?? [])
      .filter((row) => metadataProjection.data?.matchingItemIds.includes(row.itemId))
      .map((row) => `${row.itemType}:${row.legacyId}`)), [metadataProjection.data, readyMetadataFilters.length])
  const metadataSearchText = useMemo(() => new Map(
    [...metadataByKey].map(([key, row]) => [key, row.searchText ?? '']),
  ), [metadataByKey])
  const items = filterAndSortInventory(project, { ...filters, metadataItemKeys, metadataSearchText })
  const hiddenStatusMatchCount = items.length === 0 && filters.status !== 'all'
    ? filterAndSortInventory(project, {
        ...filters,
        status: 'all',
        metadataItemKeys,
        metadataSearchText,
      }).length
    : 0
  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIds.has(runtimeItemKey(item))),
    [items, selectedItemIds],
  )
  const allVisibleSelected = items.length > 0
    && items.every((item) => selectedItemIds.has(runtimeItemKey(item)))
  const allSelectedArchived = selectedItems.length > 0 && selectedItems.every(isArchivedItem)
  const allSelectedActive = selectedItems.length > 0 && selectedItems.every((item) => !isArchivedItem(item))
  const rows = useMemo(
    () => createInventoryVirtualRows(items, collapsedTypes),
    [collapsedTypes, items],
  )
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: (index) => rows[index]?.kind === 'category' ? 45 : 88,
    getItemKey: (index) => rows[index]?.key ?? index,
    measureElement: (element) => element.getBoundingClientRect().height,
    initialRect: { width: 420, height: 640 },
    overscan: 6,
  })

  function prefetchAddInventory() {
    void InventoryItemDialog.prefetch()
    void prefetchCatalogFacets(queryClient, registry.snapshot)
  }

  useEffect(() => {
    setSelectedItemIds(new Set())
  }, [lifecycleRevision, setSelectedItemIds])

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
            {canArchive || canDelete ? <Button
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
            </Button> : null}
            {canCreate ? <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 bg-[#f7f1e8] text-[#20242c] hover:bg-[#e9dcc8]"
              onPointerEnter={prefetchAddInventory}
              onFocus={prefetchAddInventory}
              onClick={() => {
                prefetchAddInventory()
                setAddDialogOpen(true)
              }}
            >
              <Plus className="size-3.5" />
              Add
            </Button> : null}
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
              {INVENTORY_CATEGORY_ORDER.map((type) => (
                <SelectItem key={type} value={type}>
                  {INVENTORY_TYPE_LABELS[type]}
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
        {metadataCatalog.data && (metadataCatalog.data.definitions.length > 0 || metadataCatalog.data.tags.length > 0) ? (
          <div className="mt-2 flex items-center gap-2">
            <InventoryMetadataFilters
              catalog={metadataCatalog.data}
              filters={metadataFilters}
              onChange={setMetadataFilters}
              dark
            />
            {metadataProjection.isFetching ? <span className="text-xs text-[#b9b0a4]">Updating...</span> : null}
          </div>
        ) : null}
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
              {allSelectedActive && canArchive ? (
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
                  {canArchive ? <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={lifecycleBusy}
                    onClick={() => onRestoreItems(selectedItems)}
                  >
                    <RotateCcw className="size-3.5" />
                    Restore
                  </Button> : null}
                  {canDelete ? <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={lifecycleBusy}
                    onClick={() => onDeleteItems(selectedItems)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button> : null}
                </>
              ) : null}
              {selectedItems.length > 0 && !allSelectedActive && !allSelectedArchived ? (
                <p className="text-xs text-amber-300">Select only active or only archived items.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportRef={scrollViewportRef}>
        <div
          className="relative box-border w-[calc(100%-24px)] pl-4 pr-2"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null

            return (
              <div
                key={row.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute left-0 top-0 w-full pl-4 pr-2"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.kind === 'category' ? (
              <button
                type="button"
                className="mb-2 mt-4 flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#b9b0a4] transition hover:bg-white/5 hover:text-[#f7f1e8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#adc19b]"
                aria-expanded={!collapsedTypes.has(row.type)}
                onClick={() => toggleType(row.type)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <TypeIcon type={row.type} />
                  <span data-testid="inventory-category-label">{INVENTORY_TYPE_LABELS[row.type]}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-normal text-[#d8d0c5]">
                    {row.count}
                  </span>
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 transition-transform ${
                    collapsedTypes.has(row.type) ? '-rotate-90' : 'rotate-0'
                  }`}
                />
              </button>
                ) : (
                  <div className="pb-2">
                    <DraggableInventoryItem
                      item={row.item}
                      assigned={isItemAssigned(project, row.item)}
                      selectionMode={selectionMode}
                      selected={selectedItemIds.has(runtimeItemKey(row.item))}
                      onSelect={onSelect}
                      onToggleSelected={toggleSelected}
                      onDuplicate={onDuplicateItem}
                      onDuplicateToProject={onDuplicateItemToProject}
                      onChangeScope={onChangeItemScope}
                      onRemoveFromProject={onRemoveGlobalItemFromProject}
                      onArchive={(selectedItem) => onArchiveItems([selectedItem])}
                      onSaveAsTemplate={canManageRegistry ? onSaveAsTemplate : undefined}
                      onRestore={(selectedItem) => onRestoreItems([selectedItem])}
                      onDelete={(selectedItem) => onDeleteItems([selectedItem])}
                      busy={lifecycleBusy}
                      canEdit={canEdit}
                      canDuplicate={canCreate}
                      canArchive={canArchive}
                      canDelete={canDelete}
                      canDrag={isCanvasEquipmentType(row.item.type) ? canEditCanvas : canEdit}
                      metadata={metadataByKey.get(runtimeItemKey(row.item))}
                    />
                  </div>
                )}
              </div>
            )
          })}
          {rows.length === 0 ? (
            <div className="absolute left-4 right-2 top-4 rounded-md border border-white/10 bg-[#11151b] p-4 text-sm text-[#cfc6b8]">
              {hiddenStatusMatchCount > 0 ? (
                <div className="grid gap-3">
                  <p>
                    {hiddenStatusMatchCount} matching {hiddenStatusMatchCount === 1 ? 'item is' : 'items are'} hidden by the availability filter.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="w-fit rounded-md bg-[#f7f1e8] text-[#20242c] hover:bg-[#e9dcc8]"
                    onClick={() => setFilters((current) => ({ ...current, status: 'all' }))}
                  >
                    Show all
                  </Button>
                </div>
              ) : 'No inventory items match the current filters.'}
            </div>
          ) : null}
        </div>
      </ScrollArea>
      {canCreate ? <InventoryItemDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onCreate={onCreateItem}
        projectId={projectId}
        globalInventoryEnabled={globalInventoryEnabled}
        onAddGlobalInventory={onAddGlobalInventory}
        registry={registry}
        onDuplicatePrivateTemplate={onDuplicatePrivateTemplate}
        onDeletePrivateTemplate={onDeletePrivateTemplate}
        onOpenRegistrySettings={onOpenRegistrySettings}
        onCreateCatalogItem={onCreateCatalogItem}
      /> : null}
    </aside>
  )
}
