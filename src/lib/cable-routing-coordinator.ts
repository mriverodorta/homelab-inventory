import type { CableLaneRouteRequest } from '@/lib/cable-lane-routing'
import { cableRouteResultsEqual } from '@/lib/cable-render-stability'
import type { CableRouteResult } from '@/lib/cable-obstacle-routing'
import type {
  CableRoutingWorkerLike,
  CableRoutingWorkerRequest,
  CableRoutingWorkerResponse,
} from '@/lib/cable-routing-worker-protocol'

export type CableRoutingState = {
  routes: ReadonlyMap<number, CableRouteResult>
  pending: boolean
  error: string | null
}

type Listener = (state: CableRoutingState) => void

type RoutingWork = {
  message: CableRoutingWorkerRequest
  replaceAll: boolean
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

function routesWithRemovedConnections(
  routes: ReadonlyMap<number, CableRouteResult>,
  desiredRequests: ReadonlyMap<number, CableLaneRouteRequest>,
): ReadonlyMap<number, CableRouteResult> {
  if ([...routes.keys()].every((connectionId) => desiredRequests.has(connectionId))) {
    return routes
  }

  return new Map(
    [...routes].filter(([connectionId]) => desiredRequests.has(connectionId)),
  )
}

function reconcileRouteMap(
  current: ReadonlyMap<number, CableRouteResult>,
  calculated: ReadonlyMap<number, CableRouteResult>,
  replaceAll: boolean,
): ReadonlyMap<number, CableRouteResult> {
  const next = replaceAll ? new Map<number, CableRouteResult>() : new Map(current)

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
  ) {
    return current
  }

  return next
}

export class CableRoutingCoordinator {
  private readonly worker: CableRoutingWorkerLike
  private readonly listeners = new Set<Listener>()
  private revision = 0
  private activeWork: RoutingWork | null = null
  private queuedWork: RoutingWork | null = null
  private desiredRequests = new Map<number, CableLaneRouteRequest>()
  private state: CableRoutingState = {
    routes: new Map(),
    pending: false,
    error: null,
  }

  constructor(worker: CableRoutingWorkerLike) {
    this.worker = worker
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
  }

  getState(): CableRoutingState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)

    return () => this.listeners.delete(listener)
  }

  request(requests: CableLaneRouteRequest[]): number {
    const nextRequests = new Map(requests.map((request) => [request.connectionId, request]))
    const changedRequests = requests.filter((request) => {
      const previous = this.desiredRequests.get(request.connectionId)
      return !previous || !routeRequestsEqual(previous, request)
    })
    const removedConnectionIds = [...this.desiredRequests.keys()].filter(
      (connectionId) => !nextRequests.has(connectionId),
    )

    if (changedRequests.length === 0 && removedConnectionIds.length === 0) {
      return this.revision
    }

    const previousHadCollisionDependencies = [...this.desiredRequests.values()].some(
      (request) => request.avoidCableOverlap,
    )
    const hasCollisionDependencies = requests.some((request) => request.avoidCableOverlap)
    this.desiredRequests = nextRequests

    const retainedRoutes = routesWithRemovedConnections(this.state.routes, nextRequests)
    const hasCompleteRouteSet = requests.every(
      (request) => retainedRoutes.has(request.connectionId),
    )
    const replaceAll = previousHadCollisionDependencies
      || hasCollisionDependencies
      || !hasCompleteRouteSet
    const requestsToRoute = replaceAll ? requests : changedRequests
    const revision = ++this.revision

    if (requestsToRoute.length === 0) {
      this.queuedWork = null
      this.updateState({
        routes: retainedRoutes,
        pending: this.activeWork !== null,
        error: null,
      })
      return revision
    }

    this.queuedWork = {
      replaceAll,
      message: {
        type: 'route-cables',
        revision,
        requests: requestsToRoute,
      },
    }
    this.updateState({ routes: retainedRoutes, pending: true, error: null })
    this.dispatchNext()
    return revision
  }

  clear(): void {
    this.revision += 1
    this.activeWork = null
    this.queuedWork = null
    this.desiredRequests.clear()
    this.updateState({
      routes: new Map(),
      pending: false,
      error: null,
    })
  }

  dispose(): void {
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    this.worker.terminate?.()
    this.listeners.clear()
  }

  private readonly handleMessage = (event: MessageEvent<CableRoutingWorkerResponse>) => {
    const response = event.data

    if (response.revision !== this.activeWork?.message.revision) return

    const completedWork = this.activeWork
    this.activeWork = null
    const isLatest = response.revision === this.revision

    if (isLatest && response.type === 'routes-ready') {
      const calculated = new Map(response.routes)
      this.updateState({
        routes: reconcileRouteMap(this.state.routes, calculated, completedWork.replaceAll),
        pending: this.queuedWork !== null,
        error: null,
      })
    } else if (isLatest && response.type === 'routes-failed') {
      this.updateState({
        ...this.state,
        pending: this.queuedWork !== null,
        error: response.message,
      })
    }

    this.dispatchNext()
    if (!this.activeWork && !this.queuedWork && this.state.pending) {
      this.updateState({ ...this.state, pending: false })
    }
  }

  private readonly handleError = (event: ErrorEvent) => {
    this.activeWork = null
    this.queuedWork = null
    this.updateState({
      ...this.state,
      pending: false,
      error: event.message || 'Background cable routing failed.',
    })
  }

  private dispatchNext(): void {
    if (this.activeWork || !this.queuedWork) return

    this.activeWork = this.queuedWork
    this.queuedWork = null
    this.worker.postMessage(this.activeWork.message)
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
