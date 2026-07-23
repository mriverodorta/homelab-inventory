import {
  getReservableCableSegments,
  routeCableAroundObstacles,
  type CableReservedSegment,
  type CableRouteRequest,
  type CableRouteResult,
} from '@/lib/cable-obstacle-routing'

export type CableLaneRouteRequest = {
  connectionId: number
  avoidCableOverlap: boolean
  request: CableRouteRequest
}

export function shouldAvoidCableOverlap(
  avoidGlobally: boolean,
  avoidIndividually: boolean | undefined,
): boolean {
  return avoidGlobally || avoidIndividually === true
}

export function routeCablesWithLaneReservations(
  requests: readonly CableLaneRouteRequest[],
): Map<number, CableRouteResult> {
  const routes = new Map<number, CableRouteResult>()
  const baseRoutes = new Map<number, CableRouteResult>()
  const reservations: CableReservedSegment[] = []
  const sortedRequests = [...requests].sort(
    (first, second) => first.connectionId - second.connectionId,
  )

  for (const entry of sortedRequests) {
    const result = routeCableAroundObstacles({
      ...entry.request,
      reservedSegments: undefined,
    })
    baseRoutes.set(entry.connectionId, result)

    if (!entry.avoidCableOverlap) {
      routes.set(entry.connectionId, result)
      reservations.push(...getReservableCableSegments(result.points))
    }
  }

  for (const entry of sortedRequests) {
    if (!entry.avoidCableOverlap) continue

    const result = routeCableAroundObstacles({
      ...entry.request,
      reservedSegments: [
        ...(entry.request.reservedSegments ?? []),
        ...reservations,
      ],
    })
    const route = result.usedFallback && entry.request.manualBendPoints?.length
      ? baseRoutes.get(entry.connectionId) ?? result
      : result

    routes.set(entry.connectionId, route)
    reservations.push(...getReservableCableSegments(route.points))
  }

  return routes
}
