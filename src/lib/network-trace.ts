import { describeConnectionEndpoint } from '@/lib/cables'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey, getConnectionPort } from '@/lib/project'
import type {
  ConnectionEndpoint,
  InventoryConnection,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

const NETWORK_PORT_TYPES = new Set(['rj45', 'sfp', 'sfp-plus'])

export type NetworkTraceStep = {
  endpoint: ConnectionEndpoint
  label: string
  state: 'connected' | 'open' | 'internal'
  connectionId?: string | number
}

export type NetworkTrace = {
  start: ConnectionEndpoint
  steps: NetworkTraceStep[]
  complete: boolean
}

function isNetworkPort(port: InventoryPort | null | undefined): boolean {
  return port ? NETWORK_PORT_TYPES.has(port.type) : false
}

function endpointConnection(project: ProjectState, endpoint: ConnectionEndpoint): InventoryConnection | null {
  const key = endpointKey(endpoint)

  return (project.connections ?? []).find(
    (connection) => endpointKey(connection.from) === key || endpointKey(connection.to) === key,
  ) ?? null
}

function oppositeEndpoint(connection: InventoryConnection, endpoint: ConnectionEndpoint): ConnectionEndpoint {
  return endpointKey(connection.from) === endpointKey(endpoint) ? connection.to : connection.from
}

function getPatchPanelPeerEndpoint(
  project: ProjectState,
  endpoint: ConnectionEndpoint,
): ConnectionEndpoint | null {
  const item = project.items[endpoint.itemId]
  const port = getConnectionPort(project, endpoint)

  if (item?.type !== 'patchPanel' || !port?.endpoints || !endpoint.endpointId || !isNetworkPort(port)) {
    return null
  }

  const peer = port.endpoints.find((candidate) => candidate.id !== endpoint.endpointId)

  if (!peer) {
    return null
  }

  return {
    itemId: runtimeItemKey(item),
    portId: port.id,
    endpointId: peer.id,
  }
}

function stepLabel(project: ProjectState, endpoint: ConnectionEndpoint): string {
  return describeConnectionEndpoint(project, endpoint)
}

export function traceNetworkPath(project: ProjectState, start: ConnectionEndpoint): NetworkTrace | null {
  const startPort = getConnectionPort(project, start)

  if (!isNetworkPort(startPort)) {
    return null
  }

  const startConnection = endpointConnection(project, start)
  const steps: NetworkTraceStep[] = [
    {
      endpoint: start,
      label: startConnection ? stepLabel(project, start) : `${stepLabel(project, start)} is open`,
      state: startConnection ? 'connected' : 'open',
    },
  ]

  if (!startConnection) {
    return {
      start,
      steps,
      complete: false,
    }
  }

  const visited = new Set<string>([endpointKey(start)])
  let current = start
  let complete = false

  for (let index = 0; index < 12; index += 1) {
    const connection = endpointConnection(project, current)

    if (!connection) {
      steps.push({
        endpoint: current,
        label: `${stepLabel(project, current)} is open`,
        state: 'open',
      })
      break
    }

    const next = oppositeEndpoint(connection, current)
    const nextKey = endpointKey(next)

    if (visited.has(nextKey)) {
      break
    }

    visited.add(nextKey)
    steps.push({
      endpoint: next,
      label: stepLabel(project, next),
      state: 'connected',
      connectionId: connection.id,
    })

    const nextItem = project.items[next.itemId]

    if (nextItem?.type === 'switch') {
      complete = true
      break
    }

    const peer = getPatchPanelPeerEndpoint(project, next)

    if (!peer) {
      current = next
      continue
    }

    const peerKey = endpointKey(peer)

    if (visited.has(peerKey)) {
      break
    }

    visited.add(peerKey)
    steps.push({
      endpoint: peer,
      label: stepLabel(project, peer),
      state: 'internal',
    })
    current = peer
  }

  return {
    start,
    steps,
    complete,
  }
}

export function getItemNetworkTraces(project: ProjectState, item: InventoryItem): NetworkTrace[] {
  return (item.ports ?? []).flatMap((port) => {
    if (!isNetworkPort(port) || port.endpoints) {
      return []
    }

    const trace = traceNetworkPath(project, {
      itemId: runtimeItemKey(item),
      portId: port.id,
    })

    return trace ? [trace] : []
  })
}

export function getPatchPanelNetworkTraces(project: ProjectState, item: InventoryItem): NetworkTrace[] {
  if (item.type !== 'patchPanel') {
    return []
  }

  return (item.ports ?? []).flatMap((port) =>
    (port.endpoints ?? []).flatMap((endpoint) => {
      if (!isNetworkPort(port)) {
        return []
      }

      const trace = traceNetworkPath(project, {
        itemId: runtimeItemKey(item),
        portId: port.id,
        endpointId: endpoint.id,
      })

      return trace ? [trace] : []
    }),
  )
}

export function getNetworkTraceConnectionIds(trace: NetworkTrace): Array<string | number> {
  return [
    ...new Set(
      trace.steps
        .map((step) => step.connectionId)
        .filter((connectionId): connectionId is string | number => connectionId !== undefined),
    ),
  ]
}

export function getNetworkTraceItemIds(trace: NetworkTrace): string[] {
  return [...new Set(trace.steps.map((step) => step.endpoint.itemId))]
}
