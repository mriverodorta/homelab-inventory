import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Grip, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { AssignedPowerAdapterRow } from '@/components/assigned-power-adapter-row'
import { FixedComponentCard } from '@/components/fixed-component-card'
import { AssignedExpansionHeading } from '@/components/assigned-expansion-heading'
import { AssignedItemCornerActions } from '@/components/assigned-item-corner-actions'
import { RegistryLinkIndicator } from '@/components/registry-link-indicator'
import { MemorySlotGrid } from '@/components/memory-slot-grid'
import { hostMemorySlotCount } from '@/components/memory-slot-model'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getEndpointHandleId, type CableSide } from '@/lib/cable-routing'
import { getStorageQualityTone } from '@/lib/canvas-quality'
import {
  canvasAuditWarningCount,
  canvasEndpointAvailable,
  canvasEndpointConnected,
  canvasEndpointsCompatible,
  type CanvasProjectIndex,
} from '@/lib/canvas-project-index'
import {
  formatPortSummary,
  formatPortType,
  formatCpuCanvasParts,
  formatRamCanvasParts,
  formatStorageCanvasParts,
} from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { EMPTY_REGISTRY_LINK_KEYS } from '@/lib/registry-links'
import { useTapSelection } from '@/lib/tap-selection'
import { endpointKey, NAS_CARD_WIDTH } from '@/lib/project'
import { startSelectedPortDrag } from '@/lib/port-interactions'
import { POWER_INPUT_PORT_KEY } from '@/lib/power-endpoints'
import { nasOwnsPowerEndpoint, nasPowerTopology } from '../../shared/power-ports.mjs'
import type {
  ComponentAssignment,
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'
import type { CanvasPortDragPoint } from '@/types/canvas'
import type { CompatibilityStatus } from '@/types/compatibility'
import type { StorageSlotGroup } from '@/types/compatibility'

export type NasNodeData = {
  project: ProjectState
  registryLinkedItemKeys?: ReadonlySet<string>
  canvasIndex: CanvasProjectIndex
  requiredHandleIds: ReadonlySet<string>
  itemId: string
  selectedItemId: string | null
  focusedItemIds: string[]
  focusActive: boolean
  spotlightItemId: string | null
  pendingEndpoint: ConnectionEndpoint | null
  draggingEndpoint: ConnectionEndpoint | null
  dropCompatibilityStatus?: CompatibilityStatus
  onSelect: (itemId: string) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
}

export type NasFlowNode = Node<NasNodeData, 'nas'>

const HANDLE_SIDES: Array<{ side: CableSide; position: Position }> = [
  { side: 'left', position: Position.Left },
  { side: 'right', position: Position.Right },
  { side: 'top', position: Position.Top },
  { side: 'bottom', position: Position.Bottom },
]
const EMPTY_ASSIGNMENTS: readonly ComponentAssignment[] = Object.freeze([])

function sortPorts(ports: InventoryPort[] | undefined): InventoryPort[] {
  return [...(ports ?? [])].sort((first, second) => first.slotNumber - second.slotNumber)
}

function portTone(type: InventoryPortType, speed: string | undefined, connected: boolean): string {
  const base = connected ? 'shadow-[inset_0_0_0_1px_rgba(31,35,43,0.24)]' : 'opacity-90'

  if (speed?.includes('10') || type === 'sfp-plus') {
    return `${base} bg-[#d8ddf4] text-[#15214a]`
  }

  if (speed?.includes('2.5')) {
    return `${base} bg-[#d3eee7] text-[#143733]`
  }

  if (speed?.includes('1') || type === 'rj45') {
    return `${base} bg-[#fff2c7] text-[#3d2a08]`
  }

  return `${base} bg-[#ead8f4] text-[#332047]`
}

function nicSpeedTooltipLabel(port: InventoryPort): string | null {
  if (port.type !== 'rj45' && port.type !== 'sfp' && port.type !== 'sfp-plus') {
    return null
  }

  const speed = String(port.speed ?? (port.type === 'sfp-plus' ? '10G' : '')).toLowerCase()

  if (speed.includes('10')) {
    return '10gbps'
  }

  if (speed.includes('2.5') || speed.includes('2500')) {
    return '2.5gbps'
  }

  if (speed.includes('1') || speed.includes('1000')) {
    return '1gbps'
  }

  return null
}

function portTypeChipLabel(type: InventoryPortType): string {
  if (type === 'rj45') {
    return 'NIC'
  }

  if (type === 'displayport') {
    return 'DP'
  }

  if (type === 'mini-displayport') {
    return 'MDP'
  }

  if (type === 'hdmi') {
    return 'HDMI'
  }

  if (type === 'sfp-plus') {
    return 'SFP+'
  }

  if (type === 'sfp') {
    return 'SFP'
  }

  return formatPortType(type).toUpperCase()
}

function PortChipHandles({ endpoint, requiredHandleIds }: {
  endpoint: ConnectionEndpoint
  requiredHandleIds: ReadonlySet<string>
}) {
  return (
    <>
      {HANDLE_SIDES.flatMap((handle) => {
        const targetId = getEndpointHandleId('target', handle.side, endpoint)
        const sourceId = getEndpointHandleId('source', handle.side, endpoint)

        return [
          requiredHandleIds.has(targetId) ? (
            <Handle
              key={`target-${handle.side}-${endpoint.portId}-${endpoint.endpointId ?? 'port'}`}
              id={targetId}
              type="target"
              position={handle.position}
              className="!h-2 !w-2 !border-0 !bg-transparent"
              isConnectable={false}
              isConnectableStart={false}
              isConnectableEnd={false}
            />
          ) : null,
          requiredHandleIds.has(sourceId) ? (
            <Handle
              key={`source-${handle.side}-${endpoint.portId}-${endpoint.endpointId ?? 'port'}`}
              id={sourceId}
              type="source"
              position={handle.position}
              className="!h-2 !w-2 !border-0 !bg-transparent"
              isConnectable={false}
              isConnectableStart={false}
              isConnectableEnd={false}
            />
          ) : null,
        ]
      })}
    </>
  )
}

function PortChip({
  draggingEndpoint,
  endpoint,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  pendingEndpoint,
  port,
  displaySlotNumber,
  canvasIndex,
  requiredHandleIds,
}: {
  canvasIndex: CanvasProjectIndex
  draggingEndpoint: ConnectionEndpoint | null
  endpoint: ConnectionEndpoint
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  pendingEndpoint: ConnectionEndpoint | null
  port: InventoryPort
  displaySlotNumber?: number
  requiredHandleIds: ReadonlySet<string>
}) {
  const connected = canvasEndpointConnected(canvasIndex, endpoint)
  const open = canvasEndpointAvailable(canvasIndex, endpoint)
  const sourceEndpoint = draggingEndpoint ?? pendingEndpoint
  const dragSource = draggingEndpoint ? endpointKey(draggingEndpoint) === endpointKey(endpoint) : false
  const selected = pendingEndpoint ? endpointKey(pendingEndpoint) === endpointKey(endpoint) : false
  const compatible = canvasEndpointsCompatible(canvasIndex, sourceEndpoint, endpoint)
  const activeDropTarget = Boolean(draggingEndpoint && !dragSource)
  const canStartDrag = open && selected
  const canDrop = Boolean(draggingEndpoint && !dragSource && open && compatible)
  const tooltipLabel = nicSpeedTooltipLabel(port)
  const visibleSlotNumber = displaySlotNumber ?? port.slotNumber

  const chip = (
    <div
      className={`nodrag nopan relative flex h-[30px] w-[30px] shrink-0 flex-col items-center justify-center gap-0.5 rounded text-center leading-none transition ${portTone(
        port.type,
        port.speed,
        connected,
      )} ${open ? (selected ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : 'cursor-not-allowed'} ${
        selected || dragSource ? 'ring-2 ring-[#ddb668]' : ''
      } ${activeDropTarget && canDrop ? 'ring-2 ring-[#86a989]' : ''} ${
        activeDropTarget && !canDrop ? 'opacity-35 grayscale' : ''
      }`}
      title={tooltipLabel ? undefined : `${String(visibleSlotNumber).padStart(2, '0')} ${port.speed ?? formatPortType(port.type)}`}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (!canStartDrag) {
          return
        }

        startSelectedPortDrag(event, endpoint, onEndpointDragStart)
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (!open || selected) {
          return
        }

        onEndpointClick(endpoint, {
          x: event.clientX,
          y: event.clientY,
        })
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (!canDrop) {
          return
        }

        onEndpointDrop(endpoint)
      }}
    >
      <PortChipHandles endpoint={endpoint} requiredHandleIds={requiredHandleIds} />
      <span className="text-[8px] font-black uppercase leading-none opacity-80">{portTypeChipLabel(port.type)}</span>
      <span className="text-[11px] font-black">{String(visibleSlotNumber).padStart(2, '0')}</span>
    </div>
  )

  if (!tooltipLabel) {
    return chip
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  )
}

