import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Grip, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getItemAuditWarnings } from '@/lib/audit'
import { getEndpointHandleId, type CableSide } from '@/lib/cable-routing'
import { getCanvasAssignmentTone } from '@/lib/canvas-quality'
import { SLOT_LABELS, sortAssignmentsForDisplay } from '@/lib/constraints'
import {
  formatCpuCanvasParts,
  formatGpuCanvasParts,
  formatInventoryCompactSpec,
  formatPortType,
  formatRamCanvasParts,
  formatStorageCanvasParts,
} from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { visiblePcBuildSlotTypes } from '@/lib/pc-build'
import { startSelectedPortDrag } from '@/lib/port-interactions'
import {
  connectionEndpointAvailable,
  endpointKey,
  EQUIPMENT_PORT_CHIP_WIDTH,
  getConnectionPort,
  portsCompatible,
} from '@/lib/project'
import { useTapSelection } from '@/lib/tap-selection'
import type { CanvasPortDragPoint } from '@/types/canvas'
import type { CompatibilityStatus } from '@/types/compatibility'
import type {
  ComponentAssignment,
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'

export type PcBuildNodeData = {
  project: ProjectState
  pcBuildId: string
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

export type PcBuildFlowNode = Node<PcBuildNodeData, 'pcBuild'>

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

function CableHandles() {
  return (
    <>
      {CABLE_HANDLES.flatMap((handle) => [
        <Handle
          key={`target-${handle.id}`}
          id={`target-${handle.id}`}
          type="target"
          position={handle.position}
          className="!h-3 !w-3 !border-0 !bg-transparent"
          isConnectable={false}
        />,
        <Handle
          key={`source-${handle.id}`}
          id={`source-${handle.id}`}
          type="source"
          position={handle.position}
          className="!h-3 !w-3 !border-0 !bg-transparent"
          isConnectable={false}
        />,
      ])}
    </>
  )
}

function sortPorts(ports: InventoryPort[] | undefined): InventoryPort[] {
  return [...(ports ?? [])].sort((first, second) => first.slotNumber - second.slotNumber)
}

function endpointMatches(first: ConnectionEndpoint, second: ConnectionEndpoint): boolean {
  return first.itemId === second.itemId
    && first.hostedItemId === second.hostedItemId
    && String(first.portId) === String(second.portId)
    && String(first.endpointId ?? '') === String(second.endpointId ?? '')
}

function endpointConnected(project: ProjectState, endpoint: ConnectionEndpoint): boolean {
  return project.connections.some(
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

function portTypeChipLabel(type: InventoryPortType): string {
  if (type === 'rj45') return 'NIC'
  if (type === 'displayport') return 'DP'
  if (type === 'mini-displayport') return 'MDP'
  if (type === 'hdmi') return 'HDMI'
  if (type === 'sfp-plus') return 'SFP+'
  if (type === 'sfp') return 'SFP'
  if (type === 'barrel') return 'DC'
  return formatPortType(type).toUpperCase()
}

function portTone(port: InventoryPort, connected: boolean): string {
  const base = connected ? 'shadow-[inset_0_0_0_1px_rgba(31,35,43,0.24)]' : 'opacity-90'

  if (port.speed?.includes('10') || port.type === 'sfp-plus') {
    return `${base} bg-[#d8ddf4] text-[#15214a]`
  }
  if (port.speed?.includes('2.5')) {
    return `${base} bg-[#d3eee7] text-[#143733]`
  }
  if (port.speed?.includes('5')) {
    return `${base} bg-[#e4d7f5] text-[#332047]`
  }
  if (port.speed?.includes('1') || port.type === 'rj45') {
    return `${base} bg-[#fff2c7] text-[#3d2a08]`
  }
  if (['hdmi', 'displayport', 'mini-displayport'].includes(port.type)) {
    return `${base} bg-[#1f232b] text-[#faf7ef]`
  }
  return `${base} bg-[#ead8f4] text-[#332047]`
}

function nicSpeedTooltipLabel(port: InventoryPort): string | null {
  if (!['rj45', 'sfp', 'sfp-plus'].includes(port.type)) return null
  const speed = String(port.speed ?? (port.type === 'sfp-plus' ? '10G' : '')).toLowerCase()
  if (speed.includes('10')) return '10gbps'
  if (speed.includes('5')) return '5gbps'
  if (speed.includes('2.5') || speed.includes('2500')) return '2.5gbps'
  if (speed.includes('1') || speed.includes('1000')) return '1gbps'
  return null
}

function PortChipHandles({ endpoint }: { endpoint: ConnectionEndpoint }) {
  return (
    <>
      {HANDLE_SIDES.flatMap((handle) => [
        <Handle
          key={`target-${handle.side}-${endpoint.hostedItemId ?? 'host'}-${endpoint.portId}`}
          id={getEndpointHandleId('target', handle.side, endpoint)}
          type="target"
          position={handle.position}
          className="!h-2 !w-2 !border-0 !bg-transparent"
          isConnectable={false}
        />,
        <Handle
          key={`source-${handle.side}-${endpoint.hostedItemId ?? 'host'}-${endpoint.portId}`}
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
  onEndpointClick: PcBuildNodeData['onEndpointClick']
  onEndpointDragStart: PcBuildNodeData['onEndpointDragStart']
  onEndpointDrop: PcBuildNodeData['onEndpointDrop']
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
  const canStartDrag = open && selected
  const canDrop = Boolean(draggingEndpoint && !dragSource && open && compatible)
  const tooltipLabel = nicSpeedTooltipLabel(port)
  const title = `${String(port.slotNumber).padStart(2, '0')} ${port.speed ?? formatPortType(port.type)}`

  const chip = (
    <div
      className={`nodrag nopan relative flex h-[30px] shrink-0 flex-col items-center justify-center gap-0.5 rounded text-center leading-none transition ${portTone(port, connected)} ${open ? (selected ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : 'cursor-not-allowed'} ${selected || dragSource ? 'ring-2 ring-[#ddb668]' : ''} ${draggingEndpoint && !dragSource && canDrop ? 'ring-2 ring-[#86a989]' : ''} ${draggingEndpoint && !dragSource && !canDrop ? 'opacity-35 grayscale' : ''}`}
      style={{ width: EQUIPMENT_PORT_CHIP_WIDTH } satisfies CSSProperties}
      title={tooltipLabel ? undefined : title}
      aria-label={title}
      role="button"
      tabIndex={open ? 0 : -1}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (canStartDrag) startSelectedPortDrag(event, endpoint, onEndpointDragStart)
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (open && !selected) {
          onEndpointClick(endpoint, { x: event.clientX, y: event.clientY })
        }
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (canDrop) onEndpointDrop(endpoint)
      }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && open && !selected) {
          event.preventDefault()
          event.stopPropagation()
          onEndpointClick(endpoint, { x: 0, y: 0 })
        }
      }}
    >
      <PortChipHandles endpoint={endpoint} />
      <span className="text-[8px] font-black uppercase leading-none opacity-80">{portTypeChipLabel(port.type)}</span>
      <span className="text-[11px] font-black">{String(port.slotNumber).padStart(2, '0')}</span>
    </div>
  )

  if (!tooltipLabel) return chip

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>{tooltipLabel}</TooltipContent>
    </Tooltip>
  )
}

function assignmentSummary(item: InventoryItem): string {
  if (item.type === 'cpu') {
    return formatCpuCanvasParts(item).map((part) => part.value).join(' ')
  }
  if (item.type === 'ram') {
    return formatRamCanvasParts(item).map((part) => part.value).join(' ')
  }
  if (item.type === 'storage') {
    return formatStorageCanvasParts(item).map((part) => part.value).join(' ')
  }
  if (item.type === 'gpu') {
    return formatGpuCanvasParts(item).map((part) => part.value).join(' ')
  }
  return formatInventoryCompactSpec(item) ?? item.name
}

function AssignedComponentRow({
  assignment,
  draggingEndpoint,
  hostRuntimeKey,
  item,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  onRemoveAssignment,
  onSelect,
  pendingEndpoint,
  project,
  selected,
}: {
  assignment: ComponentAssignment
  draggingEndpoint: ConnectionEndpoint | null
  hostRuntimeKey: string
  item: InventoryItem
  onEndpointClick: PcBuildNodeData['onEndpointClick']
  onEndpointDragStart: PcBuildNodeData['onEndpointDragStart']
  onEndpointDrop: PcBuildNodeData['onEndpointDrop']
  onRemoveAssignment: PcBuildNodeData['onRemoveAssignment']
  onSelect: PcBuildNodeData['onSelect']
  pendingEndpoint: ConnectionEndpoint | null
  project: ProjectState
  selected: boolean
}) {
  const itemRuntimeKey = runtimeItemKey(item)
  const ports = assignment.type === 'motherboard' ? [] : sortPorts(item.ports)
  const draggable = useDraggable({
    id: `assignment:${assignment.id}`,
    data: {
      kind: 'assigned-component',
      assignmentId: assignment.id,
      itemId: assignment.itemId,
      sourceServerId: assignment.serverId,
    },
  })
  const { role: _role, tabIndex: _tabIndex, ...dragAttributes } = draggable.attributes
  const tapSelection = useTapSelection<HTMLDivElement>((event) => {
    event.stopPropagation()
    onSelect(itemRuntimeKey)
  })

  return (
    <div
      ref={draggable.setNodeRef}
      role="button"
      tabIndex={0}
      className={`nodrag group flex w-full cursor-grab flex-col gap-1.5 rounded-md px-2 py-2 text-left text-xs active:cursor-grabbing ${getCanvasAssignmentTone(assignment.type, item)} ${selected ? 'ring-2 ring-white/80' : ''} ${draggable.isDragging ? 'opacity-45' : ''}`}
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
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.08em]">
          {SLOT_LABELS[assignment.type]}
        </span>
        <span className="min-w-0 flex-1 truncate font-bold" title={item.name}>
          {assignmentSummary(item)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${item.name}`}
          className="size-6 shrink-0 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemoveAssignment(assignment.id)
          }}
        >
          <X className="size-3" />
        </Button>
      </div>
      {ports.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded bg-black/10 p-1.5">
          {ports.map((port) => (
            <PortChip
              key={port.id}
              draggingEndpoint={draggingEndpoint}
              endpoint={{ itemId: hostRuntimeKey, hostedItemId: itemRuntimeKey, portId: port.id }}
              onEndpointClick={onEndpointClick}
              onEndpointDragStart={onEndpointDragStart}
              onEndpointDrop={onEndpointDrop}
              pendingEndpoint={pendingEndpoint}
              port={port}
              project={project}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function MotherboardIoRow({
  draggingEndpoint,
  hostRuntimeKey,
  motherboard,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  pendingEndpoint,
  project,
}: {
  draggingEndpoint: ConnectionEndpoint | null
  hostRuntimeKey: string
  motherboard: InventoryItem | undefined
  onEndpointClick: PcBuildNodeData['onEndpointClick']
  onEndpointDragStart: PcBuildNodeData['onEndpointDragStart']
  onEndpointDrop: PcBuildNodeData['onEndpointDrop']
  pendingEndpoint: ConnectionEndpoint | null
  project: ProjectState
}) {
  const ports = sortPorts(motherboard?.ports)

  if (!motherboard || ports.length === 0) return null

  const motherboardRuntimeKey = runtimeItemKey(motherboard)

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-[#171b22] p-1.5">
      <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.12em] text-[#cfc6b8]">
        Motherboard I/O
      </span>
      <div className="flex min-w-0 flex-wrap gap-1.5 overflow-visible">
        {ports.map((port) => (
          <PortChip
            key={port.id}
            draggingEndpoint={draggingEndpoint}
            endpoint={{ itemId: hostRuntimeKey, hostedItemId: motherboardRuntimeKey, portId: port.id }}
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

export function PcBuildNode({ data }: NodeProps<PcBuildFlowNode>) {
  const {
    project,
    pcBuildId,
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
  const pcBuild = project.items[pcBuildId]
  const pcBuildRuntimeKey = pcBuild ? runtimeItemKey(pcBuild) : pcBuildId
  const tapSelection = useTapSelection<HTMLDivElement>(() => onSelect(pcBuildRuntimeKey))
  const droppable = useDroppable({
    id: `server:${pcBuildId}`,
    data: { kind: 'server', serverId: pcBuildId },
  })
  const assignments = sortAssignmentsForDisplay(project, pcBuildId)
  const visibleSlotTypes = visiblePcBuildSlotTypes(project, pcBuildId)

  if (!pcBuild) return null

  const motherboardAssignment = assignments.find((assignment) => assignment.type === 'motherboard')
  const motherboard = motherboardAssignment ? project.items[motherboardAssignment.itemId] : undefined
  const operatingSystem = String(pcBuild.specs?.operatingSystem ?? '').trim()
  const displayName = pcBuild.properties?.displayName?.trim() || 'PC Build'
  const auditCount = getItemAuditWarnings(project, pcBuildRuntimeKey).length
  const focused = focusedItemIds.includes(pcBuildRuntimeKey)
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
      data-pc-build-card={pcBuildRuntimeKey}
      data-compatibility-drop={dropCompatibilityStatus}
      className={`relative w-[318px] rounded-lg border bg-[#20242c] p-2 text-[#f8f1e8] shadow-[0_20px_42px_rgba(32,36,44,0.26)] transition ${droppable.isOver && !dropCompatibilityStatus ? 'border-[#ddb668]' : 'border-[#11151b]'} ${!dropCompatibilityStatus && (selectedItemId === pcBuildRuntimeKey || focused) ? 'ring-2 ring-[#ddb668]' : ''} ${compatibilityDropRing} ${spotlightItemId === pcBuildRuntimeKey ? 'homelab-inventory-spotlight' : ''} ${dimmed ? 'opacity-35 grayscale' : ''}`}
      {...tapSelection}
    >
      {auditCount > 0 ? (
        <div className="absolute -right-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-[#ddb668] bg-[#fff2c7] px-2 text-[11px] font-black text-[#3d2a08] shadow-sm">
          <AlertTriangle className="size-3" />
          {auditCount}
        </div>
      ) : null}
      <CableHandles />
      <div className="server-node-drag-handle flex cursor-grab items-center gap-2 rounded-md bg-[#303744] px-3 py-2 active:cursor-grabbing">
        <Grip className="size-4 shrink-0 text-[#cfc6b8]" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{pcBuild.name}</div>
          <div className="truncate text-[11px] text-[#cfc6b8]">{displayName}</div>
        </div>
      </div>

      <MotherboardIoRow
        draggingEndpoint={draggingEndpoint}
        hostRuntimeKey={pcBuildRuntimeKey}
        motherboard={motherboard}
        onEndpointClick={onEndpointClick}
        onEndpointDragStart={onEndpointDragStart}
        onEndpointDrop={onEndpointDrop}
        pendingEndpoint={pendingEndpoint}
        project={project}
      />

      {operatingSystem ? (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-[#171b22] px-2 py-1.5 text-[11px]">
          <span className="font-black uppercase tracking-[0.1em] text-[#cfc6b8]">OS</span>
          <span className="min-w-0 truncate font-semibold">{operatingSystem}</span>
        </div>
      ) : null}

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
            if (!item) return null

            return (
              <AssignedComponentRow
                key={assignment.id}
                assignment={assignment}
                draggingEndpoint={draggingEndpoint}
                hostRuntimeKey={pcBuildRuntimeKey}
                item={item}
                onEndpointClick={onEndpointClick}
                onEndpointDragStart={onEndpointDragStart}
                onEndpointDrop={onEndpointDrop}
                onRemoveAssignment={onRemoveAssignment}
                onSelect={onSelect}
                pendingEndpoint={pendingEndpoint}
                project={project}
                selected={selectedItemId === runtimeItemKey(item)}
              />
            )
          })
        })}
      </div>
    </div>
  )
}
