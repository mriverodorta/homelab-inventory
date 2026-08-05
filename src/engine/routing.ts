import type {
  CableRouteCacheSeed,
  CableRouteFailure,
  CableRouteRepair,
  LaneRouteRequest,
  ObstacleRouteResult,
  RouteObstacle,
} from '../../shared/engine/protocol.mjs'
import {
  ROUTING_CACHE_FORMAT_VERSION,
  ROUTING_PLANNER_VERSION,
} from '../../shared/engine/routing-cache-contract.mjs'
import type { DomainEngineClient } from '@/engine/client'
import type {
  CableObstacle,
  CableRouteRequest,
  CableRouteResult,
} from '@/lib/cable-geometry'

export { ROUTING_CACHE_FORMAT_VERSION, ROUTING_PLANNER_VERSION }

export type CableRoutingCacheSnapshot = CableRouteCacheSeed & {
  version: number
  plannerVersion: number
  geometryFingerprint: string | null
  failures: CableRouteFailure[]
  updatedAt: string | null
}

export type CableLaneRouteRequest = {
  connectionId: number
  avoidCableOverlap: boolean
  request: CableRouteRequest
}

export type CableRoutePlanResult = {
  routes: ReadonlyMap<number, CableRouteResult>
  recalculatedConnectionIds: number[]
  failures: ReadonlyMap<number, string>
  repairs: CableRouteRepair[]
  cache: CableRoutingCacheSnapshot
}

