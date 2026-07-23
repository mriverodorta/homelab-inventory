/// <reference lib="webworker" />

import { routeCablesWithLaneReservations } from '@/lib/cable-lane-routing'
import type {
  CableRoutingWorkerRequest,
  CableRoutingWorkerResponse,
} from '@/lib/cable-routing-worker-protocol'

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', (event: MessageEvent<CableRoutingWorkerRequest>) => {
  const request = event.data
  if (request.type !== 'route-cables') return

  let response: CableRoutingWorkerResponse

  try {
    response = {
      type: 'routes-ready',
      revision: request.revision,
      routes: [...routeCablesWithLaneReservations(request.requests)],
    }
  } catch (error) {
    response = {
      type: 'routes-failed',
      revision: request.revision,
      message: error instanceof Error ? error.message : 'Cable routing failed.',
    }
  }

  workerScope.postMessage(response)
})
