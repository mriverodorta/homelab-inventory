import { useDroppable } from '@dnd-kit/core'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type EdgeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
  type OnNodesChange,
  type Viewport,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import { CableEdge, type CableFlowEdge } from '@/components/cable-edge'
import { CanvasCommandBar } from '@/components/canvas-command-bar'
import { EquipmentNode, type EquipmentFlowNode } from '@/components/equipment-card'
import { MonitorNode, type MonitorFlowNode } from '@/components/monitor-card'
import { NasNode, type NasFlowNode } from '@/components/nas-card'
import { PcBuildNode, type PcBuildFlowNode } from '@/components/pc-build-card'
import { PowerStripNode, type PowerStripFlowNode } from '@/components/power-strip-card'
import { ServerNode, type ServerFlowNode } from '@/components/server-card'
import { UpsNode, type UpsFlowNode } from '@/components/ups-card'
import { getProjectAuditWarnings } from '@/lib/audit'
import { connectionMatchesSelectedItem, getFocusedCableItemIds } from '@/lib/cable-focus'
import { getConnectionRoute } from '@/lib/cable-routing'
import { describeConnection, getCableAppearance } from '@/lib/cables'
import { formatRemainingSeconds } from '@/lib/demo-api'
import {
  findAssignmentById,
  getAssignedComponentDropGeometryError,
  moveAssignedComponent,
  tryAssignComponent,
} from '@/lib/constraints'
import { runtimeItemKey } from '@/lib/item-keys'
import { getCanvasItemHeight, getCanvasItemWidth, isCanvasItem, placementCollides } from '@/lib/project'
import { cn } from '@/lib/utils'
import type { AgentStatusSummary } from '@/types/agent'
import type { CompatibilityStatus } from '@/types/compatibility'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  InventoryItem,
  ProjectState,
} from '@/types/inventory'
import type { CanvasPortDragPoint } from '@/types/canvas'

export const GRID_SIZE = 24
export type ValidationMessageSeverity = 'error' | 'unknown'

export type ComponentDragData =
  | {
      kind: 'inventory'
      itemId: string
    }
  | {
      kind: 'assigned-component'
      assignmentId: string | number
      itemId: string
      sourceServerId: string
    }

export function CompatibilityDropAnnouncement({
  hostName,
  status,
}: {
  hostName?: string
  status?: CompatibilityStatus
}) {
  const message = hostName && status
    ? `${hostName}: ${status} component compatibility.`
    : ''

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}

export function getComponentDropCompatibilityStatus(
  project: ProjectState,
  dragData: ComponentDragData,
  targetHostId: string,
): CompatibilityStatus | null {
  if (dragData.kind === 'inventory') {
    const item = project.items[dragData.itemId]

    if (!item) return 'incompatible'
    if (isCanvasItem(item)) {
      return null
    }

    const transition = tryAssignComponent(project, targetHostId, dragData.itemId)

    if (!transition.ok) return 'incompatible'

    const targetPlacement = transition.project.placements.find(
      (placement) => placement.serverId === targetHostId,
    )

    if (targetPlacement && placementCollides(transition.project, targetPlacement)) {
      return 'incompatible'
    }

    return transition.unknownFindings.length > 0 ? 'unknown' : 'compatible'
  }

  const assignment = findAssignmentById(project.assignments, dragData.assignmentId)

  if (!assignment) return 'incompatible'

  const transition = moveAssignedComponent(project, assignment.id, targetHostId)

  if (!transition.ok) return 'incompatible'

  if (getAssignedComponentDropGeometryError(
    project,
    transition.project,
    assignment,
    targetHostId,
  )) {
    return 'incompatible'
  }

  return transition.unknownFindings.length > 0 ? 'unknown' : 'compatible'
}

export type CanvasProjector = (point: XYPosition) => XYPosition
export type CanvasFocusOptions = Record<string, never>
export type CanvasController = {
  screenToFlowPosition: CanvasProjector
  focusItem: (itemId: string, options?: CanvasFocusOptions) => void
}

const nodeTypes: NodeTypes = {
  equipment: EquipmentNode,
  monitor: MonitorNode,
  nas: NasNode,
  pcBuild: PcBuildNode,
  powerStrip: PowerStripNode,
  server: ServerNode,
  ups: UpsNode,
}

const edgeTypes: EdgeTypes = {
  cable: CableEdge,
}

type WorkbenchFlowNode =
  | ServerFlowNode
  | EquipmentFlowNode
  | MonitorFlowNode
  | NasFlowNode
  | PcBuildFlowNode
  | PowerStripFlowNode
  | UpsFlowNode

