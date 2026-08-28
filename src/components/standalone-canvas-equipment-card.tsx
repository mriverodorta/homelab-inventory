import { Handle, Position } from '@xyflow/react'
import { Grip } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { RegistryLinkIndicator } from '@/components/registry-link-indicator'
import { getEndpointHandleId, type CableSide } from '@/lib/cable-routing'
import {
  canvasEndpointAvailable,
  canvasEndpointConnected,
  type CanvasProjectIndex,
} from '@/lib/canvas-project-index'
import { runtimeItemKey } from '@/lib/item-keys'
import { EMPTY_REGISTRY_LINK_KEYS } from '@/lib/registry-links'
import { startSelectedPortDrag } from '@/lib/port-interactions'
import { endpointKey } from '@/lib/project'
import type { PowerEquipmentOrientation } from '@/lib/power-equipment-layout'
import { useTapSelection } from '@/lib/tap-selection'
import { cn } from '@/lib/utils'
import type { ConnectionEndpoint, InventoryItem } from '@/types/inventory'
import type {
  StandaloneCanvasNodeData,
  StandalonePortGroup,
  StandalonePortView,
} from '@/components/standalone-canvas-equipment-model'

type StandaloneCanvasEquipmentCardProps = StandaloneCanvasNodeData & {
  accentClassName: string
  children?: ReactNode
  eyebrow: string
  groups: StandalonePortGroup[]
  headerPort?: StandalonePortView
  icon?: ReactNode
  item: InventoryItem
  orientation?: PowerEquipmentOrientation
  summary?: string
  subtitle?: string
  width?: number
}

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

function endpointsMatch(first: ConnectionEndpoint, second: ConnectionEndpoint): boolean {
  return endpointKey(first) === endpointKey(second)
}

function CableHandles({ requiredHandleIds }: { requiredHandleIds: ReadonlySet<string> }) {
  return (
    <>
      {CABLE_HANDLES.flatMap((handle) => [
        requiredHandleIds.has(`target-${handle.id}`) ? (
          <Handle
            key={`target-${handle.id}`}
            id={`target-${handle.id}`}
            type="target"
            position={handle.position}
            className="!h-3 !w-3 !border-0 !bg-transparent"
            isConnectable={false}
            isConnectableStart={false}
            isConnectableEnd={false}
          />
        ) : null,
        requiredHandleIds.has(`source-${handle.id}`) ? (
          <Handle
            key={`source-${handle.id}`}
            id={`source-${handle.id}`}
            type="source"
            position={handle.position}
            className="!h-3 !w-3 !border-0 !bg-transparent"
            isConnectable={false}
            isConnectableStart={false}
            isConnectableEnd={false}
          />
        ) : null,
      ])}
    </>
  )
}

function PortHandles({ endpoint, requiredHandleIds }: {
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
              key={`target-${handle.side}`}
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
              key={`source-${handle.side}`}
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

function StandalonePortChip({
  draggingEndpoint,
  endpoint,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  pendingEndpoint,
  canvasIndex,
  requiredHandleIds,
  view,
}: {
  canvasIndex: CanvasProjectIndex
  draggingEndpoint: ConnectionEndpoint | null
  endpoint: ConnectionEndpoint
  onEndpointClick: StandaloneCanvasNodeData['onEndpointClick']
  onEndpointDragStart: StandaloneCanvasNodeData['onEndpointDragStart']
  onEndpointDrop: StandaloneCanvasNodeData['onEndpointDrop']
  pendingEndpoint: ConnectionEndpoint | null
  requiredHandleIds: ReadonlySet<string>
  view: StandalonePortView
}) {
  const connected = canvasEndpointConnected(canvasIndex, endpoint)
  const available = canvasEndpointAvailable(canvasIndex, endpoint)
  const selected = Boolean(pendingEndpoint && endpointsMatch(pendingEndpoint, endpoint))
  const dragSource = Boolean(draggingEndpoint && endpointsMatch(draggingEndpoint, endpoint))
  const canStartDrag = available && selected
  const canDrop = Boolean(draggingEndpoint && !dragSource && available)

  return (
    <div
      data-testid="standalone-port-chip"
      data-port-id={view.port.id}
      data-connected={connected ? 'true' : 'false'}
      className={`nodrag nopan relative flex h-11 min-w-11 shrink-0 flex-col items-center justify-center rounded border px-2 text-center leading-none transition ${view.tone} ${
        connected ? 'border-current/30 shadow-[inset_0_0_0_1px_rgba(31,35,43,0.16)]' : 'border-white/20'
      } ${available ? (selected ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : 'cursor-not-allowed'} ${
        selected || dragSource ? 'ring-2 ring-[#ddb668] ring-offset-1 ring-offset-[#20242c]' : ''
      } ${draggingEndpoint && !dragSource ? 'hover:ring-2 hover:ring-[#86a989]' : ''}`}
      title={view.detail ?? view.label}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (canStartDrag) {
          startSelectedPortDrag(event, endpoint, onEndpointDragStart)
        }
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (available && !selected) {
          onEndpointClick(endpoint, { x: event.clientX, y: event.clientY })
        }
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (canDrop) {
          onEndpointDrop(endpoint)
        }
      }}
    >
      <PortHandles endpoint={endpoint} requiredHandleIds={requiredHandleIds} />
      <span className="text-[8px] font-black uppercase tracking-[0.08em] opacity-75">{view.label}</span>
      <span className="mt-1 font-mono text-[12px] font-black">{String(view.port.slotNumber).padStart(2, '0')}</span>
    </div>
  )
}

