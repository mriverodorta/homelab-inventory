import {
  ROUTING_CACHE_FORMAT_VERSION,
  ROUTING_PLANNER_VERSION,
} from '../shared/engine/routing-cache-contract.mjs'

export { ROUTING_CACHE_FORMAT_VERSION, ROUTING_PLANNER_VERSION }

const MAX_OBSTACLES = 2_000
const MAX_ENTRIES = 5_000
const MAX_ROUTE_POINTS = 512
const MAX_FAILURE_MESSAGE_LENGTH = 500
const CABLE_SIDES = new Set(['left', 'right', 'top', 'bottom'])

export function createRoutingCache() {
  return {
    version: ROUTING_CACHE_FORMAT_VERSION,
    plannerVersion: ROUTING_PLANNER_VERSION,
    geometryFingerprint: null,
    obstacles: [],
    entries: [],
    failures: [],
    updatedAt: null,
  }
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
}

function resultEndpointMatchesCandidates(entry, endpoint, side, candidateKey, fallbackPointKey, fallbackSideKey) {
  const request = entry?.input?.request
  const candidates = request?.[candidateKey]
  const available = Array.isArray(candidates) && candidates.length > 0
    ? candidates
    : [{
        point: request?.definition?.[fallbackPointKey],
        side: request?.definition?.[fallbackSideKey],
      }]
  return available.some((candidate) => (
    candidate?.side === side
    && finitePoint(candidate.point)
    && candidate.point.x === endpoint.x
    && candidate.point.y === endpoint.y
  ))
}

function isOrthogonalRoute(points) {
  return points.slice(1).every((point, index) => {
    const previous = points[index]
    const horizontal = point.y === previous.y && point.x !== previous.x
    const vertical = point.x === previous.x && point.y !== previous.y
    return horizontal || vertical
  })
}

function hasValidManualAnchors(indexes, pointCount) {
  if (!Array.isArray(indexes)) return false
  const unique = new Set(indexes)
  return unique.size === indexes.length && indexes.every(
    (index) => Number.isSafeInteger(index) && index > 0 && index < pointCount - 1,
  )
}

function assertRoutingCacheShape(cache) {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
    throw new Error('Routing cache must be an object.')
  }
  if (cache.version !== ROUTING_CACHE_FORMAT_VERSION) {
    throw new Error('Routing cache format version is unsupported.')
  }
  if (cache.plannerVersion !== ROUTING_PLANNER_VERSION) {
    throw new Error('Routing cache planner version is unsupported.')
  }
  if (cache.geometryFingerprint !== null && typeof cache.geometryFingerprint !== 'string') {
    throw new Error('Routing cache geometry fingerprint must be a string or null.')
  }
  if (!Array.isArray(cache.obstacles) || cache.obstacles.length > MAX_OBSTACLES) {
    throw new Error('Routing cache obstacles are invalid.')
  }
  if (!Array.isArray(cache.entries) || cache.entries.length > MAX_ENTRIES) {
    throw new Error('Routing cache entries are invalid.')
  }
  if (!Array.isArray(cache.failures) || cache.failures.length > MAX_ENTRIES) {
    throw new Error('Routing cache failures are invalid.')
  }
  const obstacleIds = new Set()
  for (const obstacle of cache.obstacles) {
    const bounds = obstacle?.bounds
    if (
      typeof obstacle?.item_id !== 'string' || obstacle.item_id.length === 0
      || obstacleIds.has(obstacle.item_id)
      || !bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)
      || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)
      || bounds.width < 0 || bounds.height < 0
    ) throw new Error('Routing cache contains an invalid obstacle.')
    obstacleIds.add(obstacle.item_id)
  }
  const connectionIds = new Set()
  for (const entry of cache.entries) {
    const id = entry?.input?.request?.definition?.connection_id
    const result = entry?.result
    const points = result?.route?.points
    if (
      !Number.isSafeInteger(id) || id <= 0 || connectionIds.has(id)
      || result?.route?.connection_id !== id
      || !Array.isArray(points)
      || points.length < 2
      || points.length > MAX_ROUTE_POINTS
      || !points.every(finitePoint)
      || !isOrthogonalRoute(points)
      || !CABLE_SIDES.has(result.source_side)
      || !CABLE_SIDES.has(result.target_side)
      || typeof result.used_fallback !== 'boolean'
      || (result.warning !== null && typeof result.warning !== 'string')
      || !hasValidManualAnchors(
        result.route.manual_anchor_point_indexes,
        points.length,
      )
      || !resultEndpointMatchesCandidates(
        entry,
        points[0],
        result.source_side,
        'source_candidates',
        'source',
        'source_side',
      )
      || !resultEndpointMatchesCandidates(
        entry,
        points[points.length - 1],
        result.target_side,
        'target_candidates',
        'target',
        'target_side',
      )
      || (result.repaired_bend_points !== undefined
        && (!Array.isArray(result.repaired_bend_points)
          || !result.repaired_bend_points.every(finitePoint)))
      || (result.repair_reason !== undefined && result.repair_reason !== 'terminal-overlap')
    ) throw new Error('Routing cache contains an invalid route entry.')
    connectionIds.add(id)
  }
  for (const failure of cache.failures) {
    if (
      !Number.isSafeInteger(failure?.connection_id) || failure.connection_id <= 0
      || connectionIds.has(failure.connection_id)
      || typeof failure.message !== 'string' || failure.message.length === 0
      || failure.message.length > MAX_FAILURE_MESSAGE_LENGTH
    ) throw new Error('Routing cache contains an invalid route failure.')
    connectionIds.add(failure.connection_id)
  }
  if (cache.updatedAt !== null && typeof cache.updatedAt !== 'string') {
    throw new Error('Routing cache updatedAt must be a string or null.')
  }
}

export function normalizeRoutingCache(value) {
  try {
    assertRoutingCacheShape(value)
    return structuredClone(value)
  } catch {
    return createRoutingCache()
  }
}

export function validateRoutingCache(value) {
  assertRoutingCacheShape(value)
  return structuredClone(value)
}
