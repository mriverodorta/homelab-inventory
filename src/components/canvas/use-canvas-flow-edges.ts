import { useMemo, useRef } from 'react'
import type { CableFlowEdge } from '@/components/cable-edge'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import type { CanvasNodeHandleGeometry } from '@/lib/canvas-handle-geometry'
import type { CableRoutingState } from '@/lib/cable-routing-coordinator'
import type {
  ConnectionRoutePreferences,
  InventoryConnection,
  ProjectState,
} from '@/types/inventory'
import { connectionMatchesSelectedItem } from '@/lib/cable-focus'
import { CANVAS_CABLE_Z_INDEX, reconcileItemsById, selectStableCableRoute } from '@/lib/cable-render-stability'
import { cableFlowEdgesEqual, getCanvasNodeId, getMeasuredHandlePoint, sameOptionalId } from '@/components/canvas/flow-reconciliation'
import { describeConnection, getCableAppearance } from '@/lib/cables'
import { getConnectionRoute } from '@/lib/cable-routing'
import { isCableTypeVisible, type CableVisibility } from '@/lib/cable-visibility'
import { runtimeItemKey } from '@/lib/item-keys'

type CanvasFlowEdgesOptions = {
  project: ProjectState
  topologyData: TopologyQueryData | null
  measuredHandlesByNodeId: ReadonlyMap<string, CanvasNodeHandleGeometry>
  plannedCableRoutes: CableRoutingState['routes']
  selectedConnectionId: string | number | null
  hoveredConnectionId: string | number | null
  selectedItemId: string | null
  activeNetworkTraceConnectionIds: Array<string | number>
  activeNetworkTraceConnectionIdSet: ReadonlySet<string>
  networkCablesVisible: boolean
  powerCablesVisible: boolean
  displayCablesVisible: boolean
  snapCablesToGrid: boolean
  onSelectConnection: (connectionId: string | number) => void
  onUpdateConnectionRoute: (
    connectionId: string | number,
    route: ConnectionRoutePreferences,
  ) => void
}

export function useCanvasFlowEdges({
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
}: CanvasFlowEdgesOptions) {
  const cableVisibility = useMemo<CableVisibility>(() => ({
    network: networkCablesVisible,
    power: powerCablesVisible,
    display: displayCablesVisible,
  }), [displayCablesVisible, networkCablesVisible, powerCablesVisible])
  const flowEdgesRef = useRef<CableFlowEdge[]>([])
  return useMemo<CableFlowEdge[]>(
    () => {
      const placedItemIds = new Set(canvasRoutingProject.placements.map((placement) => placement.serverId))
      const currentEdgesById = new Map(flowEdgesRef.current.map((edge) => [edge.id, edge]))
      const nextEdges: CableFlowEdge[] = (canvasRoutingProject.connections ?? []).flatMap((connection, connectionIndex) => {
        const edgeId = `cable:${connection.id}`
        const previousPlannedRoute = currentEdgesById.get(edgeId)?.data?.plannedRoute
        const derived = topologyData?.connectionDerivedById.get(connection.id)
        const effectiveConnection = derived ? {
          ...connection,
          type: derived.connectionType as InventoryConnection['type'],
          negotiatedSpeedMbps: derived.negotiatedSpeedMbps ?? undefined,
        } : connection
        if (!isCableTypeVisible(effectiveConnection.type, cableVisibility)) return []

        const fromItem = canvasRoutingProject.items[connection.from.itemId]
        const toItem = canvasRoutingProject.items[connection.to.itemId]

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

        const appearance = getCableAppearance(canvasRoutingProject, effectiveConnection)
        const plannedRoute = plannedCableRoutes.get(connection.id)
        const routeCandidate = plannedRoute ?? previousPlannedRoute
        let route = getConnectionRoute(
          canvasRoutingProject,
          connection,
          connectionIndex,
          routeCandidate,
        )
        if (!route) return []

        const sourceNodeId = getCanvasNodeId(fromItem)
        const targetNodeId = getCanvasNodeId(toItem)
        const sourcePoint = getMeasuredHandlePoint({
          project: canvasRoutingProject,
          nodeId: sourceNodeId,
          kind: 'source',
          handleId: route.sourceHandle,
          handlesByNodeId: measuredHandlesByNodeId,
        })
        const targetPoint = getMeasuredHandlePoint({
          project: canvasRoutingProject,
          nodeId: targetNodeId,
          kind: 'target',
          handleId: route.targetHandle,
          handlesByNodeId: measuredHandlesByNodeId,
        })

        const visiblePlannedRoute = selectStableCableRoute({
          planned: plannedRoute,
          previous: previousPlannedRoute,
          source: sourcePoint,
          target: targetPoint,
        })
        if (!visiblePlannedRoute) return []

        if (visiblePlannedRoute !== routeCandidate) {
          route = getConnectionRoute(
            canvasRoutingProject,
            connection,
            connectionIndex,
            visiblePlannedRoute,
          )
          if (!route) return []
        }

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

        return [
          {
            id: edgeId,
            source: sourceNodeId,
            target: targetNodeId,
            sourceHandle: route.sourceHandle,
            targetHandle: route.targetHandle,
            type: 'cable',
            data: {
              color: appearance.color,
              label: connection.label?.trim() || appearance.label,
              detail: describeConnection(canvasRoutingProject, effectiveConnection),
              selected: isSelected,
              hovered: isHovered,
              editable: isSelected,
              traced: isTraceConnection,
              dimmed,
              connectionId: connection.id,
              route: effectiveConnection.route,
              snapToGrid: snapCablesToGrid,
              plannedRoute: visiblePlannedRoute,
              sourceSide: route.sourceSide,
              targetSide: route.targetSide,
              onSelect: stableOnSelectConnection,
              onUpdateRoute: stableOnUpdateConnectionRoute,
            },
            style: {
              stroke: appearance.color,
              strokeWidth: isSelected || isHovered || isTraceConnection ? 6 : 4,
              filter: isSelected || isHovered || isTraceConnection
                ? 'drop-shadow(0 2px 3px rgba(32, 36, 44, 0.2))'
                : undefined,
            },
            zIndex: CANVAS_CABLE_Z_INDEX,
            interactionWidth: 18,
            selectable: false,
            focusable: false,
          },
        ]
      })
      const reconciled = reconcileItemsById(
        flowEdgesRef.current,
        nextEdges,
        cableFlowEdgesEqual,
      )
      flowEdgesRef.current = reconciled
      return reconciled
    },
    [
      activeNetworkTraceConnectionIdSet,
      activeNetworkTraceConnectionIds.length,
      cableVisibility,
      canvasRoutingProject,
      hoveredConnectionId,
      measuredHandlesByNodeId,
      plannedCableRoutes,
      selectedConnectionId,
      selectedItemId,
      snapCablesToGrid,
      stableOnSelectConnection,
      stableOnUpdateConnectionRoute,
      topologyData,
    ],
  )

}
