import {
  isDomainEngineInterruptedError,
  type DomainEngineClient,
} from '@/engine/client'
import {
  failuresFromRoutingCache,
  planCableRoutes,
  routingCacheGeometryMatchesRequests,
  routingCacheMatchesRequests,
  routesFromRoutingCache,
  type CableRoutePlanResult,
  type CableLaneRouteRequest,
  type CableRoutingCacheSnapshot,
} from '@/engine/routing'
import type { CableRouteResult } from '@/lib/cable-geometry'
import { cableRouteResultsEqual } from '@/lib/cable-render-stability'

export type CableRoutingState = {
  routes: ReadonlyMap<number, CableRouteResult>
  pending: boolean
  error: string | null
  warnings: ReadonlyMap<number, string>
  repairs: ReadonlyMap<number, CableRouteCanonicalRepair>
}

export type CableRouteCanonicalRepair = {
  connectionId: number
  originalBendPoints: Array<{ x: number; y: number }>
  bendPoints: Array<{ x: number; y: number }>
  reason: 'terminal-overlap'
}

type Listener = (state: CableRoutingState) => void

type RoutingWork = {
  revision: number
  requests: CableLaneRouteRequest[]
}

function pointsEqual(
  first: readonly { x: number; y: number }[] | undefined,
  second: readonly { x: number; y: number }[] | undefined,
): boolean {
  if (first === second) return true
  if (!first || !second || first.length !== second.length) return false
  return first.every((point, index) => (
    point.x === second[index].x && point.y === second[index].y
  ))
}

function candidatesEqual(
  first: CableLaneRouteRequest['request']['sourceCandidates'],
  second: CableLaneRouteRequest['request']['sourceCandidates'],
): boolean {
  return first.length === second.length && first.every((candidate, index) => (
    candidate.side === second[index].side
    && candidate.point.x === second[index].point.x
    && candidate.point.y === second[index].point.y
  ))
}

function routeRequestsEqual(
  first: CableLaneRouteRequest,
  second: CableLaneRouteRequest,
): boolean {
  return first.connectionId === second.connectionId
    && first.avoidCableOverlap === second.avoidCableOverlap
    && first.request.source.x === second.request.source.x
    && first.request.source.y === second.request.source.y
    && first.request.target.x === second.request.target.x
    && first.request.target.y === second.request.target.y
    && first.request.sourceSide === second.request.sourceSide
    && first.request.targetSide === second.request.targetSide
    && candidatesEqual(first.request.sourceCandidates, second.request.sourceCandidates)
    && candidatesEqual(first.request.targetCandidates, second.request.targetCandidates)
    && first.request.laneOffset === second.request.laneOffset
    && obstaclesEqual(first.request.obstacles, second.request.obstacles)
    && first.request.sourceItemId === second.request.sourceItemId
    && first.request.targetItemId === second.request.targetItemId
    && first.request.snapToGrid === second.request.snapToGrid
    && pointsEqual(first.request.manualBendPoints, second.request.manualBendPoints)
    && pointsEqual(
      first.request.reservedSegments?.flatMap((segment) => [segment.start, segment.end]),
      second.request.reservedSegments?.flatMap((segment) => [segment.start, segment.end]),
    )
}

function obstaclesEqual(
  first: CableLaneRouteRequest['request']['obstacles'],
  second: CableLaneRouteRequest['request']['obstacles'],
): boolean {
  if (first === second) return true
  if (first.length !== second.length) return false
  const secondById = new Map(second.map((obstacle) => [obstacle.itemId, obstacle]))
  return first.every((obstacle) => {
    const candidate = secondById.get(obstacle.itemId)
    return candidate
      && obstacle.itemId === candidate.itemId
      && obstacle.left === candidate.left
      && obstacle.top === candidate.top
      && obstacle.right === candidate.right
      && obstacle.bottom === candidate.bottom
  })
}

function requestSetsEqual(
  first: ReadonlyMap<number, CableLaneRouteRequest>,
  second: ReadonlyMap<number, CableLaneRouteRequest>,
) {
  return first.size === second.size && [...first].every(([connectionId, request]) => {
    const candidate = second.get(connectionId)
    return candidate ? routeRequestsEqual(request, candidate) : false
  })
}

