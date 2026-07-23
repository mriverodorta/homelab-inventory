import type {
  LaneRouteRequest,
  ObstacleRouteResult,
} from '../../shared/engine/protocol.mjs'
import type { DomainEngineClient } from '@/engine/client'
import type {
  CableObstacle,
  CableRouteRequest,
  CableRouteResult,
} from '@/lib/cable-geometry'

export type CableLaneRouteRequest = {
  connectionId: number
  avoidCableOverlap: boolean
  request: CableRouteRequest
}

export type CableRoutePlanResult = {
  routes: ReadonlyMap<number, CableRouteResult>
  recalculatedConnectionIds: number[]
}

export type CableRoutePreview = {
  route: CableRouteResult
  bendPoints: Array<{ x: number; y: number }>
}

export function shouldAvoidCableOverlap(
  avoidGlobally: boolean,
  avoidIndividually: boolean | undefined,
): boolean {
  return avoidGlobally || avoidIndividually === true
}

function obstacleBounds(obstacle: CableObstacle) {
  return {
    x: obstacle.left,
    y: obstacle.top,
    width: obstacle.right - obstacle.left,
    height: obstacle.bottom - obstacle.top,
  }
}

function toEngineRequest(entry: CableLaneRouteRequest): LaneRouteRequest {
  return {
    avoid_cable_overlap: entry.avoidCableOverlap,
    request: {
      definition: {
        connection_id: entry.connectionId,
        source: entry.request.source,
        target: entry.request.target,
        source_side: entry.request.sourceSide,
        target_side: entry.request.targetSide,
        lane_offset: entry.request.laneOffset,
        manual_bends: [...(entry.request.manualBendPoints ?? [])],
      },
      source_item_id: entry.request.sourceItemId,
      target_item_id: entry.request.targetItemId,
      obstacles: [],
      reserved_segments: [...(entry.request.reservedSegments ?? [])],
      snap_to_grid: entry.request.snapToGrid,
      grid_size: 12,
      previous_valid_route: null,
    },
  }
}

function fromEngineResult(result: ObstacleRouteResult): CableRouteResult {
  return {
    points: result.route.points,
    manualAnchorPointIndexes: result.route.manual_anchor_point_indexes,
    usedFallback: result.used_fallback,
  }
}

export async function planCableRoutes(
  client: DomainEngineClient,
  requests: CableLaneRouteRequest[],
): Promise<CableRoutePlanResult> {
  const obstacles = requests[0]?.request.obstacles ?? []
  const response = await client.transient({
    operation: {
      kind: 'plan-cable-routes',
      payload: {
        plan: {
          obstacles: obstacles.map((obstacle) => ({
            item_id: obstacle.itemId,
            bounds: obstacleBounds(obstacle),
          })),
          requests: requests.map(toEngineRequest),
        },
      },
    },
  })
  if (response.result.kind === 'cable-routes-planned') {
    return {
      routes: new Map(response.result.payload.routes.map((route) => [
        route.route.connection_id,
        fromEngineResult(route),
      ])),
      recalculatedConnectionIds: response.result.payload.recalculated_connection_ids,
    }
  }
  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Cable routes could not be planned.',
  )
}

function routePreviewFromResponse(
  response: Awaited<ReturnType<DomainEngineClient['query']>>,
): CableRoutePreview {
  if (response.result.kind === 'route-preview') {
    return {
      route: {
        points: response.result.payload.route.points,
        manualAnchorPointIndexes: response.result.payload.route.manual_anchor_point_indexes,
        usedFallback: false,
      },
      bendPoints: response.result.payload.forward.bend_points,
    }
  }
  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Cable route preview could not be calculated.',
  )
}

export async function previewCableRouteSegment(
  client: DomainEngineClient,
  input: {
    connectionId: number
    segmentIndex: number
    coordinate: number
    snapToGrid: boolean
    endpointSnapThreshold: number
  },
): Promise<CableRoutePreview> {
  const response = await client.query({
    operation: {
      kind: 'preview-planned-route-segment',
      payload: {
        connection_id: input.connectionId,
        segment_index: input.segmentIndex,
        coordinate: input.coordinate,
        snap_grid: input.snapToGrid ? 12 : null,
        endpoint_snap_threshold: input.endpointSnapThreshold,
      },
    },
  })
  return routePreviewFromResponse(response)
}

export async function insertCableManualBend(
  client: DomainEngineClient,
  input: {
    connectionId: number
    segmentIndex: number
    point: { x: number; y: number }
    snapToGrid: boolean
  },
): Promise<CableRoutePreview> {
  const response = await client.queryConsistent({
    operation: {
      kind: 'insert-planned-manual-bend',
      payload: {
        connection_id: input.connectionId,
        segment_index: input.segmentIndex,
        point: input.point,
        snap_grid: input.snapToGrid ? 12 : null,
      },
    },
  })
  return routePreviewFromResponse(response)
}
