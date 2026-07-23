import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Grip, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { AssignedPowerAdapterRow } from '@/components/assigned-power-adapter-row'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getVisibleServerSlotTypes, SLOT_LABELS, sortAssignmentsForDisplay } from '@/lib/constraints'
import { getEndpointHandleId, type CableSide } from '@/lib/cable-routing'
import {
  canvasAuditWarningCount,
  canvasEndpointAvailable,
  canvasEndpointConnected,
  canvasEndpointsCompatible,
  type CanvasProjectIndex,
} from '@/lib/canvas-project-index'
import { getCanvasAssignmentTone } from '@/lib/canvas-quality'
import { runtimeItemKey } from '@/lib/item-keys'
import { useTapSelection } from '@/lib/tap-selection'
import {
  formatCpuCanvasParts,
  formatGpuCanvasParts,
  formatRamCanvasParts,
  formatPortType,
  formatStorageCanvasParts,
  type CpuCanvasPart,
  type GpuCanvasPart,
  type RamCanvasPart,
  type StorageCanvasPart,
} from '@/lib/format'
import { endpointKey, EQUIPMENT_PORT_CHIP_WIDTH } from '@/lib/project'
import type { CanvasPortDragPoint } from '@/types/canvas'
import { startSelectedPortDrag } from '@/lib/port-interactions'
import { POWER_INPUT_PORT_KEY } from '@/lib/power-endpoints'
import type { AgentServerStatus, AgentStatusSummary, AgentState } from '@/types/agent'
import type { CompatibilityStatus } from '@/types/compatibility'
import type {
  ComponentAssignment,
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'

export type ServerNodeData = {
  project: ProjectState
  canvasIndex: CanvasProjectIndex
  requiredHandleIds: ReadonlySet<string>
  agentStatus: AgentStatusSummary | null
  serverId: string
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

export type ServerFlowNode = Node<ServerNodeData, 'server'>

const CABLE_HANDLES = [
  { id: 'left', position: Position.Left },
  { id: 'right', position: Position.Right },
  { id: 'top', position: Position.Top },
  { id: 'bottom', position: Position.Bottom },
] as const

const HANDLE_SIDES: Array<{ side: CableSide; position: Position }> = [
  { side: 'left', position: Position.Left },
  { side: 'right', position: Position.Right },
  { side: 'top', position: Position.Top },
  { side: 'bottom', position: Position.Bottom },
]

function CableHandles({ requiredHandleIds }: { requiredHandleIds: ReadonlySet<string> }) {
  return (
    <>
      {CABLE_HANDLES.filter((handle) => requiredHandleIds.has(`target-${handle.id}`)).map((handle) => (
        <Handle
          key={`target-${handle.id}`}
          id={`target-${handle.id}`}
          type="target"
          position={handle.position}
          className="!h-3 !w-3 !border-0 !bg-transparent"
          isConnectable={false}
        />
      ))}
      {CABLE_HANDLES.filter((handle) => requiredHandleIds.has(`source-${handle.id}`)).map((handle) => (
        <Handle
          key={`source-${handle.id}`}
          id={`source-${handle.id}`}
          type="source"
          position={handle.position}
          className="!h-3 !w-3 !border-0 !bg-transparent"
          isConnectable={false}
        />
      ))}
    </>
  )
}

function sortPorts(ports: InventoryPort[] | undefined): InventoryPort[] {
  return [...(ports ?? [])].sort((first, second) => first.slotNumber - second.slotNumber)
}

function portSpeedLabel(port: InventoryPort): string {
  return port.speed ?? formatPortType(port.type)
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

  if (type === 'hdmi' || type === 'displayport' || type === 'mini-displayport') {
    return `${base} bg-[#1f232b] text-[#faf7ef]`
  }

  return `${base} bg-[#ead8f4] text-[#332047]`
}

function PortChipHandles({
  endpoint,
  requiredHandleIds,
}: {
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
              key={`target-${handle.side}-${endpoint.hostedItemId ?? 'board'}-${endpoint.portId}-${endpoint.endpointId ?? 'port'}`}
              id={targetId}
              type="target"
              position={handle.position}
              className="!h-2 !w-2 !border-0 !bg-transparent"
              isConnectable={false}
            />
          ) : null,
          requiredHandleIds.has(sourceId) ? (
            <Handle
              key={`source-${handle.side}-${endpoint.hostedItemId ?? 'board'}-${endpoint.portId}-${endpoint.endpointId ?? 'port'}`}
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
      className={`nodrag nopan relative flex h-[30px] shrink-0 flex-col items-center justify-center gap-0.5 rounded text-center leading-none transition ${portTone(
        port.type,
        port.speed,
        connected,
      )} ${open ? (selected ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : 'cursor-not-allowed'} ${
        selected || dragSource ? 'ring-2 ring-[#ddb668]' : ''
      } ${activeDropTarget && canDrop ? 'ring-2 ring-[#86a989]' : ''} ${
        activeDropTarget && !canDrop ? 'opacity-35 grayscale' : ''
      }`}
      style={{ width: EQUIPMENT_PORT_CHIP_WIDTH } satisfies CSSProperties}
      title={tooltipLabel ? undefined : `${String(port.slotNumber).padStart(2, '0')} ${portSpeedLabel(port)}`}
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

function ramPartTone(label: RamCanvasPart['label']): string {
  if (label === 'capacity') {
    return 'bg-[#fff2c7] text-[#3d2a08]'
  }

  if (label === 'generation') {
    return 'bg-[#cce7e9] text-[#12343a]'
  }

  if (label === 'module') {
    return 'bg-[#f2d3b7] text-[#3a2112]'
  }

  return 'bg-[#d8e9c9] text-[#203414]'
}

function cpuPartTone(label: CpuCanvasPart['label']): string {
  if (label === 'manufacturer') {
    return 'bg-[#d7eef2] text-[#102f36]'
  }

  if (label === 'family') {
    return 'bg-[#e8f4c8] text-[#25370e]'
  }

  if (label === 'number') {
    return 'bg-[#d7ddf4] text-[#182348]'
  }

  return 'bg-[#f3dfc1] text-[#3a2812]'
}

function storagePartTone(label: StorageCanvasPart['label']): string {
  if (label === 'capacity') {
    return 'bg-[#f5ecd8] text-[#3c2f1f]'
  }

  if (label === 'interface') {
    return 'bg-[#d8e1e8] text-[#182b38]'
  }

  return 'bg-[#cfe0b7] text-[#1f3213]'
}

function gpuPartTone(label: GpuCanvasPart['label']): string {
  if (label === 'manufacturer') {
    return 'bg-[#f4d2ca] text-[#3c1610]'
  }

  if (label === 'model') {
    return 'bg-[#f7dfbe] text-[#3b2510]'
  }

  return 'bg-[#d8d5f0] text-[#211e46]'
}

function agentStateTone(state: AgentState): string {
  if (state === 'online') {
    return 'bg-[#4d9a61]'
  }

  if (state === 'stale') {
    return 'bg-[#ddb668]'
  }

  if (state === 'offline') {
    return 'bg-[#c85645]'
  }

  if (state === 'unknown') {
    return 'bg-[#8bb3bd]'
  }

  return 'bg-[#766e63]'
}

function getServerAgentStatus(
  summary: AgentStatusSummary | null,
  serverId: number,
): AgentServerStatus {
  const existing = summary?.servers[String(serverId)]

  if (existing) {
    return existing
  }

  if (summary?.registeredServerIds.includes(serverId)) {
    return {
      serverId,
      state: 'unknown',
      connected: true,
      ageMs: null,
    }
  }

  return {
    serverId,
    state: 'unregistered',
    connected: false,
    ageMs: null,
  }
}

function ChipAssignmentLabel({
  label,
  parts,
  tone,
  layout = 'two-row',
}: {
  label: string
  parts: Array<{ label: string; value: string }>
  tone: (label: string) => string
  layout?: 'one-row' | 'two-row'
}) {
  const rows = layout === 'one-row' ? [parts] : [parts.slice(0, 2), parts.slice(2, 4)]

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-current">
        {label}
      </span>
      <span className={`flex min-w-0 gap-1 ${layout === 'one-row' ? 'items-center' : 'flex-col'}`}>
        {rows.map((row, rowIndex) => (
          <span key={rowIndex} className="flex min-w-0 items-center gap-1">
            {row.map((part) => (
              <span
                key={part.label}
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${tone(part.label)}`}
              >
                {part.value}
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  )
}

function AssignmentLabel({
  item,
  type,
}: {
  item: InventoryItem
  type: ComponentAssignment['type']
}) {
  if (type === 'cpu') {
    const parts = formatCpuCanvasParts(item)

    if (parts.length > 0) {
      return (
        <ChipAssignmentLabel
          label={SLOT_LABELS[type]}
          parts={parts}
          tone={(label) => cpuPartTone(label as CpuCanvasPart['label'])}
        />
      )
    }
  }

  if (type === 'ram') {
    const parts = formatRamCanvasParts(item)

    if (parts.length > 0) {
      return (
        <ChipAssignmentLabel
          label={SLOT_LABELS[type]}
          parts={parts}
          tone={(label) => ramPartTone(label as RamCanvasPart['label'])}
        />
      )
    }
  }

  if (type === 'storage') {
    const parts = formatStorageCanvasParts(item)

    if (parts.length > 0) {
      return (
        <ChipAssignmentLabel
          label={SLOT_LABELS[type]}
          parts={parts}
          layout="one-row"
          tone={(label) => storagePartTone(label as StorageCanvasPart['label'])}
        />
      )
    }
  }

  if (type === 'gpu') {
    const parts = formatGpuCanvasParts(item)

    if (parts.length > 0) {
      return (
        <ChipAssignmentLabel
          label={SLOT_LABELS[type]}
          parts={parts}
          layout="one-row"
          tone={(label) => gpuPartTone(label as GpuCanvasPart['label'])}
        />
      )
    }
  }

  return <span className="min-w-0 truncate">{SLOT_LABELS[type]} - {item.name}</span>
}

function AssignedComponentRow({
  assignment,
  canvasIndex,
  draggingEndpoint,
  item,
  onRemoveAssignment,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  onSelect,
  pendingEndpoint,
  requiredHandleIds,
  selected,
  serverId,
}: {
  assignment: ComponentAssignment
  canvasIndex: CanvasProjectIndex
  draggingEndpoint: ConnectionEndpoint | null
  item: InventoryItem
  onRemoveAssignment: (assignmentId: string | number) => void
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  onSelect: (itemId: string) => void
  pendingEndpoint: ConnectionEndpoint | null
  requiredHandleIds: ReadonlySet<string>
  selected: boolean
  serverId: string
}) {
  const itemRuntimeKey = runtimeItemKey(item)
  const connectablePorts = (assignment.type === 'network' || assignment.type === 'gpu')
    ? sortPorts(item.ports)
    : []
  const draggable = useDraggable({
    id: `assignment:${assignment.id}`,
    data: {
      kind: 'assigned-component',
      assignmentId: assignment.id,
      itemId: assignment.itemId,
      sourceServerId: assignment.serverId,
    },
  })
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    ...dragAttributes
  } = draggable.attributes
  const tapSelection = useTapSelection<HTMLDivElement>((event) => {
    event.stopPropagation()
    onSelect(itemRuntimeKey)
  })

  return (
    <div
      ref={draggable.setNodeRef}
      role="button"
      tabIndex={0}
      className={`nodrag group flex w-full cursor-grab gap-2 rounded-md px-2 text-left text-xs font-semibold active:cursor-grabbing ${
        connectablePorts.length > 0
          ? 'flex-col items-stretch py-2'
          : assignment.type === 'ram' ||
            assignment.type === 'cpu' ||
            assignment.type === 'storage' ||
            assignment.type === 'gpu'
          ? 'items-center py-2'
          : 'items-center py-1.5'
      } ${getCanvasAssignmentTone(assignment.type, item)} ${selected ? 'ring-2 ring-white/80' : ''} ${
        draggable.isDragging ? 'opacity-45' : ''
      }`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          onSelect(itemRuntimeKey)
        }
      }}
      {...draggable.listeners}
      {...tapSelection}
      {...dragAttributes}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <AssignmentLabel type={assignment.type} item={item} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 opacity-0 transition group-hover:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemoveAssignment(assignment.id)
          }}
        >
          <X className="size-3" />
        </Button>
      </div>
      {connectablePorts.length > 0 ? (
        <div className="flex gap-1.5 overflow-visible rounded bg-black/10 p-1.5">
          {connectablePorts.map((port) => (
            <PortChip
              key={port.id}
              canvasIndex={canvasIndex}
              draggingEndpoint={draggingEndpoint}
              endpoint={{ itemId: serverId, hostedItemId: itemRuntimeKey, portId: port.id }}
              onEndpointClick={onEndpointClick}
              onEndpointDragStart={onEndpointDragStart}
              onEndpointDrop={onEndpointDrop}
              pendingEndpoint={pendingEndpoint}
              port={port}
              requiredHandleIds={requiredHandleIds}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ServerBoardPortRow({
  canvasIndex,
  draggingEndpoint,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  pendingEndpoint,
  requiredHandleIds,
  server,
}: {
  canvasIndex: CanvasProjectIndex
  draggingEndpoint: ConnectionEndpoint | null
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  pendingEndpoint: ConnectionEndpoint | null
  requiredHandleIds: ReadonlySet<string>
  server: InventoryItem
}) {
  const ports = sortPorts(server.ports)
  const serverRuntimeKey = runtimeItemKey(server)

  if (ports.length === 0) {
    return null
  }

  return (
    <div className="mt-2 flex items-center gap-2 overflow-visible rounded-md bg-[#171b22] p-1.5">
      <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.12em] text-[#cfc6b8]">
        Board
      </span>
      <div className="flex min-w-0 flex-wrap gap-1.5 overflow-visible">
        {ports.map((port) => (
          <PortChip
            key={port.id}
            canvasIndex={canvasIndex}
            draggingEndpoint={draggingEndpoint}
            endpoint={{ itemId: serverRuntimeKey, portId: port.id }}
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

export function ServerNode({ data }: NodeProps<ServerFlowNode>) {
  const {
    project,
    canvasIndex,
    requiredHandleIds,
    agentStatus,
    serverId,
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
  const server = project.items[serverId]
  const serverRuntimeKey = server ? runtimeItemKey(server) : serverId
  const tapSelection = useTapSelection<HTMLDivElement>(() => onSelect(serverRuntimeKey))
  const droppable = useDroppable({
    id: `server:${serverId}`,
    data: {
      kind: 'server',
      serverId,
    },
  })
  const assignments = sortAssignmentsForDisplay(project, serverId)
  const visibleSlotTypes = getVisibleServerSlotTypes(project, serverId)

  if (!server) {
    return null
  }

  const serverDisplayName = server.properties?.displayName?.trim() || 'Server'
  const serverAgentStatus = getServerAgentStatus(agentStatus, server.id)
  const auditCount = canvasAuditWarningCount(canvasIndex, serverRuntimeKey)
  const focused = focusedItemIds.includes(serverRuntimeKey)
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
      className={`relative w-[282px] rounded-lg border bg-[#20242c] p-2 text-[#f8f1e8] shadow-[0_20px_42px_rgba(32,36,44,0.26)] transition ${droppable.isOver && !dropCompatibilityStatus ? 'border-[#ddb668]' : 'border-[#11151b]'} ${!dropCompatibilityStatus && (selectedItemId === serverRuntimeKey || focused) ? 'ring-2 ring-[#ddb668]' : ''} ${compatibilityDropRing} ${spotlightItemId === serverRuntimeKey ? 'homelab-inventory-spotlight' : ''} ${dimmed ? 'opacity-35 grayscale' : ''}`}
      {...tapSelection}
    >
      {auditCount > 0 ? (
        <div className="absolute -right-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-[#ddb668] bg-[#fff2c7] px-2 text-[11px] font-black text-[#3d2a08] shadow-sm">
          <AlertTriangle className="size-3" />
          {auditCount}
        </div>
      ) : null}
      <CableHandles requiredHandleIds={requiredHandleIds} />
      <div
        className="server-node-drag-handle flex cursor-grab items-center gap-2 rounded-md bg-[#303744] px-3 py-2 active:cursor-grabbing"
      >
        <Grip className="size-4 text-[#cfc6b8]" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{server.name}</div>
          <div className="truncate text-[11px] text-[#cfc6b8]">
            {serverDisplayName}
          </div>
        </div>
        <span
          className={`ml-auto size-2.5 shrink-0 rounded-full ring-2 ring-[#20242c] ${agentStateTone(serverAgentStatus.state)}`}
          title={`Agent: ${serverAgentStatus.state}`}
        />
      </div>

      <ServerBoardPortRow
        canvasIndex={canvasIndex}
        draggingEndpoint={draggingEndpoint}
        onEndpointClick={onEndpointClick}
        onEndpointDragStart={onEndpointDragStart}
        onEndpointDrop={onEndpointDrop}
        pendingEndpoint={pendingEndpoint}
        requiredHandleIds={requiredHandleIds}
        server={server}
      />

      <div className="mt-2 space-y-1.5">
        {visibleSlotTypes.map((type) => {
          const matches = assignments.filter((assignment) => assignment.type === type)

          if (matches.length === 0) {
            return (
              <div
                key={type}
                className="rounded-md border border-dashed border-[#766e63] bg-[#2a2f39] px-2 py-1.5 text-xs text-[#cfc6b8]"
              >
                {SLOT_LABELS[type]} drop slot
              </div>
            )
          }

          return matches.map((assignment) => {
            const item = project.items[assignment.itemId]

            if (!item) {
              return null
            }

            if (assignment.type === 'powerAdapter') {
              const adapterKey = runtimeItemKey(item)
              const powerPort = item.ports?.find((port) => (
                port.key === POWER_INPUT_PORT_KEY && port.type === 'ac-input'
              ))

              return (
                <AssignedPowerAdapterRow
                  key={assignment.id}
                  adapter={item}
                  assignment={assignment}
                  onRemoveAssignment={onRemoveAssignment}
                  onSelect={onSelect}
                  selected={selectedItemId === adapterKey}
                  portChip={powerPort ? (
                    <PortChip
                      canvasIndex={canvasIndex}
                      draggingEndpoint={draggingEndpoint}
                      endpoint={{
                        itemId: serverRuntimeKey,
                        hostedItemId: adapterKey,
                        portId: powerPort.id,
                      }}
                      onEndpointClick={onEndpointClick}
                      onEndpointDragStart={onEndpointDragStart}
                      onEndpointDrop={onEndpointDrop}
                      pendingEndpoint={pendingEndpoint}
                      port={powerPort}
                      requiredHandleIds={requiredHandleIds}
                    />
                  ) : null}
                />
              )
            }

            return (
              <AssignedComponentRow
                key={assignment.id}
                assignment={assignment}
                canvasIndex={canvasIndex}
                draggingEndpoint={draggingEndpoint}
                item={item}
                onRemoveAssignment={onRemoveAssignment}
                onEndpointClick={onEndpointClick}
                onEndpointDragStart={onEndpointDragStart}
                onEndpointDrop={onEndpointDrop}
                onSelect={onSelect}
                pendingEndpoint={pendingEndpoint}
                requiredHandleIds={requiredHandleIds}
                selected={selectedItemId === runtimeItemKey(item)}
                serverId={serverRuntimeKey}
              />
            )
          })
        })}
      </div>
    </div>
  )
}