function reconcileRouteMap(
  current: ReadonlyMap<number, CableRouteResult>,
  calculated: ReadonlyMap<number, CableRouteResult>,
  desiredConnectionIds: ReadonlySet<number>,
): ReadonlyMap<number, CableRouteResult> {
  const next = new Map<number, CableRouteResult>()
  for (const connectionId of desiredConnectionIds) {
    const route = calculated.get(connectionId)
    const previous = current.get(connectionId)
    if (!route) {
      if (previous) next.set(connectionId, previous)
      continue
    }
    next.set(
      connectionId,
      previous && cableRouteResultsEqual(previous, route) ? previous : route,
    )
  }
  if (
    current.size === next.size
    && [...current].every(([connectionId, route]) => next.get(connectionId) === route)
  ) return current
  return next
}

function removeFailedRoutes(
  routes: ReadonlyMap<number, CableRouteResult>,
  failures: ReadonlyMap<number, string>,
) {
  if (![...failures.keys()].some((connectionId) => routes.has(connectionId))) return routes
  const next = new Map(routes)
  for (const connectionId of failures.keys()) next.delete(connectionId)
  return next
}

export class CableRoutingCoordinator {
  private readonly client: DomainEngineClient
  private readonly listeners = new Set<Listener>()
  private revision = 0
  private activeWork: RoutingWork | null = null
  private queuedWork: RoutingWork | null = null
  private desiredRequests = new Map<number, CableLaneRouteRequest>()
  private disposed = false
  private cache: CableRoutingCacheSnapshot | null = null
  private readonly persistCache: ((cache: CableRoutingCacheSnapshot) => Promise<unknown>) | null
  private state: CableRoutingState = {
    routes: new Map(),
    pending: false,
    error: null,
    warnings: new Map(),
    repairs: new Map(),
  }

  constructor(
    client: DomainEngineClient,
    options: { persistCache?: (cache: CableRoutingCacheSnapshot) => Promise<unknown> } = {},
  ) {
    this.client = client
    this.persistCache = options.persistCache ?? null
  }

  hydrate(cache: CableRoutingCacheSnapshot): void {
    if (this.disposed) return
    this.cache = cache
  }

  getState(): CableRoutingState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  request(requests: CableLaneRouteRequest[], force = false): number {
    const nextRequests = new Map(requests.map((request) => [request.connectionId, request]))
    if (!force && requestSetsEqual(this.desiredRequests, nextRequests)) return this.revision

    this.desiredRequests = nextRequests
    if (this.cache && routingCacheMatchesRequests(this.cache, requests)) {
      if (!force && (this.activeWork || this.queuedWork)) this.revision += 1
      if (!force) this.queuedWork = null
      this.updateState({
        ...this.state,
        routes: reconcileRouteMap(
          this.state.routes,
          routesFromRoutingCache(this.cache),
          new Set(nextRequests.keys()),
        ),
        pending: force || this.activeWork !== null,
        error: null,
        warnings: failuresFromRoutingCache(this.cache),
        repairs: new Map(),
      })
      if (!force) return this.revision
    }
    if (!force && routingCacheGeometryMatchesRequests(this.cache, requests)) {
      this.updateState({
        ...this.state,
        routes: reconcileRouteMap(
          this.state.routes,
          routesFromRoutingCache(this.cache),
          new Set(nextRequests.keys()),
        ),
        error: null,
        warnings: failuresFromRoutingCache(this.cache),
        repairs: new Map(),
      })
    }
    const revision = ++this.revision
    this.queuedWork = { revision, requests }
    this.updateState({ ...this.state, pending: true, error: null })
    this.dispatchNext()
    return revision
  }

  clear(): void {
    this.request([])
    this.updateState({
      routes: new Map(),
      pending: this.activeWork !== null,
      error: null,
      warnings: new Map(),
      repairs: new Map(),
    })
  }