export type CableRoutePreview = {
  route: Omit<CableRouteResult, 'sourceSide' | 'targetSide'>
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

function engineObstacles(requests: CableLaneRouteRequest[]): RouteObstacle[] {
  return [...(requests[0]?.request.obstacles ?? [])]
    .sort((first, second) => first.itemId.localeCompare(second.itemId))
    .map((obstacle) => ({
      item_id: obstacle.itemId,
      bounds: obstacleBounds(obstacle),
    }))
}

function toEngineRequest(entry: CableLaneRouteRequest): LaneRouteRequest {
  const sourceCandidates = entry.request.sourceSide
    ? entry.request.sourceCandidates.filter((candidate) => candidate.side === entry.request.sourceSide)
    : entry.request.sourceCandidates
  const targetCandidates = entry.request.targetSide
    ? entry.request.targetCandidates.filter((candidate) => candidate.side === entry.request.targetSide)
    : entry.request.targetCandidates
  const sourceCandidate = sourceCandidates[0]
  const targetCandidate = targetCandidates[0]
  if (!sourceCandidate || !targetCandidate) {
    throw new Error(`Cable ${entry.connectionId} is missing measured endpoint candidates.`)
  }
  return {
    avoid_cable_overlap: entry.avoidCableOverlap,
    request: {
      definition: {
        connection_id: entry.connectionId,
        source: sourceCandidate.point,
        target: targetCandidate.point,
        source_side: sourceCandidate.side,
        target_side: targetCandidate.side,
        lane_offset: entry.request.laneOffset,
        manual_bends: [...(entry.request.manualBendPoints ?? [])],
      },
      source_candidates: sourceCandidates.map((candidate) => ({
        point: candidate.point,
        side: candidate.side,
      })),
      target_candidates: targetCandidates.map((candidate) => ({
        point: candidate.point,
        side: candidate.side,
      })),
      source_side_constraint: entry.request.sourceSide,
      target_side_constraint: entry.request.targetSide,
      previous_source_side: null,
      previous_target_side: null,
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

function engineRequests(requests: CableLaneRouteRequest[]): LaneRouteRequest[] {
  return [...requests]
    .sort((first, second) => first.connectionId - second.connectionId)
    .map(toEngineRequest)
}

function hashGeometry(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

export function cableRoutingGeometryFingerprint(requests: CableLaneRouteRequest[]): string {
  return hashGeometry(JSON.stringify({
    obstacles: engineObstacles(requests),
    requests: engineRequests(requests),
  }))
}

export function routingCacheMatchesRequests(
  cache: CableRoutingCacheSnapshot | null,
  requests: CableLaneRouteRequest[],
): boolean {
  if (
    !routingCacheGeometryMatchesRequests(cache, requests)
    || cache.entries.length + cache.failures.length !== requests.length
  ) return false

  const expectedConnectionIds = new Set(requests.map((request) => request.connectionId))
  if (expectedConnectionIds.size !== requests.length) return false

  const cachedConnectionIds = new Set<number>()
  for (const entry of cache.entries) {
    const inputConnectionId = entry.input.request.definition.connection_id
    const resultConnectionId = entry.result.route.connection_id
    if (
      inputConnectionId !== resultConnectionId
      || !expectedConnectionIds.has(resultConnectionId)
      || cachedConnectionIds.has(resultConnectionId)
    ) return false
    cachedConnectionIds.add(resultConnectionId)
  }
  for (const failure of cache.failures) {
    if (
      !expectedConnectionIds.has(failure.connection_id)
      || cachedConnectionIds.has(failure.connection_id)
    ) return false
    cachedConnectionIds.add(failure.connection_id)
  }

  return cachedConnectionIds.size === expectedConnectionIds.size
}

export function routingCacheGeometryMatchesRequests(
  cache: CableRoutingCacheSnapshot | null,
  requests: CableLaneRouteRequest[],
): cache is CableRoutingCacheSnapshot {
  return cache?.version === ROUTING_CACHE_FORMAT_VERSION
    && cache.plannerVersion === ROUTING_PLANNER_VERSION
    && cache.geometryFingerprint === cableRoutingGeometryFingerprint(requests)
}

export function routesFromRoutingCache(
  cache: CableRoutingCacheSnapshot,
): ReadonlyMap<number, CableRouteResult> {
  return new Map(cache.entries.map((entry) => [
    entry.result.route.connection_id,
    fromEngineResult(entry.result),
  ]))
}

export function failuresFromRoutingCache(
  cache: CableRoutingCacheSnapshot,
): ReadonlyMap<number, string> {
  return new Map(cache.failures.map((failure) => [failure.connection_id, failure.message]))
}

function fromEngineResult(result: ObstacleRouteResult): CableRouteResult {
  return {
    points: result.route.points,
    sourceSide: result.source_side,
    targetSide: result.target_side,
    manualAnchorPointIndexes: result.route.manual_anchor_point_indexes,
    usedFallback: result.used_fallback,
  }
}

export async function planCableRoutes(
  client: DomainEngineClient,
  requests: CableLaneRouteRequest[],
  cache: CableRoutingCacheSnapshot | null = null,
): Promise<CableRoutePlanResult> {
  const obstacles = engineObstacles(requests)
  const normalizedRequests = engineRequests(requests)
  const seed = cache?.version === ROUTING_CACHE_FORMAT_VERSION
    && cache.plannerVersion === ROUTING_PLANNER_VERSION
    ? { obstacles: cache.obstacles, entries: cache.entries }
    : null
  const failures = new Map<number, string>()
  const repairs = new Map<number, CableRouteRepair>()
  const recalculatedConnectionIds = new Set<number>()
  let engineRoutes = new Map<number, ObstacleRouteResult>()
  let nextSeed = seed

  for (let batch = 0; batch <= normalizedRequests.length; batch += 1) {
    const response = await client.transient({
      operation: {
        kind: 'plan-cable-routes',
        payload: {
          plan: {
            obstacles,
            requests: normalizedRequests,
            seed: nextSeed,
          },
        },
      },
    })
    if (response.result.kind !== 'cable-routes-planned') {
      throw new Error(
        response.result.kind === 'error'
          ? response.result.payload.message
          : 'Cable routes could not be planned.',
      )
    }

    engineRoutes = new Map(response.result.payload.routes.map((route) => [
      route.route.connection_id,
      route,
    ]))
    for (const connectionId of response.result.payload.recalculated_connection_ids) {
      recalculatedConnectionIds.add(connectionId)
    }
    for (const failure of response.result.payload.failures) {
      failures.set(failure.connection_id, failure.message)
    }
    for (const repair of response.result.payload.repairs) {
      repairs.set(repair.connection_id, repair)
    }
    if (response.result.payload.deferred_connection_ids.length === 0) break

    nextSeed = null
    if (batch === normalizedRequests.length) {
      throw new Error('Cable routing did not converge within its bounded work limit.')
    }
  }

  const entries = normalizedRequests.flatMap((input) => {
    const result = engineRoutes.get(input.request.definition.connection_id)
    return result ? [{ input, result }] : []
  })
  for (const connectionId of engineRoutes.keys()) failures.delete(connectionId)
  const cacheFailures = [...failures].map(([connection_id, message]) => ({ connection_id, message }))
  return {
    routes: new Map([...engineRoutes].map(([connectionId, route]) => [
      connectionId,
      fromEngineResult(route),
    ])),
    recalculatedConnectionIds: [...recalculatedConnectionIds],
    failures,
    repairs: [...repairs.values()],
    cache: {
      version: ROUTING_CACHE_FORMAT_VERSION,
      plannerVersion: ROUTING_PLANNER_VERSION,
      geometryFingerprint: cableRoutingGeometryFingerprint(requests),
      obstacles,
      entries,
      failures: cacheFailures,
      updatedAt: null,
    },
  }
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
