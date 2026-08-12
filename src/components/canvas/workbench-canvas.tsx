import { useDroppable } from '@dnd-kit/core'
import {
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type EdgeMouseHandler,
  type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type CableFlowEdge } from '@/components/cable-edge'
import {
  type CanvasActivity,
} from '@/components/canvas-activity-indicator'
import {
  type WorkbenchCanvasProps,
} from '@/components/workbench-canvas-contract'
import { CompatibilityDropAnnouncement } from '@/components/compatibility-drop-announcement'
import { reconcileFlowNodes, type WorkbenchFlowNode } from '@/components/canvas/flow-reconciliation'
import { CanvasViewportSurface } from '@/components/canvas/canvas-viewport-surface'
import { useTouchCanvasInteractions } from '@/components/canvas/use-touch-canvas-interactions'
import { useCanvasFlowNodes } from '@/components/canvas/use-canvas-flow-nodes'
import { useCanvasFlowEdges } from '@/components/canvas/use-canvas-flow-edges'
import { useCanvasViewportController } from '@/components/canvas/use-canvas-viewport-controller'
import { useCableRoutingController } from '@/components/canvas/use-cable-routing-controller'
import { useCanvasRouteRequests } from '@/components/canvas/use-canvas-route-requests'
import { useCanvasHandleMeasurement } from '@/components/canvas/use-canvas-handle-measurement'
import { useCanvasNodeDrag } from '@/components/canvas/use-canvas-node-drag'
import { useCanvasProjectModel } from '@/components/canvas/use-canvas-project-model'
import { useStableCanvasCallbacks } from '@/components/canvas/use-stable-canvas-callbacks'
import { usePermission } from '@/hooks/use-permission'