const INSPECTOR_DRAWER_SELECTOR = '[data-testid="inspector-drawer"]'
const FOCUS_MARGIN = 72
const DEFAULT_NODE_DRAG_THRESHOLD = 6
const TOUCH_NODE_DRAG_LOCK_THRESHOLD = 100_000
const TOUCH_DRAG_HOLD_MS = 350
const TOUCH_DRAG_TOLERANCE_PX = 8

type TouchNodeDragGate = {
  timer: number | null
  startX: number
  startY: number
  lastX: number
  lastY: number
  armed: boolean
  allowNodeDrag: boolean
  canceled: boolean
  panning: boolean
}

function sameOptionalId(first: string | number | null | undefined, second: string | number | null | undefined): boolean {
  return first != null && second != null && String(first) === String(second)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function getCanvasNodeId(item: InventoryItem): string {
  const key = runtimeItemKey(item)

  if (item.type === 'server') {
    return `server-node:${key}`
  }

  if (item.type === 'nas') {
    return `nas-node:${key}`
  }

  if (item.type === 'pcBuild') {
    return `pc-build-node:${key}`
  }

  if (item.type === 'monitor' || item.type === 'ups' || item.type === 'powerStrip') {
    return `${item.type}-node:${key}`
  }

  return `equipment-node:${key}`
}

function endpointBelongsToItem(endpoint: ConnectionEndpoint | null, itemId: string): boolean {
  return endpoint?.itemId === itemId
}

function getItemIdFromNodeId(nodeId: string): string {
  return nodeId
    .replace('server-node:', '')
    .replace('nas-node:', '')
    .replace('pc-build-node:', '')
    .replace('monitor-node:', '')
    .replace('ups-node:', '')
    .replace('powerStrip-node:', '')
    .replace('equipment-node:', '')
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

function CanvasViewport({
  project,
  agentStatus,
  selectedItemId,
  selectedConnectionId,
  spotlightItemId,
  activeNetworkTraceConnectionIds,
  activeNetworkTraceItemIds,
  pendingEndpoint,
  draggingEndpoint,
  dropCompatibilityByHostId,
  validationMessage,
  validationSeverity = 'error',
  demoRemainingSeconds,
  onSelect,
  onSelectConnection,
  onRemoveAssignment,
  onMoveItem,
  onMoveItems,
  onEndpointClick,
  onEndpointDragStart,
  onEndpointDrop,
  onUpdateConnectionRoute,
  onViewportReady,
  onCanvasClick,
  canUndo,
  canRedo,
  saveStatus,
  autoCenterOnSelect,
  cablesVisible,
  updateAvailable,
  updateStatusLoading,
  desktopInventoryVisible,
  inspectorOpen,
  onUndo,
  onRedo,
  onToggleAutoCenterOnSelect,
  onAutoArrange,
  onOpenAudit,
  onOpenUpdate,
  onOpenInventory,
  onToggleCablesVisible,
  onOpenSettings,
}: {
  project: ProjectState
  agentStatus: AgentStatusSummary | null
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  spotlightItemId: string | null
  activeNetworkTraceConnectionIds: Array<string | number>
  activeNetworkTraceItemIds: string[]
  pendingEndpoint: ConnectionEndpoint | null
  draggingEndpoint: ConnectionEndpoint | null
  dropCompatibilityByHostId: Readonly<Record<string, CompatibilityStatus | undefined>>
  validationMessage: string | null
  validationSeverity?: ValidationMessageSeverity
  demoRemainingSeconds?: number | null
  canUndo: boolean
  canRedo: boolean
  saveStatus: 'saved' | 'saving' | 'error'
  autoCenterOnSelect: boolean
  cablesVisible: boolean
  updateAvailable: boolean
  updateStatusLoading: boolean
  desktopInventoryVisible: boolean
  inspectorOpen: boolean
  onSelect: (itemId: string) => void
  onSelectConnection: (connectionId: string | number) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onMoveItem: (itemId: string, position: XYPosition) => boolean
  onMoveItems: (placements: Array<{ serverId: string; x: number; y: number }>) => boolean
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionRoute: (connectionId: string | number, route: ConnectionRoutePreferences) => void
  onViewportReady: (canvasController: CanvasController) => void
  onCanvasClick: () => void
  onUndo: () => void
  onRedo: () => void
  onToggleAutoCenterOnSelect: () => void
  onAutoArrange: () => void
  onOpenAudit: () => void
  onOpenUpdate: () => void
  onOpenInventory: () => void
  onToggleCablesVisible: () => void
  onOpenSettings: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'canvas',
    data: {
      kind: 'canvas',
    },
  })
  const { getViewport, screenToFlowPosition, setViewport } = useReactFlow()
  const canvasRootRef = useRef<HTMLElement | null>(null)
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | number | null>(null)
  const [nodeDragThreshold, setNodeDragThreshold] = useState(DEFAULT_NODE_DRAG_THRESHOLD)
  const touchNodeDragGateRef = useRef<TouchNodeDragGate | null>(null)
  const auditWarningCount = useMemo(
    () => getProjectAuditWarnings(project).reduce((count, group) => count + group.warnings.length, 0),
    [project],
  )
  const focusedItemIds = useMemo(
    () => [
      ...new Set([
        ...getFocusedCableItemIds(project, selectedItemId, selectedConnectionId),
        ...activeNetworkTraceItemIds,
      ]),
    ],
    [activeNetworkTraceItemIds, project, selectedConnectionId, selectedItemId],
  )
  const activeNetworkTraceConnectionIdSet = useMemo(
    () => new Set(activeNetworkTraceConnectionIds.map((connectionId) => String(connectionId))),
    [activeNetworkTraceConnectionIds],
  )
  const focusActive = focusedItemIds.length > 0
  const flowNodes = useMemo<WorkbenchFlowNode[]>(
    () => {
      const nextNodes: WorkbenchFlowNode[] = []

      for (const placement of project.placements) {
        const item = project.items[placement.serverId]

        if (!item) {
          continue
        }

        if (item.type === 'server') {
          const nodeActive = selectedItemId === placement.serverId ||
            endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
            endpointBelongsToItem(draggingEndpoint, placement.serverId)
          const node: ServerFlowNode = {
            id: `server-node:${placement.serverId}`,
            type: 'server',
            position: {
              x: placement.x,
              y: placement.y,
            },
            zIndex: nodeActive ? 1000 : focusActive && !focusedItemIds.includes(placement.serverId) ? 0 : 1,
            dragHandle: '.server-node-drag-handle',
            data: {
              project,
              agentStatus,
              serverId: placement.serverId,
              selectedItemId,
              focusedItemIds,
              focusActive,
              spotlightItemId,
              pendingEndpoint,
              draggingEndpoint,
              dropCompatibilityStatus: dropCompatibilityByHostId[placement.serverId],
              onSelect,
              onRemoveAssignment,
              onEndpointClick,
              onEndpointDragStart,
              onEndpointDrop,
            },
          }

          nextNodes.push(node)
          continue
        }

        if (item.type === 'nas') {
          const nodeActive = selectedItemId === placement.serverId ||
            endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
            endpointBelongsToItem(draggingEndpoint, placement.serverId)
          const node: NasFlowNode = {
            id: `nas-node:${placement.serverId}`,
            type: 'nas',
            position: {
              x: placement.x,
              y: placement.y,
            },
            zIndex: nodeActive ? 1000 : focusActive && !focusedItemIds.includes(placement.serverId) ? 0 : 1,
            dragHandle: '.server-node-drag-handle',
            data: {
              project,
              itemId: placement.serverId,
              selectedItemId,
              focusedItemIds,
              focusActive,
              spotlightItemId,
              pendingEndpoint,
              draggingEndpoint,
              dropCompatibilityStatus: dropCompatibilityByHostId[placement.serverId],
              onSelect,
              onRemoveAssignment,
              onEndpointClick,
              onEndpointDragStart,
              onEndpointDrop,
            },
          }

          nextNodes.push(node)
          continue
        }

        if (item.type === 'pcBuild') {
          const nodeActive = selectedItemId === placement.serverId ||
            endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
            endpointBelongsToItem(draggingEndpoint, placement.serverId)
          const node: PcBuildFlowNode = {
            id: `pc-build-node:${placement.serverId}`,
            type: 'pcBuild',
            position: {
              x: placement.x,
              y: placement.y,
            },
            zIndex: nodeActive ? 1000 : focusActive && !focusedItemIds.includes(placement.serverId) ? 0 : 1,
            dragHandle: '.server-node-drag-handle',
            data: {
              project,
              pcBuildId: placement.serverId,
              selectedItemId,
              focusedItemIds,
              focusActive,
              spotlightItemId,
              pendingEndpoint,
              draggingEndpoint,
              dropCompatibilityStatus: dropCompatibilityByHostId[placement.serverId],
              onSelect,
              onRemoveAssignment,
              onEndpointClick,
              onEndpointDragStart,
              onEndpointDrop,
            },
          }

          nextNodes.push(node)
          continue
        }

        const standaloneData = {
          project,
          itemId: placement.serverId,
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
        }
        const standaloneNodeBase = {
          position: {
            x: placement.x,
            y: placement.y,
          },
          zIndex: selectedItemId === placement.serverId ||
            endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
            endpointBelongsToItem(draggingEndpoint, placement.serverId)
            ? 1000
            : focusActive && !focusedItemIds.includes(placement.serverId) ? 0 : 1,
          dragHandle: '.server-node-drag-handle',
        }

        if (item.type === 'monitor') {
          nextNodes.push({
            ...standaloneNodeBase,
            id: `monitor-node:${placement.serverId}`,
            type: 'monitor',
            data: standaloneData,
          } satisfies MonitorFlowNode)
          continue
        }

        if (item.type === 'ups') {
          nextNodes.push({
            ...standaloneNodeBase,
            id: `ups-node:${placement.serverId}`,
            type: 'ups',
            data: standaloneData,
          } satisfies UpsFlowNode)
          continue
        }

        if (item.type === 'powerStrip') {
          nextNodes.push({
            ...standaloneNodeBase,
            id: `powerStrip-node:${placement.serverId}`,
            type: 'powerStrip',
            data: standaloneData,
          } satisfies PowerStripFlowNode)
          continue
        }

        const nodeActive = selectedItemId === placement.serverId ||
          endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
          endpointBelongsToItem(draggingEndpoint, placement.serverId)
        const node: EquipmentFlowNode = {
          id: `equipment-node:${placement.serverId}`,
          type: 'equipment',
          position: {
            x: placement.x,
            y: placement.y,
          },
          zIndex: nodeActive ? 1000 : focusActive && !focusedItemIds.includes(placement.serverId) ? 0 : 1,
          dragHandle: '.server-node-drag-handle',
          data: {
            project,
            itemId: placement.serverId,
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
          },
        }

        nextNodes.push(node)
      }

      return nextNodes
    },
    [
      draggingEndpoint,
      dropCompatibilityByHostId,
      agentStatus,
      focusActive,
      focusedItemIds,
      onEndpointClick,
      onEndpointDragStart,
      onEndpointDrop,
      onRemoveAssignment,
      onSelect,
      pendingEndpoint,
      project,
      selectedItemId,
      spotlightItemId,
    ],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkbenchFlowNode>(flowNodes)
  const resetTouchNodeDragGate = useCallback(() => {
    const gate = touchNodeDragGateRef.current

    if (gate?.timer != null) {
      window.clearTimeout(gate.timer)
    }

    touchNodeDragGateRef.current = null
    setNodeDragThreshold(DEFAULT_NODE_DRAG_THRESHOLD)
  }, [])
  const panViewportByScreenDelta = useCallback((deltaX: number, deltaY: number) => {
    const viewport = getViewport()

    void setViewport({
      x: viewport.x + deltaX,
      y: viewport.y + deltaY,
      zoom: viewport.zoom,
    })
  }, [getViewport, setViewport])
  const armTouchNodeDragGate = useCallback((
    startX: number,
    startY: number,
    allowNodeDrag: boolean,
  ) => {
    resetTouchNodeDragGate()
    setNodeDragThreshold(TOUCH_NODE_DRAG_LOCK_THRESHOLD)

    const gate: TouchNodeDragGate = {
      timer: null,
      startX,
      startY,
      lastX: startX,
      lastY: startY,
      armed: false,
      allowNodeDrag,
      canceled: false,
      panning: false,
    }

    if (allowNodeDrag) {
      gate.timer = window.setTimeout(() => {
        if (touchNodeDragGateRef.current !== gate || gate.canceled || gate.panning) {
          return
        }

        gate.armed = true
        gate.timer = null
        setNodeDragThreshold(0)
      }, TOUCH_DRAG_HOLD_MS)
    }

    touchNodeDragGateRef.current = gate
  }, [resetTouchNodeDragGate])
  const panOrCancelTouchNodeDragGate = useCallback((
    clientX: number,
    clientY: number,
  ) => {
    const gate = touchNodeDragGateRef.current

    if (!gate || gate.armed) {
      return false
    }

    if (gate.panning) {
      const panDeltaX = clientX - gate.lastX
      const panDeltaY = clientY - gate.lastY
      gate.lastX = clientX
      gate.lastY = clientY

      panViewportByScreenDelta(panDeltaX, panDeltaY)
      return true
    }

    if (gate.canceled) {
      return false
    }

    const totalDeltaX = clientX - gate.startX
    const totalDeltaY = clientY - gate.startY

    if (!gate.panning && Math.hypot(totalDeltaX, totalDeltaY) <= TOUCH_DRAG_TOLERANCE_PX) {
      return false
    }

    gate.panning = true
    gate.canceled = true

    if (gate.timer != null) {
      window.clearTimeout(gate.timer)
      gate.timer = null
    }

    const panDeltaX = clientX - gate.lastX
    const panDeltaY = clientY - gate.lastY
    gate.lastX = clientX
    gate.lastY = clientY

    panViewportByScreenDelta(panDeltaX, panDeltaY)
    return true
  }, [panViewportByScreenDelta])
  const handleFlowPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return
    }

    const target = event.target

    if (!(target instanceof Element) || !target.closest('.react-flow__node')) {
      return
    }

    armTouchNodeDragGate(
      event.clientX,
      event.clientY,
      Boolean(target.closest('.server-node-drag-handle')),
    )
  }, [armTouchNodeDragGate])
  const handleFlowPointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return
    }

    if (panOrCancelTouchNodeDragGate(event.clientX, event.clientY)) {
      event.preventDefault()
    }
  }, [panOrCancelTouchNodeDragGate])
  const handleFlowPointerEndCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      resetTouchNodeDragGate()
    }
  }, [resetTouchNodeDragGate])
  const handleFlowTouchStartCapture = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]

    if (!touch) {
      return
    }

    const target = event.target

    if (!(target instanceof Element) || !target.closest('.react-flow__node')) {
      return
    }

    armTouchNodeDragGate(
      touch.clientX,
      touch.clientY,
      Boolean(target.closest('.server-node-drag-handle')),
    )
  }, [armTouchNodeDragGate])
  const handleFlowTouchMoveCapture = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]

    if (!touch) {
      return
    }

    if (panOrCancelTouchNodeDragGate(touch.clientX, touch.clientY)) {
      event.preventDefault()
    }
  }, [panOrCancelTouchNodeDragGate])
  const flowEdges = useMemo<CableFlowEdge[]>(
    () => {
      if (!cablesVisible) {
        return []
      }

      const placedItemIds = new Set(project.placements.map((placement) => placement.serverId))

      return (project.connections ?? []).flatMap((connection, connectionIndex) => {
        const fromItem = project.items[connection.from.itemId]
        const toItem = project.items[connection.to.itemId]

        const fromItemKey = fromItem ? runtimeItemKey(fromItem) : null
        const toItemKey = toItem ? runtimeItemKey(toItem) : null

        if (
          !fromItem ||
          !toItem ||
          !fromItemKey ||
          !toItemKey ||
          !placedItemIds.has(fromItemKey) ||
          !placedItemIds.has(toItemKey)
        ) {
          return []
        }

        const appearance = getCableAppearance(project, connection)
        const route = getConnectionRoute(project, connection, connectionIndex)
        const isSelected = sameOptionalId(selectedConnectionId, connection.id)
        const isHovered = sameOptionalId(hoveredConnectionId, connection.id)
        const isTraceConnection = activeNetworkTraceConnectionIdSet.has(String(connection.id))
        const isRelatedToSelectedItem = connectionMatchesSelectedItem(
          selectedItemId,
          connection.from.itemId,
          connection.to.itemId,
        )
        const focusModeActive = Boolean(selectedConnectionId || selectedItemId || activeNetworkTraceConnectionIds.length > 0)
        const dimmed = focusModeActive && !isSelected && !isTraceConnection && !isRelatedToSelectedItem

        if (!route) {
          return []
        }

        return [
          {
            id: `cable:${connection.id}`,
            source: getCanvasNodeId(fromItem),
            target: getCanvasNodeId(toItem),
            sourceHandle: route.sourceHandle,
            targetHandle: route.targetHandle,
            type: 'cable',
            data: {
              color: appearance.color,
              label: connection.label?.trim() || appearance.label,
              detail: describeConnection(project, connection),
              laneOffset: route.laneOffset,
              selected: isSelected || isHovered || isTraceConnection,
              editable: isSelected || isHovered,
              traced: isTraceConnection,
              dimmed,
              connectionId: connection.id,
              route: connection.route,
              onSelect: onSelectConnection,
              onUpdateRoute: onUpdateConnectionRoute,
            },
            style: {
              stroke: appearance.color,
              strokeWidth: isSelected || isHovered || isTraceConnection ? 6 : 4,
              filter: 'drop-shadow(0 2px 3px rgba(32, 36, 44, 0.2))',
            },
            zIndex: isSelected || isHovered || isTraceConnection ? 12 : dimmed ? 0 : 8,
            interactionWidth: 18,
            selectable: true,
            focusable: false,
          },
        ]
      })
    },
    [
      activeNetworkTraceConnectionIdSet,
      activeNetworkTraceConnectionIds.length,
      cablesVisible,
      hoveredConnectionId,
      onSelectConnection,
      onUpdateConnectionRoute,
      project,
      selectedConnectionId,
      selectedItemId,
    ],
  )

  const correctFocusViewport = useCallback(
    (placedItemId: string) => {
      const root = canvasRootRef.current
      const rootRect = root?.getBoundingClientRect()

      if (!rootRect) {
        return
      }

      const item = project.items[placedItemId]

      if (!item) {
        return
      }

      const nodeElement = document.querySelector(
        `[data-testid="rf__node-${getCanvasNodeId(item)}"]`,
      )
      const rectangles = [nodeElement]
        .filter((element): element is Element => Boolean(element))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)

      if (rectangles.length === 0) {
        return
      }

      const drawer = document.querySelector(INSPECTOR_DRAWER_SELECTOR)
      const drawerRect = drawer?.getAttribute('aria-hidden') === 'true'
        ? null
        : drawer?.getBoundingClientRect()
      const visibleRight = drawerRect
        ? Math.max(rootRect.left, Math.min(rootRect.right, drawerRect.left))
        : rootRect.right
      const visibleLeft = rootRect.left
      const visibleTop = rootRect.top
      const visibleBottom = rootRect.bottom
      const bounds = {
        left: Math.min(...rectangles.map((rect) => rect.left)),
        right: Math.max(...rectangles.map((rect) => rect.right)),
        top: Math.min(...rectangles.map((rect) => rect.top)),
        bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
      }
      const viewport = getViewport()
      const horizontalMargin = 24
      const verticalMargin = 28
      const availableWidth = visibleRight - visibleLeft
      const boundsWidth = bounds.right - bounds.left
      const canFitHorizontally = boundsWidth <= availableWidth - horizontalMargin * 2
      let nextX = viewport.x
      let nextY = viewport.y

      if (bounds.right > visibleRight - horizontalMargin) {
        nextX -= bounds.right - (visibleRight - horizontalMargin)
      }

      if (canFitHorizontally && bounds.left < visibleLeft + horizontalMargin) {
        nextX += visibleLeft + horizontalMargin - bounds.left
      }

      if (bounds.bottom > visibleBottom - verticalMargin) {
        nextY -= bounds.bottom - (visibleBottom - verticalMargin)
      }

      if (bounds.top < visibleTop + verticalMargin) {
        nextY += visibleTop + verticalMargin - bounds.top
      }

      if (Math.abs(nextX - viewport.x) > 1 || Math.abs(nextY - viewport.y) > 1) {
        void setViewport(
          {
            ...viewport,
            x: nextX,
            y: nextY,
          },
          { duration: 220 },
        )
      }
    },
    [getViewport, project.items, setViewport],
  )

  const focusItem = useCallback(
    (itemId: string, _options: CanvasFocusOptions = {}) => {
      const placedItemId = project.placements.some((candidate) => candidate.serverId === itemId)
        ? itemId
        : project.assignments.find((assignment) => assignment.itemId === itemId)?.serverId ?? itemId
      const placement = project.placements.find((candidate) => candidate.serverId === placedItemId)

      if (!placement) {
        return
      }

      const root = canvasRootRef.current
      const rootRect = root?.getBoundingClientRect()

      if (!rootRect) {
        return
      }

      const cardWidth = getCanvasItemWidth(project, placedItemId)
      const cardHeight = getCanvasItemHeight(project, placedItemId)
      const focusWidth = cardWidth
      const focusHeight = cardHeight
      const drawer = document.querySelector(INSPECTOR_DRAWER_SELECTOR)
      const drawerRect = drawer?.getAttribute('aria-hidden') === 'true'
        ? null
        : drawer?.getBoundingClientRect()
      const visibleRight = drawerRect
        ? Math.max(rootRect.left, Math.min(rootRect.right, drawerRect.left))
        : rootRect.right
      const availableWidth = Math.max(280, visibleRight - rootRect.left)
      const availableHeight = Math.max(280, rootRect.height)
      const availableCenter = {
        x: availableWidth / 2,
        y: availableHeight / 2,
      }
      const zoom = clamp(
        Math.min(
          0.95,
          (availableWidth - FOCUS_MARGIN) / focusWidth,
          (availableHeight - FOCUS_MARGIN) / focusHeight,
        ),
        0.25,
        0.95,
      )
      const focusCenter = {
        x: placement.x + focusWidth / 2,
        y: placement.y + focusHeight / 2,
      }
      const viewport: Viewport = {
        x: availableCenter.x - focusCenter.x * zoom,
        y: availableCenter.y - focusCenter.y * zoom,
        zoom,
      }

      void setViewport(viewport, {
        duration: 500,
      })

      window.setTimeout(() => {
        correctFocusViewport(placedItemId)
      }, 80)
      window.setTimeout(() => {
        correctFocusViewport(placedItemId)
      }, 560)
    },
    [correctFocusViewport, project, setViewport],
  )

  useEffect(() => {
    onViewportReady({
      screenToFlowPosition,
      focusItem,
    })
  }, [focusItem, onViewportReady, screenToFlowPosition])

  useEffect(() => {
    setNodes(flowNodes)
  }, [flowNodes, setNodes])

  useEffect(() => resetTouchNodeDragGate, [resetTouchNodeDragGate])

  const handleNodesChange: OnNodesChange<WorkbenchFlowNode> = (changes) => {
    onNodesChange(changes)
  }

  const handleNodeDragStop: OnNodeDrag<WorkbenchFlowNode> = (_, node, draggedNodes) => {
    resetTouchNodeDragGate()

    const activeNodes = draggedNodes.length > 0 ? draggedNodes : [node]
    const movedPlacements = activeNodes.map((activeNode) => ({
      serverId: getItemIdFromNodeId(activeNode.id),
      x: snapToGrid(activeNode.position.x),
      y: snapToGrid(activeNode.position.y),
    }))
    const wasMoved = movedPlacements.length === 1
      ? onMoveItem(movedPlacements[0].serverId, {
          x: movedPlacements[0].x,
          y: movedPlacements[0].y,
        })
      : onMoveItems(movedPlacements)
    const movedPlacementMap = new Map(
      movedPlacements.map((placement) => [placement.serverId, placement]),
    )
    const savedPositionMap = new Map(flowNodes.map((currentNode) => [currentNode.id, currentNode.position]))

    setNodes((currentNodes) =>
      currentNodes.map((currentNode) => {
        const itemId = getItemIdFromNodeId(currentNode.id)
        const movedPlacement = movedPlacementMap.get(itemId)

        if (!movedPlacement) {
          return currentNode
        }

        return {
          ...currentNode,
          position: wasMoved
            ? { x: movedPlacement.x, y: movedPlacement.y }
            : savedPositionMap.get(currentNode.id) ?? currentNode.position,
        }
      }),
    )
  }

  const handleEdgeMouseEnter: EdgeMouseHandler<CableFlowEdge> = (_, edge) => {
    setHoveredConnectionId(edge.id.replace('cable:', ''))
  }

  const handleEdgeMouseLeave: EdgeMouseHandler<CableFlowEdge> = () => {
    setHoveredConnectionId(null)
  }

  const handleEdgeClick: EdgeMouseHandler<CableFlowEdge> = (_, edge) => {
    onSelectConnection(edge.id.replace('cable:', ''))
  }

  return (
    <main ref={canvasRootRef} className="relative min-w-0 flex-1 bg-[#fbf8f1]">
      <div
        ref={setNodeRef}
        className={`relative h-dvh overflow-hidden bg-[#fbf8f1] transition ${isOver ? 'ring-2 ring-inset ring-[#ddb668]' : ''}`}
      >
        {validationMessage ? (
          <div
            data-testid="canvas-validation-message"
            data-severity={validationSeverity}
            role={validationSeverity === 'unknown' ? 'status' : 'alert'}
            className={cn(
              'pointer-events-none absolute left-4 top-4 z-20 rounded-md border px-3 py-2 text-xs font-semibold shadow-sm',
              validationSeverity === 'unknown'
                ? 'border-[#dfc483] bg-[#fff8df] text-[#5d4814]'
                : 'border-[#dfb3a5] bg-[#fff4ee] text-[#613126]',
            )}
          >
            {validationMessage}
          </div>
        ) : null}
        {project.placements.length === 0 ? (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-dashed border-[#b9aa98] bg-white/80 p-5 text-center text-sm text-[#75695d]">
            Drag equipment from the inventory to start a layout.
          </div>
        ) : null}
        {typeof demoRemainingSeconds === 'number' ? (
          <div className="pointer-events-auto absolute left-4 top-4 z-20 rounded-lg border border-[#d6ccbd] bg-[#fffdf8]/95 px-3 py-2 text-xs font-black uppercase tracking-[0.08em] text-[#5d554c] shadow-sm">
            Demo session {formatRemainingSeconds(demoRemainingSeconds)}
          </div>
        ) : null}
        <CanvasCommandBar
          className={inspectorOpen ? 'lg:right-[680px]' : undefined}
          desktopInventoryVisible={desktopInventoryVisible}
          saveStatus={saveStatus}
          canUndo={canUndo}
          canRedo={canRedo}
          updateAvailable={updateAvailable}
          updateStatusLoading={updateStatusLoading}
          auditWarningCount={auditWarningCount}
          autoCenterOnSelect={autoCenterOnSelect}
          cablesVisible={cablesVisible}
          onInventory={onOpenInventory}
          onUndo={onUndo}
          onRedo={onRedo}
          onOpenUpdate={onOpenUpdate}
          onOpenAudit={onOpenAudit}
          onToggleAutoCenterOnSelect={onToggleAutoCenterOnSelect}
          onAutoArrange={onAutoArrange}
          onToggleCablesVisible={onToggleCablesVisible}
          onOpenSettings={onOpenSettings}
        />

        <ReactFlow
          nodes={nodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onNodeDragStop={handleNodeDragStop}
          onEdgeClick={handleEdgeClick}
          onEdgeMouseEnter={handleEdgeMouseEnter}
          onEdgeMouseLeave={handleEdgeMouseLeave}
          onPaneClick={onCanvasClick}
          onPointerDownCapture={handleFlowPointerDownCapture}
          onPointerMoveCapture={handleFlowPointerMoveCapture}
          onPointerUpCapture={handleFlowPointerEndCapture}
          onPointerCancelCapture={handleFlowPointerEndCapture}
          onTouchStartCapture={handleFlowTouchStartCapture}
          onTouchMoveCapture={handleFlowTouchMoveCapture}
          onTouchEndCapture={resetTouchNodeDragGate}
          onTouchCancelCapture={resetTouchNodeDragGate}
          minZoom={0.25}
          maxZoom={1.8}
          nodeDragThreshold={nodeDragThreshold}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
          fitView={project.placements.length > 0}
          className="homelab-inventory-flow bg-[#fbf8f1]"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={GRID_SIZE}
            size={2.25}
            color="#c7bbab"
          />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            className="homelab-inventory-minimap !bottom-4 !right-4 !hidden !h-28 !w-40 !rounded-none !border-0 !bg-[#fffdf8] !shadow-none md:!block"
            bgColor="#fffdf8"
            nodeColor="#20242c"
            maskColor="transparent"
          />
        </ReactFlow>
      </div>
    </main>
  )
}

export function WorkbenchCanvas(props: {
  project: ProjectState
  agentStatus: AgentStatusSummary | null
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  spotlightItemId: string | null
  activeNetworkTraceConnectionIds: Array<string | number>
  activeNetworkTraceItemIds: string[]
  pendingEndpoint: ConnectionEndpoint | null
  draggingEndpoint: ConnectionEndpoint | null
  dropCompatibilityByHostId: Readonly<Record<string, CompatibilityStatus | undefined>>
  validationMessage: string | null
  validationSeverity?: ValidationMessageSeverity
  demoRemainingSeconds?: number | null
  canUndo: boolean
  canRedo: boolean
  saveStatus: 'saved' | 'saving' | 'error'
  autoCenterOnSelect: boolean
  cablesVisible: boolean
  updateAvailable: boolean
  updateStatusLoading: boolean
  desktopInventoryVisible: boolean
  inspectorOpen: boolean
  onSelect: (itemId: string) => void
  onSelectConnection: (connectionId: string | number) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onMoveItem: (itemId: string, position: XYPosition) => boolean
  onMoveItems: (placements: Array<{ serverId: string; x: number; y: number }>) => boolean
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionRoute: (connectionId: string | number, route: ConnectionRoutePreferences) => void
  onViewportReady: (canvasController: CanvasController) => void
  onCanvasClick: () => void
  onUndo: () => void
  onRedo: () => void
  onToggleAutoCenterOnSelect: () => void
  onAutoArrange: () => void
  onOpenAudit: () => void
  onOpenUpdate: () => void
  onOpenInventory: () => void
  onToggleCablesVisible: () => void
  onOpenSettings: () => void
}) {
  const compatibilityAnnouncement = useMemo(() => {
    const activeEntry = Object.entries(props.dropCompatibilityByHostId)
      .find(([, status]) => status !== undefined)

    if (!activeEntry) return null

    const [hostId, status] = activeEntry
    const hostName = props.project.items[hostId]?.name

    return hostName && status ? { hostName, status } : null
  }, [props.dropCompatibilityByHostId, props.project])

  return (
    <>
      <CompatibilityDropAnnouncement
        hostName={compatibilityAnnouncement?.hostName}
        status={compatibilityAnnouncement?.status}
      />
      <ReactFlowProvider>
        <CanvasViewport {...props} />
      </ReactFlowProvider>
    </>
  )
}
