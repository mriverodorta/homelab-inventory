import {
  ROUTING_CACHE_FORMAT_VERSION,
  ROUTING_PLANNER_VERSION,
} from '../shared/engine/routing-cache-contract.mjs'

export { ROUTING_CACHE_FORMAT_VERSION, ROUTING_PLANNER_VERSION }

const MAX_ENTRIES = 5_000
const MAX_ROUTE_POINTS = 512
const MAX_FAILURE_MESSAGE_LENGTH = 500
const CABLE_SIDES = new Set(['left', 'right', 'top', 'bottom'])

export function createRoutingCache() {
  return {
    version: ROUTING_CACHE_FORMAT_VERSION,
    plannerVersion: ROUTING_PLANNER_VERSION,
    geometryFingerprint: null,
    entries: [],
    failures: [],
    updatedAt: null,
  }
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
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
  if (
    cache.geometryFingerprint !== null
    && (typeof cache.geometryFingerprint !== 'string'
      || !/^[0-9a-f]{16}$/u.test(cache.geometryFingerprint))
  ) {
    throw new Error('Routing cache geometry fingerprint must be a canonical digest or null.')
  }
  if (Object.hasOwn(cache, 'obstacles')) {
    throw new Error('Routing cache must not persist planner obstacles.')
  }
  if (!Array.isArray(cache.entries) || cache.entries.length > MAX_ENTRIES) {
    throw new Error('Routing cache entries are invalid.')
  }
  if (!Array.isArray(cache.failures) || cache.failures.length > MAX_ENTRIES) {
    throw new Error('Routing cache failures are invalid.')
  }
  const connectionIds = new Set()
  for (const entry of cache.entries) {
    const id = entry?.connectionId
    const result = entry?.result
    const points = result?.route?.points
    if (
      !Number.isSafeInteger(id) || id <= 0 || connectionIds.has(id)
      || Object.hasOwn(entry ?? {}, 'input')
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
    return normalizedRoutingCache(value)
  } catch {
    return createRoutingCache()
  }
}

export function validateRoutingCache(value) {
  assertRoutingCacheShape(value)
  return normalizedRoutingCache(value)
}

function normalizedRoutingCache(value) {
  return {
    version: ROUTING_CACHE_FORMAT_VERSION,
    plannerVersion: ROUTING_PLANNER_VERSION,
    geometryFingerprint: value.geometryFingerprint,
    entries: structuredClone(value.entries).sort((first, second) => (
      first.connectionId - second.connectionId
    )),
    failures: structuredClone(value.failures).sort((first, second) => (
      first.connection_id - second.connection_id
    )),
    updatedAt: value.updatedAt,
  }
}