function CanvasViewport({
  project,
  registryLinkedItemKeys,
  topologyData = null,
  compatibleEndpointKeys = null,
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
  onResolveConnectionRouteSides,
  onCanonicalizeConnectionRoutes,
  onViewportReady,
  onViewportChange,
  onCanvasClick,
  canUndo,
  canRedo,
  saveStatus,
  canonicalMutationBusy,
  canvasOperationLabel,
  autoCenterOnSelect,
  networkCablesVisible,
  powerCablesVisible,
  displayCablesVisible,
  snapCablesToGrid,
  avoidCableCollisionsGlobally,
  snapItemsToGrid,
  initialViewport,
  updateAvailable,
  updateStatusLoading,
  canViewNotifications,
  notificationCount,
  desktopInventoryVisible,
  inspectorOpen,
  onUndo,
  onRedo,
  onToggleAutoCenterOnSelect,
  onAutoArrange,
  onOpenAudit,
  onOpenUpdate,
  onOpenInventory,
  onToggleNetworkCablesVisible,
  onTogglePowerCablesVisible,
  onToggleDisplayCablesVisible,
  onOpenSettings,
  onOpenNotifications,
}: WorkbenchCanvasProps) {
  const canEditWorkspace = usePermission('workspace.edit')
  const canEditCanvas = usePermission('canvas.edit')
  const canEditConnections = usePermission('connections.edit')
  const canEditInventory = usePermission('inventory.edit')
  const canViewAudit = usePermission('audit.view')
  const canViewUpdates = usePermission('updates.view')
  const { setNodeRef, isOver } = useDroppable({
    id: 'canvas',
    disabled: !canEditCanvas && !canEditInventory,
    data: {
      kind: 'canvas',
    },
  })
  const viewportApi = useReactFlow<WorkbenchFlowNode, CableFlowEdge>()
  const { getViewport, setViewport } = viewportApi
  const canvasRootRef = useRef<HTMLElement | null>(null)
  useCanvasViewportController({
    project,
    canvasRootRef,
    viewportApi,
    onViewportReady,
  })
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | number | null>(null)
  const {
    nodeDragThreshold,
    resetTouchNodeDragGate,
    handleFlowPointerDownCapture,
    handleFlowPointerMoveCapture,
    handleFlowPointerEndCapture,
    handleFlowTouchStartCapture,
    handleFlowTouchMoveCapture,
  } = useTouchCanvasInteractions({ getViewport, setViewport })
  const {
    affectedItemIds,
    nodeProjectSnapshots,
    canvasGeometryProject,
    canvasRoutingProject,
    canvasIndex,
    canvasHandleIndex,
    nodeCanvasIndexes,
    auditWarningCount,
    focusedItemIdSet,
    focusActive,
    activeNetworkTraceConnectionIdSet,
  } = useCanvasProjectModel({
    project,
    topologyData,
    compatibleEndpointKeys,
    selectedItemId,
    selectedConnectionId,
    activeNetworkTraceConnectionIds,
    activeNetworkTraceItemIds,
  })
  const {
    onSelect: stableOnSelect,
    onSelectConnection: stableOnSelectConnection,
    onRemoveAssignment: stableOnRemoveAssignment,
    onEndpointClick: stableOnEndpointClick,
    onEndpointDragStart: stableOnEndpointDragStart,
    onEndpointDrop: stableOnEndpointDrop,
    onUpdateConnectionRoute: stableOnUpdateConnectionRoute,
    onResolveConnectionRouteSides: stableOnResolveConnectionRouteSides,
    onCanonicalizeConnectionRoutes: stableOnCanonicalizeConnectionRoutes,
  } = useStableCanvasCallbacks({
    onSelect,
    onSelectConnection,
    onRemoveAssignment: canEditInventory ? onRemoveAssignment : () => undefined,
    onEndpointClick: canEditConnections ? onEndpointClick : () => undefined,
    onEndpointDragStart: canEditConnections ? onEndpointDragStart : () => undefined,
    onEndpointDrop: canEditConnections ? onEndpointDrop : () => undefined,
    onUpdateConnectionRoute: canEditConnections ? onUpdateConnectionRoute : () => undefined,
    onResolveConnectionRouteSides: canEditConnections ? onResolveConnectionRouteSides : async () => undefined,
    onCanonicalizeConnectionRoutes: canEditConnections
      ? onCanonicalizeConnectionRoutes
      : async () => undefined,
  })
  const flowNodes = useCanvasFlowNodes({
    project,
    registryLinkedItemKeys,
    canvasIndex,
    nodeCanvasIndexes,
    nodeProjectSnapshots,
    canvasHandleIndex,
    agentStatus,
    selectedItemId,
    focusedItemIdSet,
    focusActive,
    spotlightItemId,
    pendingEndpoint,
    draggingEndpoint,
    dropCompatibilityByHostId,
    onSelect: stableOnSelect,
    onRemoveAssignment: stableOnRemoveAssignment,
    onEndpointClick: stableOnEndpointClick,
    onEndpointDragStart: stableOnEndpointDragStart,
    onEndpointDrop: stableOnEndpointDrop,
  })
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkbenchFlowNode>(flowNodes)
  const {
    measuredHandleGeometry,
    forceRenderAllNodes,
    geometryMeasurementPending,
  } = useCanvasHandleMeasurement({
    project,
    flowNodes,
    canvasHandleIndex,
    affectedItemIds,
  })
  const {
    routeRequests,
    measuredHandlesByNodeId,
    routeGeometryReady,
  } = useCanvasRouteRequests({
    geometryProject: canvasGeometryProject,
    routingProject: canvasRoutingProject,
    nodes,
    measuredHandleGeometry,
    geometryMeasurementPending,
    avoidCableCollisionsGlobally,
    snapCablesToGrid,
  })
  const { routingState, enginePhase } = useCableRoutingController({
    routeRequests,
    routeGeometryReady,
    onResolveConnectionRouteSides: stableOnResolveConnectionRouteSides,
    onCanonicalizeConnectionRoutes: stableOnCanonicalizeConnectionRoutes,
  })
  const plannedCableRoutes = routingState.routes
  const flowEdges = useCanvasFlowEdges({
    project: canvasRoutingProject,
    topologyData,
    measuredHandlesByNodeId,
    plannedCableRoutes,
    selectedConnectionId,
    hoveredConnectionId,
    selectedItemId,
    activeNetworkTraceConnectionIds,
    activeNetworkTraceConnectionIdSet,
    networkCablesVisible,
    powerCablesVisible,
    displayCablesVisible,
    snapCablesToGrid,
    onSelectConnection: stableOnSelectConnection,
    onUpdateConnectionRoute: stableOnUpdateConnectionRoute,
  })
  useEffect(() => {
    setNodes((currentNodes) => reconcileFlowNodes(currentNodes, flowNodes))
  }, [flowNodes, setNodes])

  const handleNodesChange: OnNodesChange<WorkbenchFlowNode> = (changes) => {
    onNodesChange(changes)
  }

  const handleNodeDragStop = useCanvasNodeDrag({
    flowNodes,
    setNodes,
    snapItemsToGrid,
    resetTouchNodeDragGate,
    onMoveItem,
    onMoveItems,
  })

  const handleEdgeMouseEnter: EdgeMouseHandler<CableFlowEdge> = (_, edge) => {
    setHoveredConnectionId(edge.id.replace('cable:', ''))
  }

  const handleEdgeMouseLeave: EdgeMouseHandler<CableFlowEdge> = () => {
    setHoveredConnectionId(null)
  }

  const handleEdgeClick: EdgeMouseHandler<CableFlowEdge> = (_, edge) => {
    stableOnSelectConnection(edge.id.replace('cable:', ''))
  }

  const canvasActivity: CanvasActivity | null = routingState.error
    ? { kind: 'error', label: `Cable routing failed: ${routingState.error}` }
    : canonicalMutationBusy
      ? { kind: 'progress', label: 'Saving and synchronizing workspace' }
      : enginePhase === 'rebuilding' || enginePhase === 'conflict'
        ? { kind: 'progress', label: 'Synchronizing workspace engine' }
        : canvasOperationLabel
          ? { kind: 'progress', label: canvasOperationLabel }
          : routingState.pending
            ? { kind: 'progress', label: 'Routing cables' }
            : null

  return (
    <CanvasViewportSurface
      canvasRootRef={canvasRootRef}
      droppableRef={setNodeRef}
      isDropTarget={isOver}
      hasPlacements={project.placements.length > 0}
      nodes={nodes}
      edges={flowEdges}
      flowEvents={{
        onNodesChange: handleNodesChange,
        onNodeDragStop: handleNodeDragStop,
        onEdgeClick: handleEdgeClick,
        onEdgeMouseEnter: handleEdgeMouseEnter,
        onEdgeMouseLeave: handleEdgeMouseLeave,
        onPaneClick: onCanvasClick,
        onPointerDownCapture: handleFlowPointerDownCapture,
        onPointerMoveCapture: handleFlowPointerMoveCapture,
        onPointerUpCapture: handleFlowPointerEndCapture,
        onPointerCancelCapture: handleFlowPointerEndCapture,
        onTouchStartCapture: handleFlowTouchStartCapture,
        onTouchMoveCapture: handleFlowTouchMoveCapture,
        onTouchEndCapture: resetTouchNodeDragGate,
        onTouchCancelCapture: resetTouchNodeDragGate,
      }}
      nodeDragThreshold={nodeDragThreshold}
      snapItemsToGrid={snapItemsToGrid}
      initialViewport={initialViewport}
      onViewportChange={onViewportChange}
      forceRenderAllNodes={forceRenderAllNodes}
      nodesDraggable={canEditCanvas}
      activity={canvasActivity}
      validationMessage={validationMessage}
      validationSeverity={validationSeverity}
      demoRemainingSeconds={demoRemainingSeconds}
      commandBar={{
        className: inspectorOpen ? 'lg:right-[680px]' : undefined,
        desktopInventoryVisible,
        saveStatus,
        canUndo,
        canRedo,
        updateAvailable,
        updateStatusLoading,
        auditWarningCount,
        autoCenterOnSelect,
        networkCablesVisible,
        powerCablesVisible,
        displayCablesVisible,
        canEditWorkspace,
        canEditCanvas,
        canViewAudit,
        canViewUpdates,
        canViewNotifications,
        notificationCount,
        onInventory: onOpenInventory,
        onUndo,
        onRedo,
        onOpenUpdate,
        onOpenAudit,
        onToggleAutoCenterOnSelect,
        onAutoArrange,
        onToggleNetworkCablesVisible,
        onTogglePowerCablesVisible,
        onToggleDisplayCablesVisible,
        onOpenSettings,
        onOpenNotifications,
      }}
    />
  )
}

export function WorkbenchCanvas(props: WorkbenchCanvasProps) {
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
