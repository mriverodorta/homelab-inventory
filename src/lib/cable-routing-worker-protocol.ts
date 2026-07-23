import type { CableLaneRouteRequest } from '@/lib/cable-lane-routing'
import type { CableRouteResult } from '@/lib/cable-obstacle-routing'

export type CableRoutingWorkerRequest = {
  type: 'route-cables'
  revision: number
  requests: CableLaneRouteRequest[]
}

export type CableRoutingWorkerSuccess = {
  type: 'routes-ready'
  revision: number
  routes: Array<[number, CableRouteResult]>
}

export type CableRoutingWorkerFailure = {
  type: 'routes-failed'
  revision: number
  message: string
}

export type CableRoutingWorkerResponse =
  | CableRoutingWorkerSuccess
  | CableRoutingWorkerFailure

export type CableRoutingWorkerLike = {
  postMessage: (message: CableRoutingWorkerRequest) => void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<CableRoutingWorkerResponse>) => void,
  ): void
  addEventListener(
    type: 'error',
    listener: (event: ErrorEvent) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<CableRoutingWorkerResponse>) => void,
  ): void
  removeEventListener(
    type: 'error',
    listener: (event: ErrorEvent) => void,
  ): void
  terminate?: () => void
}