export function StandaloneCanvasEquipmentCard({
  accentClassName,
  canvasIndex,
  children,
  draggingEndpoint,
  eyebrow,
  focusActive,
  focusedItemIds,
  groups,
  headerPort,
  icon,
  item,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  onSelect,
  orientation = 'horizontal',
  pendingEndpoint,
  registryLinkedItemKeys = EMPTY_REGISTRY_LINK_KEYS,
  requiredHandleIds,
  selectedItemId,
  spotlightItemId,
  summary,
  subtitle,
  width = 360,
}: StandaloneCanvasEquipmentCardProps) {
  const itemId = runtimeItemKey(item)
  const focused = focusedItemIds.includes(itemId)
  const dimmed = focusActive && !focused
  const tapSelection = useTapSelection<HTMLDivElement>(() => onSelect(itemId))

  return (
    <div
      data-testid="standalone-equipment-card"
      data-item-type={item.type}
      data-orientation={orientation}
      className={`relative rounded-lg border border-[#11151b] bg-[#20242c] p-2 text-[#f7f2e9] shadow-[0_16px_32px_rgba(32,36,44,0.2)] transition ${
        selectedItemId === itemId || focused ? 'ring-2 ring-[#ddb668]' : ''
      } ${spotlightItemId === itemId ? 'homelab-inventory-spotlight' : ''} ${dimmed ? 'opacity-35 grayscale' : ''}`}
      style={{ width } satisfies CSSProperties}
      {...tapSelection}
    >
      <CableHandles requiredHandleIds={requiredHandleIds} />
      <div className={`server-node-drag-handle flex cursor-grab items-center gap-3 rounded-md border border-white/5 px-3 py-2.5 active:cursor-grabbing ${accentClassName}`}>
        <Grip className="size-4 shrink-0 opacity-65" />
        {headerPort ? (
          <div data-header-port="true" className="shrink-0">
            <StandalonePortChip
              canvasIndex={canvasIndex}
              draggingEndpoint={draggingEndpoint}
              endpoint={headerPort.endpoint ?? { itemId, portId: headerPort.port.id }}
              onEndpointClick={onEndpointClick}
              onEndpointDragStart={onEndpointDragStart}
              onEndpointDrop={onEndpointDrop}
              pendingEndpoint={pendingEndpoint}
              requiredHandleIds={requiredHandleIds}
              view={headerPort}
            />
          </div>
        ) : icon ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded bg-black/15">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{item.name}</div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-[11px] font-semibold opacity-75">{subtitle}</div>
          ) : (
            <div className="mt-0.5 text-[9px] font-black uppercase tracking-[0.14em] opacity-65">{eyebrow}</div>
          )}
        </div>
        <RegistryLinkIndicator visible={registryLinkedItemKeys.has(itemId)} />
      </div>

      {summary ? (
        <div
          data-testid="standalone-equipment-summary"
          className={cn(
            'mt-2 rounded-md bg-[#13171d] px-3 py-2 text-[10px] font-bold text-[#d9d1c5]',
            orientation === 'vertical' && 'truncate whitespace-nowrap',
          )}
          title={orientation === 'vertical' ? summary : undefined}
        >
          {summary}
        </div>
      ) : null}

      {children}

      <div
        className={cn(
          'mt-2',
          orientation === 'vertical'
            ? 'grid grid-flow-col auto-cols-fr items-start gap-2'
            : 'space-y-2',
        )}
      >
        {groups.filter((group) => group.ports.length > 0).map((group) => (
          <section
            key={group.id}
            data-testid="standalone-port-group"
            data-port-group={group.id}
            data-port-layout={orientation}
            className="min-w-0 rounded-md bg-[#13171d] p-2"
          >
            <div
              data-port-group-label
              className="mb-2 h-5 overflow-hidden text-[8px] font-black uppercase leading-[10px] tracking-[0.18em] text-[#bcb3a7]"
              title={group.label}
            >
              {group.label}
            </div>
            <div
              className={cn(
                'flex gap-1.5 overflow-visible',
                orientation === 'vertical' ? 'flex-col items-center' : 'flex-wrap',
              )}
            >
              {group.ports.map((view) => (
                <StandalonePortChip
                  key={endpointKey(view.endpoint ?? { itemId, portId: view.port.id })}
                  canvasIndex={canvasIndex}
                  draggingEndpoint={draggingEndpoint}
                  endpoint={view.endpoint ?? { itemId, portId: view.port.id }}
                  onEndpointClick={onEndpointClick}
                  onEndpointDragStart={onEndpointDragStart}
                  onEndpointDrop={onEndpointDrop}
                  pendingEndpoint={pendingEndpoint}
                  requiredHandleIds={requiredHandleIds}
                  view={view}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
