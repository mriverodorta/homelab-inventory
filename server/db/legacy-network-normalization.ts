import type {
  ConnectionEndpoint,
  InventoryConnection,
  InventoryPort,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'

// Frozen migration support for schemas that predate Rust-owned topology.

export const NETWORK_SPEEDS_MBPS = [1000, 2500, 5000, 10000] as const
export const SWITCH_NETWORK_PORT_TYPES = new Set<InventoryPortType>([
  'rj45',
  'sfp',
  'sfp-plus',
])
export const SUPPORTED_SWITCH_PORT_SPEEDS = ['1G', '2.5G', '5G', '10G'] as const

const ACTIVE_NETWORK_ITEM_TYPES = new Set(['server', 'nas', 'switch'])

export type SupportedSwitchPortSpeed = (typeof SUPPORTED_SWITCH_PORT_SPEEDS)[number]

function isSupportedSwitchPortSpeed(
  speed: string | undefined,
): speed is SupportedSwitchPortSpeed {
  return SUPPORTED_SWITCH_PORT_SPEEDS.includes(speed as SupportedSwitchPortSpeed)
}

export function defaultSwitchPortSpeed(type: InventoryPortType): SupportedSwitchPortSpeed | null {
  if (type === 'sfp-plus') {
    return '10G'
  }

  if (type === 'rj45' || type === 'sfp') {
    return '1G'
  }

  return null
}

function isSupportedNetworkSpeed(speed: number): speed is (typeof NETWORK_SPEEDS_MBPS)[number] {
  return NETWORK_SPEEDS_MBPS.includes(speed as (typeof NETWORK_SPEEDS_MBPS)[number])
}

export function advertisedSpeedMbps(speed: string | undefined): number | null {
  if (!speed) {
    return null
  }

  const normalized = speed.trim().toUpperCase()
  const gigabitMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*G(?:BPS|BE)?$/)

  if (gigabitMatch) {
    const parsed = Number(gigabitMatch[1]) * 1000
    return isSupportedNetworkSpeed(parsed) ? parsed : null
  }

  const megabitMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*M(?:BPS|B\/S)?$/)

  if (megabitMatch) {
    const parsed = Number(megabitMatch[1])
    return isSupportedNetworkSpeed(parsed) ? parsed : null
  }

  return null
}

function endpointKey(endpoint: ConnectionEndpoint): string {
  return [
    endpoint.itemId,
    endpoint.hostedItemId ?? 'direct',
    endpoint.portId,
    endpoint.endpointId ?? 'port',
  ].join(':')
}

function findPort(ports: InventoryPort[] | undefined, portId: string | number): InventoryPort | null {
  return ports?.find((port) => String(port.id) === String(portId)) ?? null
}

function endpointMatchesPort(port: InventoryPort, endpoint: ConnectionEndpoint): boolean {
  if (endpoint.endpointId !== undefined) {
    return port.endpoints?.some(
      (candidate) => String(candidate.id) === String(endpoint.endpointId),
    ) ?? false
  }

  return !port.endpoints || port.endpoints.length === 0
}

function resolveHostedPort(project: ProjectState, endpoint: ConnectionEndpoint): InventoryPort | null {
  const host = project.items[endpoint.itemId]

  if (host?.type !== 'server' && host?.type !== 'nas') {
    return null
  }

  const legacyPortId = String(endpoint.portId)
  const [legacyHostedItemId, legacyHostedPortId] = legacyPortId.includes('::')
    ? legacyPortId.split('::')
    : [undefined, undefined]
  const hostedItemId = endpoint.hostedItemId ?? legacyHostedItemId
  const hostedPortId = endpoint.hostedItemId ? endpoint.portId : legacyHostedPortId

  if (!hostedItemId || hostedPortId === undefined) {
    return null
  }

  const assignment = project.assignments.find(
    (candidate) =>
      candidate.serverId === endpoint.itemId &&
      candidate.itemId === hostedItemId &&
      candidate.type === 'network',
  )
  const hostedItem = assignment ? project.items[hostedItemId] : null

  if (!hostedItem || hostedItem.type !== 'network') {
    return null
  }

  return findPort(hostedItem.ports, hostedPortId)
}

function resolveEndpointPort(project: ProjectState, endpoint: ConnectionEndpoint): InventoryPort | null {
  const host = project.items[endpoint.itemId]

  if (!host) {
    return null
  }

  const port = endpoint.hostedItemId
    ? resolveHostedPort(project, endpoint)
    : findPort(host.ports, endpoint.portId) ?? resolveHostedPort(project, endpoint)

  return port && endpointMatchesPort(port, endpoint) ? port : null
}

function resolveActivePort(project: ProjectState, endpoint: ConnectionEndpoint): InventoryPort | null {
  const host = project.items[endpoint.itemId]

  if (!host || !ACTIVE_NETWORK_ITEM_TYPES.has(host.type)) {
    return null
  }

  return resolveEndpointPort(project, endpoint)
}

function endpointAdvertisedSpeed(project: ProjectState, endpoint: ConnectionEndpoint): number | null {
  const port = resolveActivePort(project, endpoint)

  if (!port || !SWITCH_NETWORK_PORT_TYPES.has(port.type)) {
    return null
  }

  return advertisedSpeedMbps(port.speed) ?? (port.type === 'sfp-plus' ? 10000 : null)
}

