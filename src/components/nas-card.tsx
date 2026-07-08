import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Grip, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getItemAuditWarnings } from '@/lib/audit'
import { getEndpointHandleId, type CableSide } from '@/lib/cable-routing'
import { getStorageQualityTone } from '@/lib/canvas-quality'
import { formatPortSummary, formatPortType, formatStorageCanvasParts } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { useTapSelection } from '@/lib/tap-selection'
import {
  connectionEndpointAvailable,
  endpointKey,
  getConnectionPort,
  NAS_CARD_WIDTH,
  portsCompatible,
} from '@/lib/project'
import { startSelectedPortDrag } from '@/lib/port-interactions'
import type {
  ComponentAssignment,
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'
import type { CanvasPortDragPoint } from '@/types/canvas'

export type NasNodeData = {
  project: ProjectState
  itemId: string
  selectedItemId: string | null
  focusedItemIds: string[]
  focusActive: boolean
  spotlightItemId: string | null
  pendingEndpoint: ConnectionEndpoint | null
  draggingEndpoint: ConnectionEndpoint | null
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

function sortPorts(ports: InventoryPort[] | undefined): InventoryPort[] {
  return [...(ports ?? [])].sort((first, second) => first.slotNumber - second.slotNumber)
}

function endpointMatches(first: ConnectionEndpoint, second: ConnectionEndpoint): boolean {
  return first.itemId === second.itemId &&
    first.hostedItemId === second.hostedItemId &&
    String(first.portId) === String(second.portId) &&
    String(first.endpointId ?? '') === String(second.endpointId ?? '')
}

function endpointConnected(project: ProjectState, endpoint: ConnectionEndpoint): boolean {
  return (project.connections ?? []).some(
    (connection) => endpointMatches(connection.from, endpoint) || endpointMatches(connection.to, endpoint),
  )
}

function endpointCompatible(
  project: ProjectState,
  sourceEndpoint: ConnectionEndpoint | null,
  targetEndpoint: ConnectionEndpoint,
): boolean {
  if (!sourceEndpoint || endpointKey(sourceEndpoint) === endpointKey(targetEndpoint)) {
    return true
  }

  const sourcePort = getConnectionPort(project, sourceEndpoint)
  const targetPort = getConnectionPort(project, targetEndpoint)

  return Boolean(sourcePort && targetPort && portsCompatible(sourcePort.type, targetPort.type))
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

function PortChipHandles({ endpoint }: { endpoint: ConnectionEndpoint }) {
  return (
    <>
      {HANDLE_SIDES.flatMap((handle) => [
        <Handle
          key={`target-${handle.side}-${endpoint.portId}-${endpoint.endpointId ?? 'port'}`}
          id={getEndpointHandleId('target', handle.side, endpoint)}
          type="target"
          position={handle.position}
          className="!h-2 !w-2 !border-0 !bg-transparent"
          isConnectable={false}
        />,
        <Handle
          key={`source-${handle.side}-${endpoint.portId}-${endpoint.endpointId ?? 'port'}`}
          id={getEndpointHandleId('source', handle.side, endpoint)}
          type="source"
          position={handle.position}
          className="!h-2 !w-2 !border-0 !bg-transparent"
          isConnectable={false}
        />,
      ])}
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
  project,
}: {
  draggingEndpoint: ConnectionEndpoint | null
  endpoint: ConnectionEndpoint
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  pendingEndpoint: ConnectionEndpoint | null
  port: InventoryPort
  project: ProjectState
}) {
  const connected = endpointConnected(project, endpoint)
  const open = connectionEndpointAvailable(project, endpoint)
  const sourceEndpoint = draggingEndpoint ?? pendingEndpoint
  const dragSource = draggingEndpoint ? endpointKey(draggingEndpoint) === endpointKey(endpoint) : false
  const selected = pendingEndpoint ? endpointKey(pendingEndpoint) === endpointKey(endpoint) : false
  const compatible = endpointCompatible(project, sourceEndpoint, endpoint)
  const activeDropTarget = Boolean(draggingEndpoint && !dragSource)
  const canStartDrag = open && selected
  const canDrop = Boolean(draggingEndpoint && !dragSource && open && compatible)
  const tooltipLabel = nicSpeedTooltipLabel(port)

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
      title={tooltipLabel ? undefined : `${String(port.slotNumber).padStart(2, '0')} ${port.speed ?? formatPortType(port.type)}`}
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
      <PortChipHandles endpoint={endpoint} />
      <span className="text-[8px] font-black uppercase leading-none opacity-80">{portTypeChipLabel(port.type)}</span>
      <span className="text-[11px] font-black">{String(port.slotNumber).padStart(2, '0')}</span>
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

function storageFitsM2(item: InventoryItem | undefined): boolean {
  const storageInterface = String(item?.specs?.interface ?? '').toLowerCase()
  const formFactor = String(item?.specs?.formFactor ?? '').toLowerCase()

  return storageInterface.includes('nvme') || formFactor.includes('22')
}

function StorageBayCell({
  assignment,
  index,
  item,
  label,
  onRemoveAssignment,
  onSelect,
  selected,
  type,
}: {
  assignment: ComponentAssignment | undefined
  index: number
  item: InventoryItem | null
  label: string
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
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
      {assignment ? (
        <span
          role="button"
          tabIndex={0}
          className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-white text-[#20242c] shadow group-hover:flex"
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
  selectedItemId,
  type,
}: {
  assignments: ComponentAssignment[]
  bayCount: number
  label: string
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
  project: ProjectState
  selectedItemId: string | null
  type: 'drive' | 'm2'
}) {
  const bays = Array.from({ length: bayCount }, (_, index) => {
    const assignment = assignments[index]
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

function NetworkCardRow({
  assignment,
  draggingEndpoint,
  nasId,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  onRemoveAssignment,
  onSelect,
  pendingEndpoint,
  project,
  selectedItemId,
}: {
  assignment: ComponentAssignment | undefined
  draggingEndpoint: ConnectionEndpoint | null
  nasId: string
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
  pendingEndpoint: ConnectionEndpoint | null
	project: ProjectState
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
      className={`mt-2 cursor-grab rounded-md bg-[#173426] p-2 text-[#f4fff7] active:cursor-grabbing ${
        selectedItemId === cardRuntimeKey ? 'ring-2 ring-white/80' : ''
      } ${draggable.isDragging ? 'opacity-45' : ''}`}
      {...draggable.listeners}
      {...tapSelection}
      {...draggable.attributes}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-black uppercase tracking-[0.12em]">
          PCIe Network
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 shrink-0 text-[#f4fff7] opacity-70 hover:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemoveAssignment(assignment.id)
          }}
        >
          <X className="size-3" />
        </Button>
      </div>
      <div className="mb-2 truncate text-[11px] font-bold">{card.name}</div>
      <div className="flex gap-1.5 overflow-visible">
        {sortPorts(card.ports).map((port) => (
          <PortChip
            key={port.id}
            draggingEndpoint={draggingEndpoint}
            endpoint={{ itemId: nasId, hostedItemId: cardRuntimeKey, portId: port.id }}
            onEndpointClick={onEndpointClick}
            onEndpointDragStart={onEndpointDragStart}
            onEndpointDrop={onEndpointDrop}
            pendingEndpoint={pendingEndpoint}
            port={port}
            project={project}
          />
        ))}
      </div>
    </div>
  )
}

export function NasNode({ data }: NodeProps<NasFlowNode>) {
  const {
    project,
    itemId,
    selectedItemId,
    focusedItemIds,
    focusActive,
    spotlightItemId,
    pendingEndpoint,
	    draggingEndpoint,
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

  const assignments = project.assignments.filter((assignment) => assignment.serverId === nasRuntimeKey)
  const storageAssignments = assignments.filter((assignment) => assignment.type === 'storage')
  const m2Assignments = storageAssignments.filter((assignment) => storageFitsM2(project.items[assignment.itemId]))
  const driveAssignments = storageAssignments.filter((assignment) => !storageFitsM2(project.items[assignment.itemId]))
  const networkAssignment = assignments.find((assignment) => assignment.type === 'network')
  const bayCount = typeof nas.specs?.driveBays === 'number' ? nas.specs.driveBays : 0
  const m2SlotCount = typeof nas.specs?.m2Slots === 'number' ? nas.specs.m2Slots : 0
  const auditCount = getItemAuditWarnings(project, nasRuntimeKey).length
  const focused = focusedItemIds.includes(nasRuntimeKey)
  const dimmed = focusActive && !focused

  return (
    <div
      ref={droppable.setNodeRef}
      className={`relative rounded-lg border bg-[#20242c] p-2 text-[#f8f1e8] shadow-[0_20px_42px_rgba(32,36,44,0.26)] transition ${droppable.isOver ? 'border-[#ddb668]' : 'border-[#11151b]'} ${selectedItemId === nasRuntimeKey || focused ? 'ring-2 ring-[#ddb668]' : ''} ${spotlightItemId === nasRuntimeKey ? 'homelab-inventory-spotlight' : ''} ${dimmed ? 'opacity-35 grayscale' : ''}`}
      style={{ width: NAS_CARD_WIDTH } satisfies CSSProperties}
      {...tapSelection}
    >
      {auditCount > 0 ? (
        <div className="absolute -right-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-[#ddb668] bg-[#fff2c7] px-2 text-[11px] font-black text-[#3d2a08] shadow-sm">
          <AlertTriangle className="size-3" />
          {auditCount}
        </div>
      ) : null}
      <div className="server-node-drag-handle flex cursor-grab items-center gap-2 rounded-md bg-[#303744] px-3 py-2 active:cursor-grabbing">
        <Grip className="size-4 text-[#cfc6b8]" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{nas.properties?.displayName?.trim() || nas.name}</div>
          <div className="truncate text-[11px] text-[#cfc6b8]">{nas.model ?? nas.name}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 rounded-md bg-[#171b22] p-1.5">
        {nas.ports?.length ? (
          <span className="rounded bg-[#d3eee7] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#143733]">
            {formatPortSummary(nas)}
          </span>
        ) : null}
        {typeof nas.specs?.memoryGb === 'number' ? (
          <span className="rounded bg-[#f5ecd8] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#3c2f1f]">
            {nas.specs.memoryGb}GB RAM
          </span>
        ) : null}
        {typeof nas.specs?.cpu === 'string' ? (
          <span className="rounded bg-[#d8e1e8] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#182b38]">
            {nas.specs.cpu}
          </span>
        ) : null}
      </div>

      {nas.ports?.length ? (
        <div className="mt-2 rounded-md bg-black/10 p-2">
          <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.16em] opacity-75">
            LAN
          </div>
          <div className="flex gap-1.5 overflow-visible">
            {sortPorts(nas.ports).map((port) => (
              <PortChip
                key={port.id}
                draggingEndpoint={draggingEndpoint}
                endpoint={{ itemId: nasRuntimeKey, portId: port.id }}
                onEndpointClick={onEndpointClick}
                onEndpointDragStart={onEndpointDragStart}
                onEndpointDrop={onEndpointDrop}
                pendingEndpoint={pendingEndpoint}
                port={port}
                project={project}
              />
            ))}
          </div>
        </div>
      ) : null}

      {bayCount > 0 ? (
        <StorageBayRow
          assignments={driveAssignments}
          bayCount={bayCount}
          label="Drive Bays"
          onRemoveAssignment={onRemoveAssignment}
          onSelect={onSelect}
          project={project}
          selectedItemId={selectedItemId}
          type="drive"
        />
      ) : null}

      {m2SlotCount > 0 ? (
        <StorageBayRow
          assignments={m2Assignments}
          bayCount={m2SlotCount}
          label="M.2 Slots"
          onRemoveAssignment={onRemoveAssignment}
          onSelect={onSelect}
          project={project}
          selectedItemId={selectedItemId}
          type="m2"
        />
      ) : null}

      <NetworkCardRow
        assignment={networkAssignment}
        draggingEndpoint={draggingEndpoint}
        nasId={nasRuntimeKey}
        onEndpointClick={onEndpointClick}
        onEndpointDragStart={onEndpointDragStart}
        onEndpointDrop={onEndpointDrop}
        onRemoveAssignment={onRemoveAssignment}
        onSelect={onSelect}
        pendingEndpoint={pendingEndpoint}
        project={project}
        selectedItemId={selectedItemId}
      />
    </div>
  )
}
