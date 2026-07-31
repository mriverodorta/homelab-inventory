import { useMemo } from 'react'
import type { Node } from '@xyflow/react'
import {
  CABLE_SIDES,
  getConnectionRoute,
  getEndpointHandleId,
  getProjectedFaceCandidates,
  type CableSide,
} from '@/lib/cable-routing'
import { buildCableObstacles } from '@/lib/cable-geometry'
import type { CanvasNodeHandleGeometry } from '@/lib/canvas-handle-geometry'
import { shouldAvoidCableOverlap, type CableLaneRouteRequest } from '@/engine/routing'
import { runtimeItemKey } from '@/lib/item-keys'
import type { ProjectState } from '@/types/inventory'
import {
  getCanvasNodeId,
  getItemIdFromNodeId,
  getMeasuredHandlePoint,
} from '@/components/canvas/flow-reconciliation'

type UseCanvasRouteRequestsOptions = {
  geometryProject: ProjectState
  routingProject: ProjectState
  nodes: Node[]
  measuredHandleGeometry: CanvasNodeHandleGeometry[]
  geometryMeasurementPending: boolean
  avoidCableCollisionsGlobally: boolean
  snapCablesToGrid: boolean
}

export function useCanvasRouteRequests({
  geometryProject,
  routingProject,
  nodes,
  measuredHandleGeometry,
  geometryMeasurementPending,
  avoidCableCollisionsGlobally,
  snapCablesToGrid,
}: UseCanvasRouteRequestsOptions) {
  const measuredNodeSizeSignature = useMemo(() => JSON.stringify(nodes.flatMap((node) => {
    const width = node.measured?.width
    const height = node.measured?.height

    return width && height
      ? [[getItemIdFromNodeId(node.id), Math.ceil(width), Math.ceil(height)]]
      : []
  }).sort((first, second) => String(first[0]).localeCompare(String(second[0])))), [nodes])

  const cableObstacles = useMemo(() => {
    const measuredSizes = new Map<string, { width: number; height: number }>(
      (JSON.parse(measuredNodeSizeSignature) as Array<[string, number, number]>).map(
        ([itemId, width, height]) => [itemId, { width, height }],
      ),
    )

    return buildCableObstacles(geometryProject, undefined, measuredSizes)
  }, [geometryProject, measuredNodeSizeSignature])

  const measuredHandlesByNodeId = useMemo(() => new Map(
    measuredHandleGeometry.map((node) => [node.nodeId, node]),
  ), [measuredHandleGeometry])

  const routeRequests = useMemo<CableLaneRouteRequest[]>(() => {
    const placedItemIds = new Set(routingProject.placements.map((placement) => placement.serverId))

    return (routingProject.connections ?? []).flatMap((connection, connectionIndex) => {
      const fromItem = routingProject.items[connection.from.itemId]
      const toItem = routingProject.items[connection.to.itemId]
      const fromItemKey = fromItem ? runtimeItemKey(fromItem) : null
      const toItemKey = toItem ? runtimeItemKey(toItem) : null

      if (
        !fromItem || !toItem || !fromItemKey || !toItemKey
        || !placedItemIds.has(fromItemKey) || !placedItemIds.has(toItemKey)
      ) return []

      const routeMetadata = getConnectionRoute(routingProject, connection, connectionIndex)
      if (!routeMetadata) return []

      const sourceNodeId = getCanvasNodeId(fromItem)
      const targetNodeId = getCanvasNodeId(toItem)
      const explicitSourceSide = CABLE_SIDES.includes(connection.route?.sourceSide as CableSide)
        ? connection.route?.sourceSide as CableSide
        : null
      const explicitTargetSide = CABLE_SIDES.includes(connection.route?.targetSide as CableSide)
        ? connection.route?.targetSide as CableSide
        : null
      const sourceCenters = CABLE_SIDES.flatMap((side) => {
        const point = getMeasuredHandlePoint({
          project: routingProject,
          nodeId: sourceNodeId,
          kind: 'source',
          handleId: getEndpointHandleId('source', side, connection.from),
          handlesByNodeId: measuredHandlesByNodeId,
        })
        return point ? [{ point, side }] : []
      })
      const targetCenters = CABLE_SIDES.flatMap((side) => {
        const point = getMeasuredHandlePoint({
          project: routingProject,
          nodeId: targetNodeId,
          kind: 'target',
          handleId: getEndpointHandleId('target', side, connection.to),
          handlesByNodeId: measuredHandlesByNodeId,
        })
        return point ? [{ point, side }] : []
      })
      if (sourceCenters.length !== CABLE_SIDES.length || targetCenters.length !== CABLE_SIDES.length) {
        return []
      }

      const sourceCenter = sourceCenters.find((candidate) => candidate.side === explicitSourceSide)
        ?? sourceCenters[0]
      const targetCenter = targetCenters.find((candidate) => candidate.side === explicitTargetSide)
        ?? targetCenters[0]
      const sourceCandidates = explicitSourceSide
        ? sourceCenters.flatMap((candidate) => candidate.side === explicitSourceSide
          ? getProjectedFaceCandidates(candidate.point, candidate.side, targetCenter.point)
          : [candidate])
        : sourceCenters
      const targetCandidates = explicitTargetSide
        ? targetCenters.flatMap((candidate) => candidate.side === explicitTargetSide
          ? getProjectedFaceCandidates(candidate.point, candidate.side, sourceCenter.point)
          : [candidate])
        : targetCenters
      const source = sourceCandidates.find((candidate) => candidate.side === explicitSourceSide)?.point
        ?? sourceCandidates[0].point
      const target = targetCandidates.find((candidate) => candidate.side === explicitTargetSide)?.point
        ?? targetCandidates[0].point

      return [{
        connectionId: connection.id,
        avoidCableOverlap: shouldAvoidCableOverlap(
          avoidCableCollisionsGlobally,
          connection.route?.avoidCableOverlap,
        ),
        request: {
          source,
          target,
          sourceSide: explicitSourceSide,
          targetSide: explicitTargetSide,
          sourceCandidates,
          targetCandidates,
          laneOffset: routeMetadata.laneOffset,
          obstacles: cableObstacles,
          sourceItemId: connection.from.itemId,
          targetItemId: connection.to.itemId,
          manualBendPoints: connection.route?.bendPoints,
          snapToGrid: snapCablesToGrid,
        },
      }]
    })
  }, [
    avoidCableCollisionsGlobally,
    cableObstacles,
    measuredHandlesByNodeId,
    routingProject,
    snapCablesToGrid,
  ])

  const expectedRouteConnectionIds = useMemo(() => {
    const placedItemIds = new Set(routingProject.placements.map((placement) => placement.serverId))

    return new Set((routingProject.connections ?? []).flatMap((connection, connectionIndex) => {
      const fromItem = routingProject.items[connection.from.itemId]
      const toItem = routingProject.items[connection.to.itemId]
      const fromItemKey = fromItem ? runtimeItemKey(fromItem) : null
      const toItemKey = toItem ? runtimeItemKey(toItem) : null

      return fromItem && toItem && fromItemKey && toItemKey
        && placedItemIds.has(fromItemKey)
        && placedItemIds.has(toItemKey)
        && getConnectionRoute(routingProject, connection, connectionIndex)
        ? [connection.id]
        : []
    }))
  }, [routingProject])

  return {
    routeRequests,
    measuredHandlesByNodeId,
    routeGeometryReady: !geometryMeasurementPending
      && routeRequests.length === expectedRouteConnectionIds.size
      && routeRequests.every((request) => expectedRouteConnectionIds.has(request.connectionId)),
  }
}
