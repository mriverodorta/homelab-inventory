import { describeConnectionEndpoint } from '@/lib/cables'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import type {
  ConnectionEndpoint,
  InventoryConnection,
  InventoryItem,
  InventoryPort,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'

export function formatPortTypeLabel(type: InventoryPortType): string {
  if (type === 'sfp-plus') {
    return 'SFP+'
  }

  if (type === 'displayport') {
    return 'DP'
  }

  if (type === 'mini-displayport') {
    return 'MiniDP'
  }

  return type.toUpperCase()
}

export function updatePort(
  ports: InventoryPort[],
  portId: string | number,
  patch: Partial<Pick<InventoryPort, 'ipAddress' | 'label' | 'notes' | 'role' | 'type'>>,
): InventoryPort[] {
  return ports.map((port) =>
    String(port.id) === String(portId)
      ? Object.fromEntries(
          Object.entries({
            ...port,
            ...patch,
          }).filter(([, value]) => value !== '' && value !== undefined),
        ) as InventoryPort
      : port,
  )
}

export type ConnectionState = 'open' | 'partial' | 'connected' | 'conflict'

export function getEndpointConnections(project: ProjectState, endpoint: ConnectionEndpoint): InventoryConnection[] {
  const key = endpointKey(endpoint)

  return (project.connections ?? []).filter(
    (connection) => endpointKey(connection.from) === key || endpointKey(connection.to) === key,
  )
}

export function getEndpointConnectionState(project: ProjectState, endpoint: ConnectionEndpoint): ConnectionState {
  const connections = getEndpointConnections(project, endpoint)

  if (connections.length > 1) {
    return 'conflict'
  }

  return connections.length === 0 ? 'open' : 'connected'
}

export function getPortConnectionState(
  project: ProjectState,
  item: InventoryItem,
  port: InventoryPort,
): ConnectionState {
  const itemRuntimeKey = runtimeItemKey(item)

  if (port.endpoints && port.endpoints.length > 0) {
    const endpointStates = port.endpoints.map((endpoint) =>
      getEndpointConnectionState(project, {
          itemId: itemRuntimeKey,
          portId: port.id,
          endpointId: endpoint.id,
        }),
    )

    if (endpointStates.includes('conflict')) {
      return 'conflict'
    }

    const connectedCount = endpointStates.filter((state) => state === 'connected').length

    if (connectedCount === 0) {
      return 'open'
    }

    return connectedCount === port.endpoints.length ? 'connected' : 'partial'
  }

  return getEndpointConnectionState(project, { itemId: itemRuntimeKey, portId: port.id })
}

export function connectionStateTone(state: ConnectionState): string {
  if (state === 'conflict') {
    return 'border-[#dfb3a5] bg-[#fff4ee] text-[#7a2c1d]'
  }

  if (state === 'connected') {
    return 'border-[#a7d8cd] bg-[#d3eee7] text-[#143733]'
  }

  if (state === 'partial') {
    return 'border-[#e8d392] bg-[#fff2c7] text-[#3d2a08]'
  }

  return 'border-[#e5dccf] bg-[#f3f0ea] text-[#75695d]'
}

export function connectionStateLabel(state: ConnectionState): string {
  if (state === 'conflict') {
    return 'Conflict'
  }

  if (state === 'connected') {
    return 'Connected'
  }

  if (state === 'partial') {
    return 'Partial'
  }

  return 'Open'
}

export function getOppositeEndpoint(connection: InventoryConnection, endpoint: ConnectionEndpoint): ConnectionEndpoint {
  return endpointKey(connection.from) === endpointKey(endpoint) ? connection.to : connection.from
}

export function describeConnectedEndpoint(project: ProjectState, endpoint: ConnectionEndpoint): string {
  const connections = getEndpointConnections(project, endpoint)

  if (connections.length === 0) {
    return 'Open'
  }

  if (connections.length > 1) {
    return `${connections.length} connections`
  }

  return describeConnectionEndpoint(project, getOppositeEndpoint(connections[0], endpoint))
}

export function endpointIsCompatible(
  pendingEndpoint: ConnectionEndpoint | null,
  endpoint: ConnectionEndpoint,
  compatibleEndpointKeys: ReadonlySet<string> | null,
): boolean {
  if (!pendingEndpoint || endpointKey(pendingEndpoint) === endpointKey(endpoint)) {
    return true
  }

  return compatibleEndpointKeys?.has(endpointKey(endpoint)) ?? false
}