  dispose(): void {
    this.disposed = true
    this.revision += 1
    this.activeWork = null
    this.queuedWork = null
    this.desiredRequests.clear()
    this.listeners.clear()
  }

  private dispatchNext(): void {
    if (this.disposed || this.activeWork || !this.queuedWork) return
    const work = this.queuedWork
    this.activeWork = work
    this.queuedWork = null
    void planCableRoutes(this.client, work.requests, this.cache).then(
      (result) => this.complete(work, result),
      (error) => this.fail(work, error),
    )
  }

  private complete(work: RoutingWork, result: CableRoutePlanResult): void {
    if (this.disposed || this.activeWork !== work) return
    this.activeWork = null
    if (work.revision === this.revision) {
      const previousFingerprint = this.cache?.geometryFingerprint
      const hasCacheableOutcome = result.cache.entries.length > 0
        || result.cache.failures.length > 0
        || work.requests.length === 0
      if (hasCacheableOutcome) this.cache = result.cache
      const nextRoutes = removeFailedRoutes(reconcileRouteMap(
          this.state.routes,
          result.routes,
          new Set(this.desiredRequests.keys()),
        ), result.failures)
      this.updateState({
        routes: nextRoutes,
        pending: this.queuedWork !== null,
        error: null,
        warnings: result.failures,
        repairs: new Map(result.repairs.flatMap((repair) => {
          const request = work.requests.find((candidate) => candidate.connectionId === repair.connection_id)
          return request ? [[repair.connection_id, {
            connectionId: repair.connection_id,
            originalBendPoints: [...(request.request.manualBendPoints ?? [])],
            bendPoints: repair.bend_points,
            reason: repair.reason,
          } satisfies CableRouteCanonicalRepair]] : []
        })),
      })
      if (
        hasCacheableOutcome
        && result.repairs.length === 0
        && this.persistCache
        && (previousFingerprint !== result.cache.geometryFingerprint
          || result.recalculatedConnectionIds.length > 0)
      ) {
        void this.persistCache(result.cache).catch((error) => {
          console.warn('[Cable routing] Unable to persist derived route cache.', error)
        })
      }
      for (const [connectionId, warning] of result.failures) {
        const failedRequest = work.requests.find((request) => request.connectionId === connectionId)
        console.warn(
          `[Cable routing] Connection ${connectionId}: ${warning}`,
          failedRequest ? {
            connectionId,
            sourceItemId: failedRequest.request.sourceItemId,
            targetItemId: failedRequest.request.targetItemId,
            sourceSide: failedRequest.request.sourceSide,
            targetSide: failedRequest.request.targetSide,
            sourceCandidateCount: failedRequest.request.sourceCandidates.length,
            targetCandidateCount: failedRequest.request.targetCandidates.length,
            obstacleCount: failedRequest.request.obstacles.length,
          } : undefined,
        )
      }
    }
    this.dispatchNext()
    this.finishPendingState()
  }

  private fail(work: RoutingWork, error: unknown): void {
    if (this.disposed || this.activeWork !== work) return
    this.activeWork = null
    if (isDomainEngineInterruptedError(error)) {
      if (work.revision === this.revision) {
        this.updateState({
          ...this.state,
          pending: this.queuedWork !== null,
          error: null,
        })
      }
      this.dispatchNext()
      this.finishPendingState()
      return
    }
    if (work.revision === this.revision) {
      this.updateState({
        ...this.state,
        pending: this.queuedWork !== null,
        error: error instanceof Error ? error.message : 'Background cable routing failed.',
      })
    }
    this.dispatchNext()
    this.finishPendingState()
  }

  private finishPendingState(): void {
    if (!this.activeWork && !this.queuedWork && this.state.pending) {
      this.updateState({ ...this.state, pending: false })
    }
  }

  private updateState(nextState: CableRoutingState): void {
    if (
      this.state.routes === nextState.routes
      && this.state.pending === nextState.pending
      && this.state.error === nextState.error
      && this.state.warnings === nextState.warnings
      && this.state.repairs === nextState.repairs
    ) return
    this.state = nextState
    for (const listener of this.listeners) listener(this.state)
  }
}