function withoutNegotiatedSpeed(connection: InventoryConnection): InventoryConnection {
  const { negotiatedSpeedMbps: _negotiatedSpeedMbps, ...rest } = connection
  return rest
}

export function recalculateNegotiatedSpeeds(project: ProjectState): ProjectState {
  const adjacency = new Map<string, Set<string>>()
  const endpoints = new Map<string, ConnectionEndpoint>()

  const addNode = (endpoint: ConnectionEndpoint): string => {
    const key = endpointKey(endpoint)
    endpoints.set(key, endpoint)

    if (!adjacency.has(key)) {
      adjacency.set(key, new Set())
    }

    return key
  }

  const addEdge = (first: ConnectionEndpoint, second: ConnectionEndpoint) => {
    const firstKey = addNode(first)
    const secondKey = addNode(second)
    adjacency.get(firstKey)?.add(secondKey)
    adjacency.get(secondKey)?.add(firstKey)
  }

  for (const connection of project.connections ?? []) {
    if (connection.type === 'network') {
      addEdge(connection.from, connection.to)
    }
  }

  for (const [itemId, item] of Object.entries(project.items)) {
    if (item.type !== 'patchPanel') {
      continue
    }

    for (const port of item.ports ?? []) {
      if (!SWITCH_NETWORK_PORT_TYPES.has(port.type)) {
        continue
      }

      const front = port.endpoints?.find((endpoint) => endpoint.side === 'front')
      const back = port.endpoints?.find((endpoint) => endpoint.side === 'back')

      if (!front || !back) {
        continue
      }

      addEdge(
        { itemId, portId: port.id, endpointId: front.id },
        { itemId, portId: port.id, endpointId: back.id },
      )
    }
  }

  const negotiatedSpeedByNode = new Map<string, number | undefined>()
  const visited = new Set<string>()

  for (const startKey of adjacency.keys()) {
    if (visited.has(startKey)) {
      continue
    }

    const component: string[] = []
    const knownSpeeds: number[] = []
    const pending = [startKey]
    visited.add(startKey)

    while (pending.length > 0) {
      const currentKey = pending.pop()

      if (!currentKey) {
        continue
      }

      component.push(currentKey)
      const endpoint = endpoints.get(currentKey)
      const speed = endpoint ? endpointAdvertisedSpeed(project, endpoint) : null

      if (speed !== null) {
        knownSpeeds.push(speed)
      }

      for (const neighbor of adjacency.get(currentKey) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          pending.push(neighbor)
        }
      }
    }

    const negotiatedSpeed = knownSpeeds.length > 0 ? Math.min(...knownSpeeds) : undefined

    for (const nodeKey of component) {
      negotiatedSpeedByNode.set(nodeKey, negotiatedSpeed)
    }
  }

  let changed = false
  const connections = (project.connections ?? []).map((connection) => {
    const desiredSpeed = connection.type === 'network'
      ? negotiatedSpeedByNode.get(endpointKey(connection.from))
      : undefined
    const hasStoredSpeed = Object.prototype.hasOwnProperty.call(
      connection,
      'negotiatedSpeedMbps',
    )

    if (desiredSpeed === undefined) {
      if (!hasStoredSpeed) {
        return connection
      }

      changed = true
      return withoutNegotiatedSpeed(connection)
    }

    if (connection.negotiatedSpeedMbps === desiredSpeed) {
      return connection
    }

    changed = true
    return {
      ...connection,
      negotiatedSpeedMbps: desiredSpeed,
    }
  })

  return changed ? { ...project, connections } : project
}

function normalizeSwitchPortSpeeds(project: ProjectState): ProjectState {
  let normalizedItems = project.items

  for (const [itemId, item] of Object.entries(project.items)) {
    if (item.type !== 'switch' || !item.ports) {
      continue
    }

    let portsChanged = false
    const ports = item.ports.map((port) => {
      if (
        !SWITCH_NETWORK_PORT_TYPES.has(port.type) ||
        isSupportedSwitchPortSpeed(port.speed)
      ) {
        return port
      }

      const speed = defaultSwitchPortSpeed(port.type)

      if (!speed) {
        return port
      }

      portsChanged = true
      return { ...port, speed }
    })

    if (!portsChanged) {
      continue
    }

    if (normalizedItems === project.items) {
      normalizedItems = { ...project.items }
    }

    normalizedItems[itemId] = { ...item, ports }
  }

  return normalizedItems === project.items ? project : { ...project, items: normalizedItems }
}

function normalizeLegacyNetworkConnections(project: ProjectState): ProjectState {
  let changed = false
  const connections = (project.connections ?? []).map((connection) => {
    if (connection.type !== 'other') {
      return connection
    }

    const fromPort = resolveEndpointPort(project, connection.from)
    const toPort = resolveEndpointPort(project, connection.to)

    if (
      !fromPort ||
      !toPort ||
      !SWITCH_NETWORK_PORT_TYPES.has(fromPort.type) ||
      !SWITCH_NETWORK_PORT_TYPES.has(toPort.type)
    ) {
      return connection
    }

    changed = true
    return { ...connection, type: 'network' as const }
  })

  return changed ? { ...project, connections } : project
}

export function normalizeNetworkProject(project: ProjectState): ProjectState {
  const portsNormalized = normalizeSwitchPortSpeeds(project)
  const connectionsNormalized = normalizeLegacyNetworkConnections(portsNormalized)

  return recalculateNegotiatedSpeeds(connectionsNormalized)
}
