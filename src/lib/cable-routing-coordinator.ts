import type { DomainEngineClient } from '@/engine/client'
import {
  planCableRoutes,
  type CableLaneRouteRequest,
} from '@/engine/routing'
import type { CableRouteResult } from '@/lib/cable-geometry'
import { cableRouteResultsEqual } from '@/lib/cable-render-stability'

export type CableRoutingState = {
  routes: ReadonlyMap<number, CableRouteResult>
  pending: boolean
  error: string | null
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
    && first.request.laneOffset === second.request.laneOffset
    && first.request.obstacles === second.request.obstacles
    && first.request.sourceItemId === second.request.sourceItemId
    && first.request.targetItemId === second.request.targetItemId
    && first.request.snapToGrid === second.request.snapToGrid
    && pointsEqual(first.request.manualBendPoints, second.request.manualBendPoints)
    && pointsEqual(
      first.request.reservedSegments?.flatMap((segment) => [segment.start, segment.end]),
      second.request.reservedSegments?.flatMap((segment) => [segment.start, segment.end]),
    )
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
): ReadonlyMap<number, CableRouteResult> {
  const next = new Map<number, CableRouteResult>()
  for (const [connectionId, route] of calculated) {
    const previous = current.get(connectionId)
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

export class CableRoutingCoordinator {
  private readonly client: DomainEngineClient
  private readonly listeners = new Set<Listener>()
  private revision = 0
  private activeWork: RoutingWork | null = null
  private queuedWork: RoutingWork | null = null
  private desiredRequests = new Map<number, CableLaneRouteRequest>()
  private disposed = false
  private state: CableRoutingState = {
    routes: new Map(),
    pending: false,
    error: null,
  }

  constructor(client: DomainEngineClient) {
    this.client = client
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
    const revision = ++this.revision
    this.queuedWork = { revision, requests }
    this.updateState({ ...this.state, pending: true, error: null })
    this.dispatchNext()
    return revision
  }

  clear(): void {
    this.request([])
    this.updateState({ routes: new Map(), pending: this.activeWork !== null, error: null })
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
    void planCableRoutes(this.client, work.requests).then(
      (result) => this.complete(work, result.routes),
      (error) => this.fail(work, error),
    )
  }

  private complete(work: RoutingWork, routes: ReadonlyMap<number, CableRouteResult>): void {
    if (this.disposed || this.activeWork !== work) return
    this.activeWork = null
    if (work.revision === this.revision) {
      this.updateState({
        routes: reconcileRouteMap(this.state.routes, routes),
        pending: this.queuedWork !== null,
        error: null,
      })
    }
    this.dispatchNext()
    this.finishPendingState()
  }

  private fail(work: RoutingWork, error: unknown): void {
    if (this.disposed || this.activeWork !== work) return
    this.activeWork = null
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
    ) return
    this.state = nextState
    for (const listener of this.listeners) listener(this.state)
  }
}
