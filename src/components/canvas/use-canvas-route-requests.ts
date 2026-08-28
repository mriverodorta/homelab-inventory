import { useMemo, useRef } from 'react'
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
  enabled?: boolean
  geometryProject: ProjectState
  routingProject: ProjectState
  nodes: Node[]
  measuredHandleGeometry: CanvasNodeHandleGeometry[]
  geometryMeasurementPending: boolean
  avoidCableCollisionsGlobally: boolean
  snapCablesToGrid: boolean
}

type MeasuredNodeSize = readonly [itemId: string, width: number, height: number]

export function collectMeasuredNodeSizes(nodes: readonly Node[]): MeasuredNodeSize[] {
  return nodes.flatMap((node): MeasuredNodeSize[] => {
    const width = node.measured?.width
    const height = node.measured?.height

    return width && height
      ? [[getItemIdFromNodeId(node.id), Math.ceil(width), Math.ceil(height)]]
      : []
  })
}

function measuredNodeSizesEqual(
  current: readonly MeasuredNodeSize[],
  next: readonly MeasuredNodeSize[],
) {
  return current.length === next.length && current.every((size, index) => (
    size[0] === next[index][0]
    && size[1] === next[index][1]
    && size[2] === next[index][2]
  ))
}

function useStableMeasuredNodeSizes(nodes: readonly Node[], enabled: boolean) {
  const sizesRef = useRef<MeasuredNodeSize[]>([])
  const nextSizes = enabled ? collectMeasuredNodeSizes(nodes) : []

  if (!measuredNodeSizesEqual(sizesRef.current, nextSizes)) {
    sizesRef.current = nextSizes
  }

  return sizesRef.current
}

export function useCanvasRouteRequests({
  enabled = true,
  geometryProject,
  routingProject,
  nodes,
  measuredHandleGeometry,
  geometryMeasurementPending,
  avoidCableCollisionsGlobally,
  snapCablesToGrid,
}: UseCanvasRouteRequestsOptions) {
  const measuredNodeSizes = useStableMeasuredNodeSizes(nodes, enabled)

  const cableObstacles = useMemo(() => {
    const measuredSizes = new Map<string, { width: number; height: number }>(
      measuredNodeSizes.map(
        ([itemId, width, height]) => [itemId, { width, height }],
      ),
    )

    return buildCableObstacles(geometryProject, undefined, measuredSizes)
  }, [geometryProject, measuredNodeSizes])

  const measuredHandlesByNodeId = useMemo(() => new Map(
    measuredHandleGeometry.map((node) => [node.nodeId, node]),
  ), [measuredHandleGeometry])

  const routeRequests = useMemo<CableLaneRouteRequest[]>(() => {
    if (!enabled) return []

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
    enabled,
    measuredHandlesByNodeId,
    routingProject,
    snapCablesToGrid,
  ])

  const expectedRouteConnectionIds = useMemo(() => {
    if (!enabled) return new Set<string | number>()

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
  }, [enabled, routingProject])

  return {
    routeRequests,
    measuredHandlesByNodeId,
    routeGeometryReady: enabled && !geometryMeasurementPending
      && routeRequests.length === expectedRouteConnectionIds.size
      && routeRequests.every((request) => expectedRouteConnectionIds.has(request.connectionId)),
  }
}