function bayTone(item: InventoryItem | null, selected: boolean): string {
  if (selected) {
    return 'bg-[#ddb668] text-[#2b2010] ring-2 ring-white/80'
  }

  if (item) {
    return getStorageQualityTone(item)
  }

  return 'border border-dashed border-[#766e63] bg-[#2a2f39] text-[#cfc6b8]'
}

function storageFitsGroup(item: InventoryItem | undefined, group: StorageSlotGroup): boolean {
  if (!item) return false
  const itemInterface = String(item.specs?.interface ?? '').trim().toLowerCase()
  const itemFormFactor = String(item.specs?.formFactor ?? '').trim().toLowerCase()
  const interfaces = (group.interfaces ?? []).map((value) => value.trim().toLowerCase())
  const formFactors = (group.formFactors ?? []).map((value) => value.trim().toLowerCase())

  return (interfaces.length === 0 || interfaces.some((value) => itemInterface.includes(value) || value.includes(itemInterface)))
    && (formFactors.length === 0 || formFactors.some((value) => itemFormFactor.includes(value) || value.includes(itemFormFactor)))
}

function groupedStorageAssignments(
  assignments: readonly ComponentAssignment[],
  groups: readonly StorageSlotGroup[],
  project: ProjectState,
): Map<number, ComponentAssignment[]> {
  const grouped = new Map(groups.map((group) => [group.id, [] as ComponentAssignment[]]))
  const unallocated: ComponentAssignment[] = []

  for (const assignment of assignments) {
    const groupId = assignment.allocation?.resourceType === 'storage'
      ? assignment.allocation.groupId
      : undefined
    const target = groupId === undefined ? undefined : grouped.get(groupId)
    if (target) target.push(assignment)
    else unallocated.push(assignment)
  }

  for (const assignment of unallocated) {
    const item = project.items[assignment.itemId]
    const target = groups.find((group) => (
      storageFitsGroup(item, group)
      && (grouped.get(group.id)?.length ?? 0) < group.count
    )) ?? groups.find((group) => (grouped.get(group.id)?.length ?? 0) < group.count)
    if (target) grouped.get(target.id)?.push(assignment)
  }

  return grouped
}

