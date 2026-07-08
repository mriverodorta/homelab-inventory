import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Grip } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getItemAuditWarnings } from '@/lib/audit'
import { getEndpointHandleId, type CableSide } from '@/lib/cable-routing'
import { formatEquipmentCanvasParts, formatPortType, type EquipmentCanvasPart } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { useTapSelection } from '@/lib/tap-selection'
import {
  connectionEndpointAvailable,
  endpointKey,
  EQUIPMENT_PORT_CHIP_WIDTH,
  getConnectionPort,
  getEquipmentCardWidth,
  portsCompatible,
} from '@/lib/project'
import { startSelectedPortDrag } from '@/lib/port-interactions'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortSide,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'
import type { CanvasPortDragPoint } from '@/types/canvas'

export type EquipmentNodeData = {
  project: ProjectState
  itemId: string
  selectedItemId: string | null
  focusedItemIds: string[]
  focusActive: boolean
  spotlightItemId: string | null
  pendingEndpoint: ConnectionEndpoint | null
  draggingEndpoint: ConnectionEndpoint | null
  onSelect: (itemId: string) => void
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
}

export type EquipmentFlowNode = Node<EquipmentNodeData, 'equipment'>

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
      {CABLE_HANDLES.map((handle) => (
        <Handle
          key={`target-${handle.id}`}
          id={`target-${handle.id}`}
          type="target"
          position={handle.position}
          className="!h-3 !w-3 !border-0 !bg-transparent"
          isConnectable={false}
        />
      ))}
      {CABLE_HANDLES.map((handle) => (
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

function equipmentTone(item: InventoryItem): string {
  if (item.type === 'switch') {
    return 'border-[#81a6a0] bg-[#1f3536] text-[#f3fbf9]'
  }

  return 'border-[#a995c8] bg-[#322b45] text-[#faf7ff]'
}

function partTone(label: EquipmentCanvasPart['label']): string {
  if (label === 'ports') {
    return 'bg-[#d3eee7] text-[#143733]'
  }

  if (label === 'uplinks') {
    return 'bg-[#d8ddf4] text-[#1b2448]'
  }

  if (label === 'management') {
    return 'bg-[#e5efc8] text-[#26360f]'
  }

  if (label === 'rackUnits') {
    return 'bg-[#f3dfc1] text-[#3a2812]'
  }

  return 'bg-[#ead8f4] text-[#332047]'
}

function sortPorts(ports: InventoryPort[] | undefined): InventoryPort[] {
  return [...(ports ?? [])].sort((first, second) => first.slotNumber - second.slotNumber)
}

function endpointMatches(first: ConnectionEndpoint, second: ConnectionEndpoint): boolean {
  return first.itemId === second.itemId &&
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

function portSpeedLabel(port: InventoryPort): string {
  if (port.speed) {
    return port.speed
  }

  return formatPortType(port.type)
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
      data-testid="equipment-port-chip"
      data-port-id={port.id}
      data-endpoint-id={endpoint.endpointId ?? 'port'}
      className={`nodrag nopan relative flex h-[30px] shrink-0 items-center justify-center rounded px-1 text-center leading-none transition ${portTone(
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
      <PortChipHandles endpoint={endpoint} />
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

function SwitchPortRow({
  draggingEndpoint,
  item,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  pendingEndpoint,
  project,
}: {
  draggingEndpoint: ConnectionEndpoint | null
  item: InventoryItem
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  pendingEndpoint: ConnectionEndpoint | null
  project: ProjectState
}) {
  const ports = sortPorts(item.ports)
  const itemRuntimeKey = runtimeItemKey(item)

  if (ports.length === 0) {
    return null
  }

  return (
    <div className="mt-2 flex gap-1.5 overflow-visible rounded-md bg-black/10 p-2">
      {ports.map((port) => (
        <PortChip
          key={port.id}
          draggingEndpoint={draggingEndpoint}
          endpoint={{ itemId: itemRuntimeKey, portId: port.id }}
          onEndpointClick={onEndpointClick}
          onEndpointDragStart={onEndpointDragStart}
          onEndpointDrop={onEndpointDrop}
          pendingEndpoint={pendingEndpoint}
          port={port}
          project={project}
        />
      ))}
    </div>
  )
}

function getPortEndpoint(port: InventoryPort, side: InventoryPortSide): ConnectionEndpoint | null {
  const endpoint = port.endpoints?.find((candidate) => candidate.side === side)

  if (!endpoint) {
    return null
  }

  return {
    itemId: '',
    portId: port.id,
    endpointId: endpoint.id,
  }
}

function PatchPanelPortRow({
  draggingEndpoint,
  item,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  pendingEndpoint,
  project,
  side,
}: {
  draggingEndpoint: ConnectionEndpoint | null
  item: InventoryItem
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  pendingEndpoint: ConnectionEndpoint | null
  project: ProjectState
  side: InventoryPortSide
}) {
  const ports = sortPorts(item.ports)
  const itemRuntimeKey = runtimeItemKey(item)
  const endpoints = ports
    .map((port) => {
      const endpoint = getPortEndpoint(port, side)

      return endpoint ? { port, endpoint: { ...endpoint, itemId: itemRuntimeKey } } : null
    })
    .filter((entry): entry is { port: InventoryPort; endpoint: ConnectionEndpoint } => entry !== null)

  if (endpoints.length === 0) {
    return null
  }

  return (
    <div className="mt-2 overflow-visible rounded-md bg-black/10 p-2">
      <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.16em] opacity-75">
        {side}
      </div>
      <div className="flex gap-1.5 overflow-visible">
        {endpoints.map(({ port, endpoint }) => (
          <PortChip
            key={`${port.id}-${endpoint.endpointId}`}
            draggingEndpoint={draggingEndpoint}
            endpoint={endpoint}
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

function EquipmentPortRows({
  draggingEndpoint,
  item,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  pendingEndpoint,
  project,
}: {
  draggingEndpoint: ConnectionEndpoint | null
  item: InventoryItem
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  pendingEndpoint: ConnectionEndpoint | null
  project: ProjectState
}) {
  if (item.type === 'switch') {
    return (
      <SwitchPortRow
        draggingEndpoint={draggingEndpoint}
        item={item}
        onEndpointClick={onEndpointClick}
        onEndpointDragStart={onEndpointDragStart}
        onEndpointDrop={onEndpointDrop}
        pendingEndpoint={pendingEndpoint}
        project={project}
      />
    )
  }

  if (item.type === 'patchPanel') {
    return (
      <>
        <PatchPanelPortRow
          draggingEndpoint={draggingEndpoint}
          item={item}
          onEndpointClick={onEndpointClick}
          onEndpointDragStart={onEndpointDragStart}
          onEndpointDrop={onEndpointDrop}
          pendingEndpoint={pendingEndpoint}
          project={project}
          side="back"
        />
        <PatchPanelPortRow
          draggingEndpoint={draggingEndpoint}
          item={item}
          onEndpointClick={onEndpointClick}
          onEndpointDragStart={onEndpointDragStart}
          onEndpointDrop={onEndpointDrop}
          pendingEndpoint={pendingEndpoint}
          project={project}
          side="front"
        />
      </>
    )
  }

  return null
}

export function EquipmentNode({ data }: NodeProps<EquipmentFlowNode>) {
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
    onEndpointClick,
    onEndpointDragStart,
    onEndpointDrop,
  } = data
  const item = project.items[itemId]
  const itemRuntimeKey = item ? runtimeItemKey(item) : itemId
  const tapSelection = useTapSelection<HTMLDivElement>(() => onSelect(itemRuntimeKey))

  if (!item) {
    return null
  }

  const parts = formatEquipmentCanvasParts(item)
  const auditCount = getItemAuditWarnings(project, itemRuntimeKey).length
  const focused = focusedItemIds.includes(itemRuntimeKey)
  const dimmed = focusActive && !focused
  const cardWidth = getEquipmentCardWidth(item)

  return (
    <div
      className={`relative min-w-[282px] rounded-lg border p-2 shadow-[0_18px_36px_rgba(32,36,44,0.22)] transition ${equipmentTone(item)} ${
        selectedItemId === itemRuntimeKey || focused ? 'ring-2 ring-[#ddb668]' : ''
      } ${spotlightItemId === itemRuntimeKey ? 'homelab-inventory-spotlight' : ''} ${dimmed ? 'opacity-35 grayscale' : ''}`}
      style={{ width: cardWidth } satisfies CSSProperties}
      {...tapSelection}
    >
      {auditCount > 0 ? (
        <div className="absolute -right-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-[#ddb668] bg-[#fff2c7] px-2 text-[11px] font-black text-[#3d2a08] shadow-sm">
          <AlertTriangle className="size-3" />
          {auditCount}
        </div>
      ) : null}
      <CableHandles />
      <div className="server-node-drag-handle flex cursor-grab items-center gap-2 rounded-md bg-white/10 px-3 py-2 active:cursor-grabbing">
        <Grip className="size-4 shrink-0 text-current opacity-70" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{item.name}</div>
        </div>
      </div>

      {parts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-md bg-black/10 p-2">
          {parts.map((part) => (
            <span
              key={part.label}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${partTone(part.label)}`}
            >
              {part.value}
            </span>
          ))}
        </div>
      ) : null}
      <EquipmentPortRows
        draggingEndpoint={draggingEndpoint}
        item={item}
        onEndpointDragStart={onEndpointDragStart}
        onEndpointDrop={onEndpointDrop}
        onEndpointClick={onEndpointClick}
        pendingEndpoint={pendingEndpoint}
        project={project}
      />
    </div>
  )
}
