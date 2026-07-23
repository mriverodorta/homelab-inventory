import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Grip, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { AssignedPowerAdapterRow } from '@/components/assigned-power-adapter-row'
import { Button } from '@/components/ui/button'
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
  formatStorageCanvasParts,
} from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { useTapSelection } from '@/lib/tap-selection'
import { endpointKey, NAS_CARD_WIDTH } from '@/lib/project'
import { startSelectedPortDrag } from '@/lib/port-interactions'
import { POWER_INPUT_PORT_KEY } from '@/lib/power-endpoints'
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

export type NasNodeData = {
  project: ProjectState
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
      <PortChipHandles endpoint={endpoint} requiredHandleIds={requiredHandleIds} />
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
  const m2Assignments = storageAssignments.filter((assignment) => storageFitsM2(project.items[assignment.itemId]))
  const driveAssignments = storageAssignments.filter((assignment) => !storageFitsM2(project.items[assignment.itemId]))
  const networkAssignment = assignments.find((assignment) => assignment.type === 'network')
  const powerAdapterAssignment = assignments.find((assignment) => assignment.type === 'powerAdapter')
  const networkPorts = sortPorts(nas.ports).filter((port) => port.kind !== 'power-port')
  const internalPowerPort = nas.specs?.powerConfiguration === 'internal-psu'
    ? nas.ports?.find((port) => port.key === POWER_INPUT_PORT_KEY && port.type === 'ac-input')
    : undefined
  const bayCount = typeof nas.specs?.driveBays === 'number' ? nas.specs.driveBays : 0
  const m2SlotCount = typeof nas.specs?.m2Slots === 'number' ? nas.specs.m2Slots : 0
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
        <div className="absolute -right-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-[#ddb668] bg-[#fff2c7] px-2 text-[11px] font-black text-[#3d2a08] shadow-sm">
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
        {internalPowerPort ? (
          <div data-testid="nas-internal-power-port" className="shrink-0">
            <PortChip
              canvasIndex={canvasIndex}
              draggingEndpoint={draggingEndpoint}
              endpoint={{ itemId: nasRuntimeKey, portId: internalPowerPort.id }}
              onEndpointClick={onEndpointClick}
              onEndpointDragStart={onEndpointDragStart}
              onEndpointDrop={onEndpointDrop}
              pendingEndpoint={pendingEndpoint}
              port={internalPowerPort}
              requiredHandleIds={requiredHandleIds}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 rounded-md bg-[#171b22] p-1.5">
        {networkPorts.length ? (
          <span className="rounded bg-[#d3eee7] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#143733]">
            {formatPortSummary({ ...nas, ports: networkPorts })}
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
        requiredHandleIds={requiredHandleIds}
        selectedItemId={selectedItemId}
      />
      {nas.specs?.powerConfiguration === 'external-adapter' ? (
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
          requiredHandleIds={requiredHandleIds}
          selectedItemId={selectedItemId}
        />
      ) : null}
    </div>
  )
}