function storageGroupType(group: StorageSlotGroup): 'drive' | 'm2' {
  const values = [...(group.interfaces ?? []), ...(group.formFactors ?? [])]
    .map((value) => value.toLowerCase())
  return values.some((value) => value.includes('nvme') || value.includes('m.2') || value.startsWith('22'))
    ? 'm2'
    : 'drive'
}

function StorageBayCell({
  assignment,
  index,
  item,
  label,
  onRemoveAssignment,
  onSelect,
  registryLinked,
  selected,
  type,
}: {
  assignment: ComponentAssignment | undefined
  index: number
  item: InventoryItem | null
  label: string
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
  registryLinked: boolean
  selected: boolean
  type: 'drive' | 'm2'
}) {
  const draggable = useDraggable({
    id: assignment ? `assignment:${assignment.id}` : `empty-nas-bay:${type}:${index}`,
    disabled: !assignment || !item,
    data: assignment && item
      ? {
          kind: 'assigned-component',
          assignmentId: assignment.id,
          itemId: assignment.itemId,
          sourceServerId: assignment.serverId,
        }
      : undefined,
  })
  const parts = item ? formatStorageCanvasParts(item).map((part) => part.value).join(' ') : null
  const itemRuntimeKey = item ? runtimeItemKey(item) : null
  const tapSelection = useTapSelection<HTMLButtonElement>((event) => {
    event.stopPropagation()

    if (item) {
      onSelect(itemRuntimeKey ?? '')
    }
  })

  return (
    <button
      ref={draggable.setNodeRef}
      type="button"
      data-storage-slot-position={index + 1}
      data-storage-slot-type={type}
      className={`group relative h-[30px] min-w-[34px] rounded px-1 text-[10px] font-black leading-none ${bayTone(
        item,
        selected,
      )} ${item ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${
        draggable.isDragging ? 'opacity-45' : ''
      }`}
      title={item ? parts ?? item.name : `Empty ${label} ${index + 1}`}
      {...draggable.listeners}
      {...tapSelection}
      {...draggable.attributes}
    >
      {String(index + 1).padStart(2, '0')}
      <RegistryLinkIndicator visible={registryLinked} className="top-0.5 right-0.5 group-hover:opacity-0" />
      {assignment ? (
        <span
          role="button"
          tabIndex={0}
          className={`absolute -top-1 -right-1 z-20 size-4 items-center justify-center rounded-full bg-white text-[#20242c] shadow ${selected ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemoveAssignment(assignment.id)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onRemoveAssignment(assignment.id)
            }
          }}
        >
          <X className="size-3" />
        </span>
      ) : null}
    </button>
  )
}

function StorageBayRow({
  assignments,
  bayCount,
  label,
  onRemoveAssignment,
  onSelect,
  project,
  registryLinkedItemKeys,
  selectedItemId,
  type,
}: {
  assignments: ComponentAssignment[]
  bayCount: number
  label: string
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
  project: ProjectState
  registryLinkedItemKeys: ReadonlySet<string>
  selectedItemId: string | null
  type: 'drive' | 'm2'
}) {
  const byPosition = new Map<number, ComponentAssignment>()
  const unpositioned: ComponentAssignment[] = []
  for (const assignment of assignments) {
    const positions = assignment.allocation?.resourceType === 'storage'
      ? assignment.allocation.positions
      : []
    const position = positions.find((candidate) => (
      Number.isSafeInteger(candidate) && candidate >= 0 && candidate < bayCount && !byPosition.has(candidate)
    ))
    if (position === undefined) unpositioned.push(assignment)
    else byPosition.set(position, assignment)
  }
  for (let position = 0; position < bayCount && unpositioned.length > 0; position += 1) {
    if (!byPosition.has(position)) byPosition.set(position, unpositioned.shift()!)
  }

  const bays = Array.from({ length: bayCount }, (_, index) => {
    const assignment = byPosition.get(index)
    const item = assignment ? project.items[assignment.itemId] : null
    const selected = Boolean(item && selectedItemId === runtimeItemKey(item))

    return (
      <StorageBayCell
        key={`${type}-${index}`}
        assignment={assignment}
        index={index}
        item={item}
        label={label}
        onRemoveAssignment={onRemoveAssignment}
        onSelect={onSelect}
        registryLinked={Boolean(item && registryLinkedItemKeys.has(runtimeItemKey(item)))}
        selected={selected}
        type={type}
      />
    )
  })

  return (
    <div className="mt-2 rounded-md bg-black/10 p-2">
      <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.16em] opacity-75">
        {label}
      </div>
      <div className="flex gap-1.5 overflow-visible">{bays}</div>
    </div>
  )
}

function NasComponentCell({
  assignment,
  item,
  label,
  onRemoveAssignment,
  onSelect,
  registryLinked,
  selected,
}: {
  assignment: ComponentAssignment
  item: InventoryItem
  label: string
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
  registryLinked: boolean
  selected: boolean
}) {
  const draggable = useDraggable({
    id: `assignment:${assignment.id}`,
    data: {
      kind: 'assigned-component', assignmentId: assignment.id,
      itemId: assignment.itemId, sourceServerId: assignment.serverId,
    },
  })
  const itemKey = runtimeItemKey(item)
  const tapSelection = useTapSelection<HTMLDivElement>((event) => {
    event.stopPropagation()
    onSelect(itemKey)
  })
  const parts = item.type === 'cpu' ? formatCpuCanvasParts(item) : formatRamCanvasParts(item)

  return (
    <div
      ref={draggable.setNodeRef}
      className={`group relative flex h-11 min-w-0 cursor-grab items-center gap-1.5 rounded-md py-1.5 pr-7 pl-2 text-[#20242c] active:cursor-grabbing ${
        item.type === 'cpu' ? 'bg-[#9fd3df]' : 'bg-[#e9c56f]'
      } ${selected ? 'ring-2 ring-white/80' : ''} ${draggable.isDragging ? 'opacity-45' : ''}`}
      {...draggable.listeners}
      {...tapSelection}
      {...draggable.attributes}
    >
      <span className="shrink-0 text-[9px] font-black uppercase">{label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-1 overflow-hidden">
        {parts.slice(0, 4).map((part) => (
          <span key={part.label} className="shrink-0 rounded bg-white/70 px-1 py-0.5 text-[9px] font-bold leading-none">
            {part.value}
          </span>
        ))}
      </span>
      <AssignedItemCornerActions
        itemName={item.name}
        linked={registryLinked}
        onRemove={() => onRemoveAssignment(assignment.id)}
        removeClassName="size-5"
        selected={selected}
      />
    </div>
  )
}

function NetworkCardRow({
  assignment,
  canvasIndex,
  draggingEndpoint,
  nasId,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  onRemoveAssignment,
  onSelect,
  pendingEndpoint,
  project,
  registryLinkedItemKeys,
  requiredHandleIds,
  selectedItemId,
}: {
  assignment: ComponentAssignment | undefined
  canvasIndex: CanvasProjectIndex
  draggingEndpoint: ConnectionEndpoint | null
  nasId: string
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
  pendingEndpoint: ConnectionEndpoint | null
	project: ProjectState
	registryLinkedItemKeys: ReadonlySet<string>
	requiredHandleIds: ReadonlySet<string>
	selectedItemId: string | null
}) {
  const draggable = useDraggable({
    id: assignment ? `assignment:${assignment.id}` : `empty-nas-network:${nasId}`,
    disabled: !assignment,
    data: assignment
      ? {
          kind: 'assigned-component',
          assignmentId: assignment.id,
          itemId: assignment.itemId,
          sourceServerId: assignment.serverId,
        }
      : undefined,
  })
  const card = assignment ? project.items[assignment.itemId] : undefined
  const cardRuntimeKey = card ? runtimeItemKey(card) : ''
  const tapSelection = useTapSelection<HTMLDivElement>((event) => {
    event.stopPropagation()

    if (cardRuntimeKey) {
      onSelect(cardRuntimeKey)
    }
  })

  if (!assignment) {
    return null
  }

  if (!card) {
    return null
  }

  return (
    <div
      ref={draggable.setNodeRef}
      className={`group relative mt-2 cursor-grab rounded-md bg-[#173426] p-2 text-[#f4fff7] active:cursor-grabbing ${
        selectedItemId === cardRuntimeKey ? 'ring-2 ring-white/80' : ''
      } ${draggable.isDragging ? 'opacity-45' : ''}`}
      {...draggable.listeners}
      {...tapSelection}
      {...draggable.attributes}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 pr-5">
        <AssignedExpansionHeading item={card} />
        <AssignedItemCornerActions
          itemName={card.name}
          linked={registryLinkedItemKeys.has(cardRuntimeKey)}
          onRemove={() => onRemoveAssignment(assignment.id)}
          removeClassName="size-5 text-[#f4fff7]"
          selected={selectedItemId === cardRuntimeKey}
        />
      </div>
      <div className="flex gap-1.5 overflow-visible">
        {sortPorts(card.ports).map((port) => (
          <PortChip
            key={port.id}
            canvasIndex={canvasIndex}
            draggingEndpoint={draggingEndpoint}
            endpoint={{ itemId: nasId, hostedItemId: cardRuntimeKey, portId: port.id }}
            onEndpointClick={onEndpointClick}
            onEndpointDragStart={onEndpointDragStart}
            onEndpointDrop={onEndpointDrop}
            pendingEndpoint={pendingEndpoint}
            port={port}
            requiredHandleIds={requiredHandleIds}
          />
        ))}
      </div>
    </div>
  )
}

function PowerAdapterRow({
  assignment,
  canvasIndex,
  draggingEndpoint,
  nasId,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  onRemoveAssignment,
  onSelect,
  pendingEndpoint,
  project,
  registryLinkedItemKeys,
  requiredHandleIds,
  selectedItemId,
}: {
  assignment: ComponentAssignment | undefined
  canvasIndex: CanvasProjectIndex
  draggingEndpoint: ConnectionEndpoint | null
  nasId: string
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
  pendingEndpoint: ConnectionEndpoint | null
  project: ProjectState
  registryLinkedItemKeys: ReadonlySet<string>
  requiredHandleIds: ReadonlySet<string>
  selectedItemId: string | null
}) {
  const adapter = assignment ? project.items[assignment.itemId] : undefined
  const adapterKey = adapter ? runtimeItemKey(adapter) : ''
  const powerPort = adapter?.ports?.find((port) => (
    port.key === POWER_INPUT_PORT_KEY && port.type === 'ac-input'
  ))
  if (!assignment || !adapter) {
    return (
      <div
        data-testid="nas-power-adapter-slot"
        className="mt-2 rounded-md border border-dashed border-[#766e63] bg-[#171b22] px-3 py-2"
      >
        <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#cfc6b8]">
          Power Adapter
        </div>
        <div className="mt-1 text-[11px] font-semibold text-[#8f887d]">Empty</div>
      </div>
    )
  }

  return (
    <div data-testid="nas-power-adapter-slot">
      <AssignedPowerAdapterRow
        adapter={adapter}
        assignment={assignment}
        className="mt-2"
        onRemoveAssignment={onRemoveAssignment}
        onSelect={onSelect}
        registryLinked={registryLinkedItemKeys.has(adapterKey)}
        selected={selectedItemId === adapterKey}
        portChip={powerPort ? (
          <PortChip
            canvasIndex={canvasIndex}
            draggingEndpoint={draggingEndpoint}
            endpoint={{ itemId: nasId, hostedItemId: adapterKey, portId: powerPort.id }}
            onEndpointClick={onEndpointClick}
            onEndpointDragStart={onEndpointDragStart}
            onEndpointDrop={onEndpointDrop}
            pendingEndpoint={pendingEndpoint}
            port={powerPort}
            requiredHandleIds={requiredHandleIds}
          />
        ) : null}
      />
    </div>
  )
}

export function NasNode({ data }: NodeProps<NasFlowNode>) {
  const {
    project,
    canvasIndex,
    requiredHandleIds,
    registryLinkedItemKeys = EMPTY_REGISTRY_LINK_KEYS,
    itemId,
    selectedItemId,
    focusedItemIds,
    focusActive,
    spotlightItemId,
    pendingEndpoint,
    draggingEndpoint,
    dropCompatibilityStatus,
    onSelect,
    onRemoveAssignment,
    onEndpointClick,
    onEndpointDragStart,
    onEndpointDrop,
  } = data
  const nas = project.items[itemId]
  const nasRuntimeKey = nas ? runtimeItemKey(nas) : itemId
  const tapSelection = useTapSelection<HTMLDivElement>(() => onSelect(nasRuntimeKey))
  const droppable = useDroppable({
    id: `server:${itemId}`,
    data: {
      kind: 'server',
      serverId: itemId,
    },
  })

  if (!nas) {
    return null
  }

  const assignments = canvasIndex.assignmentsByHostId.get(nasRuntimeKey) ?? EMPTY_ASSIGNMENTS
  const storageAssignments = assignments.filter((assignment) => assignment.type === 'storage')
  const ramAssignments = assignments.filter((assignment) => assignment.type === 'ram')
  const cpuAssignment = assignments.find((assignment) => assignment.type === 'cpu')
  const networkAssignment = assignments.find((assignment) => assignment.type === 'network')
  const powerAdapterAssignment = assignments.find((assignment) => assignment.type === 'powerAdapter')
  const fixedComponents = nas.fixedComponents ?? []
  const fixedCpu = fixedComponents.filter((component) => component.componentType === 'cpu')
  const fixedMemory = fixedComponents.filter((component) => (
    component.componentType === 'ram' || component.componentType === 'memory'
  ))
  const fixedStorage = fixedComponents.filter((component) => component.componentType === 'storage')
  const otherFixedComponents = fixedComponents.filter((component) => ![
    'cpu', 'ram', 'memory', 'storage', 'powerAdapter',
  ].includes(component.componentType))
  const powerTopology = nasPowerTopology(nas)
  const networkPorts = sortPorts(nas.ports).filter((port) => port.kind !== 'power-port')
  const hostPowerPort = nasOwnsPowerEndpoint(nas)
    ? nas.ports?.find((port) => port.key === POWER_INPUT_PORT_KEY && port.type === 'ac-input')
    : undefined
  const bayCount = typeof nas.specs?.driveBays === 'number' ? nas.specs.driveBays : 0
  const m2SlotCount = typeof nas.specs?.m2Slots === 'number' ? nas.specs.m2Slots : 0
  const catalogStorageGroups = nas.compatibility?.host?.storageSlots ?? []
  const storageGroups = catalogStorageGroups.length > 0
    ? catalogStorageGroups
    : [
        ...(bayCount > 0 ? [{ id: 1, key: 'legacy-drive-bays', label: 'Drive Bays', count: bayCount }] : []),
        ...(m2SlotCount > 0 ? [{ id: 2, key: 'legacy-m2-slots', label: 'M.2 Slots', count: m2SlotCount, interfaces: ['NVMe'] }] : []),
      ] satisfies StorageSlotGroup[]
  const storageAssignmentsByGroup = groupedStorageAssignments(storageAssignments, storageGroups, project)
  const auditCount = canvasAuditWarningCount(canvasIndex, nasRuntimeKey)
  const focused = focusedItemIds.includes(nasRuntimeKey)
  const dimmed = focusActive && !focused
  const compatibilityDropRing = dropCompatibilityStatus === 'incompatible'
    ? 'ring-2 ring-inset ring-[#c85b4a]'
    : dropCompatibilityStatus === 'unknown'
      ? 'ring-2 ring-inset ring-[#d49a32]'
      : dropCompatibilityStatus === 'compatible'
        ? 'ring-2 ring-inset ring-[#ddb668]'
        : ''

  return (
    <div
      ref={droppable.setNodeRef}
      data-compatibility-drop={dropCompatibilityStatus}
      className={`relative rounded-lg border bg-[#20242c] p-2 text-[#f8f1e8] shadow-[0_20px_42px_rgba(32,36,44,0.26)] transition ${droppable.isOver && !dropCompatibilityStatus ? 'border-[#ddb668]' : 'border-[#11151b]'} ${!dropCompatibilityStatus && (selectedItemId === nasRuntimeKey || focused) ? 'ring-2 ring-[#ddb668]' : ''} ${compatibilityDropRing} ${spotlightItemId === nasRuntimeKey ? 'homelab-inventory-spotlight' : ''} ${dimmed ? 'opacity-35 grayscale' : ''}`}
      style={{ width: NAS_CARD_WIDTH } satisfies CSSProperties}
      {...tapSelection}
    >
      {auditCount > 0 ? (
        <div className="absolute -right-2 -bottom-2 z-30 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-[#ddb668] bg-[#fff2c7] px-2 text-[11px] font-black text-[#3d2a08] shadow-sm">
          <AlertTriangle className="size-3" />
          {auditCount}
        </div>
      ) : null}
      <div className="server-node-drag-handle flex cursor-grab items-center gap-2 rounded-md bg-[#303744] px-3 py-2 active:cursor-grabbing">
        <Grip className="size-4 text-[#cfc6b8]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{nas.properties?.displayName?.trim() || nas.name}</div>
          <div className="truncate text-[11px] text-[#cfc6b8]">{nas.model ?? nas.name}</div>
        </div>
        <RegistryLinkIndicator visible={registryLinkedItemKeys.has(nasRuntimeKey)} />
        {hostPowerPort ? (
          <div
            data-testid={powerTopology.configuration === 'internal-psu'
              ? 'nas-internal-power-port'
              : 'nas-fixed-power-port'}
            className="shrink-0"
          >
            <PortChip
              canvasIndex={canvasIndex}
              draggingEndpoint={draggingEndpoint}
              endpoint={{ itemId: nasRuntimeKey, portId: hostPowerPort.id }}
              onEndpointClick={onEndpointClick}
              onEndpointDragStart={onEndpointDragStart}
              onEndpointDrop={onEndpointDrop}
              pendingEndpoint={pendingEndpoint}
              port={hostPowerPort}
              displaySlotNumber={1}
              requiredHandleIds={requiredHandleIds}
            />
          </div>
        ) : null}
      </div>

      {fixedCpu.map((component) => (
        <FixedComponentCard key={component.id} component={component} compact className="mt-2" />
      ))}

      <div className="mt-2 flex flex-wrap gap-1.5 rounded-md bg-[#171b22] p-1.5">
        {networkPorts.length ? (
          <span className="rounded bg-[#d3eee7] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#143733]">
            {formatPortSummary({ ...nas, ports: networkPorts })}
          </span>
        ) : null}
        {ramAssignments.length === 0 && typeof nas.specs?.memoryGb === 'number' ? (
          <span className="rounded bg-[#f5ecd8] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#3c2f1f]">
            {nas.specs.memoryGb}GB RAM
          </span>
        ) : null}
        {!cpuAssignment && typeof nas.specs?.cpu === 'string' ? (
          <span className="rounded bg-[#d8e1e8] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#182b38]">
            {nas.specs.cpu}
          </span>
        ) : null}
      </div>

      {cpuAssignment && project.items[cpuAssignment.itemId] ? (
        <div className="mt-2">
          <NasComponentCell
            assignment={cpuAssignment}
            item={project.items[cpuAssignment.itemId]}
            label="CPU"
            onRemoveAssignment={onRemoveAssignment}
            onSelect={onSelect}
            registryLinked={registryLinkedItemKeys.has(runtimeItemKey(project.items[cpuAssignment.itemId]))}
            selected={selectedItemId === runtimeItemKey(project.items[cpuAssignment.itemId])}
          />
        </div>
      ) : null}

      {fixedMemory.length > 0 ? (
        <div className={`mt-2 grid gap-1.5 ${fixedMemory.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {fixedMemory.map((component) => (
            <FixedComponentCard key={component.id} component={component} compact />
          ))}
        </div>
      ) : null}

      {hostMemorySlotCount(nas) !== 0 ? <div className="mt-2">
        <MemorySlotGrid
          assignments={ramAssignments}
          hostId={nasRuntimeKey}
          slotCount={hostMemorySlotCount(nas)}
          renderAssignment={(assignment) => {
            const item = project.items[assignment.itemId]
            return item ? (
              <NasComponentCell
                assignment={assignment}
                item={item}
                label="RAM"
                onRemoveAssignment={onRemoveAssignment}
                onSelect={onSelect}
                registryLinked={registryLinkedItemKeys.has(runtimeItemKey(item))}
                selected={selectedItemId === runtimeItemKey(item)}
              />
            ) : null
          }}
        />
      </div> : null}

      {networkPorts.length ? (
        <div className="mt-2 rounded-md bg-black/10 p-2">
          <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.16em] opacity-75">
            LAN
          </div>
          <div className="flex gap-1.5 overflow-visible">
            {networkPorts.map((port) => (
              <PortChip
                key={port.id}
                canvasIndex={canvasIndex}
                draggingEndpoint={draggingEndpoint}
                endpoint={{ itemId: nasRuntimeKey, portId: port.id }}
                onEndpointClick={onEndpointClick}
                onEndpointDragStart={onEndpointDragStart}
                onEndpointDrop={onEndpointDrop}
                pendingEndpoint={pendingEndpoint}
                port={port}
                requiredHandleIds={requiredHandleIds}
              />
            ))}
          </div>
        </div>
      ) : null}

      {storageGroups.map((group) => (
        <StorageBayRow
          key={group.id}
          assignments={storageAssignmentsByGroup.get(group.id) ?? []}
          bayCount={group.count}
          label={group.label}
          onRemoveAssignment={onRemoveAssignment}
          onSelect={onSelect}
          project={project}
          registryLinkedItemKeys={registryLinkedItemKeys}
          selectedItemId={selectedItemId}
          type={storageGroupType(group)}
        />
      ))}

      {fixedStorage.length > 0 ? (
        <div className="mt-2 grid gap-1.5 rounded-md bg-black/10 p-2">
          <div className="text-[9px] font-black uppercase tracking-[0.16em] opacity-75">
            Fixed storage
          </div>
          {fixedStorage.map((component) => (
            <FixedComponentCard key={component.id} component={component} compact />
          ))}
        </div>
      ) : null}

      {otherFixedComponents.map((component) => (
        <FixedComponentCard key={component.id} component={component} compact className="mt-2" />
      ))}

      <NetworkCardRow
        assignment={networkAssignment}
        canvasIndex={canvasIndex}
        draggingEndpoint={draggingEndpoint}
        nasId={nasRuntimeKey}
        onEndpointClick={onEndpointClick}
        onEndpointDragStart={onEndpointDragStart}
        onEndpointDrop={onEndpointDrop}
        onRemoveAssignment={onRemoveAssignment}
        onSelect={onSelect}
        pendingEndpoint={pendingEndpoint}
        project={project}
        registryLinkedItemKeys={registryLinkedItemKeys}
        requiredHandleIds={requiredHandleIds}
        selectedItemId={selectedItemId}
      />
      {powerTopology.configuration === 'external-adapter' && powerTopology.adapterDisposition === 'replaceable' ? (
        <PowerAdapterRow
          assignment={powerAdapterAssignment}
          canvasIndex={canvasIndex}
          draggingEndpoint={draggingEndpoint}
          nasId={nasRuntimeKey}
          onEndpointClick={onEndpointClick}
          onEndpointDragStart={onEndpointDragStart}
          onEndpointDrop={onEndpointDrop}
          onRemoveAssignment={onRemoveAssignment}
          onSelect={onSelect}
          pendingEndpoint={pendingEndpoint}
          project={project}
          registryLinkedItemKeys={registryLinkedItemKeys}
          requiredHandleIds={requiredHandleIds}
          selectedItemId={selectedItemId}
        />
      ) : null}
    </div>
  )
}
