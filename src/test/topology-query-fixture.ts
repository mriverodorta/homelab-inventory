import type {
  RuntimePowerEndpoint,
  RuntimeTopologyEndpointDescriptor,
} from '@/engine/topology'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

function directEndpoints(item: InventoryItem, port: InventoryPort): ConnectionEndpoint[] {
  const itemId = runtimeItemKey(item)
  return port.endpoints?.length
    ? port.endpoints.map((side) => ({ itemId, portId: port.id, endpointId: side.id }))
    : [{ itemId, portId: port.id }]
}

function hostedEndpoints(
  host: InventoryItem,
  owner: InventoryItem,
  port: InventoryPort,
): ConnectionEndpoint[] {
  const itemId = runtimeItemKey(host)
  const hostedItemId = runtimeItemKey(owner)
  return port.endpoints?.length
    ? port.endpoints.map((side) => ({
        itemId,
        hostedItemId,
        portId: port.id,
        endpointId: side.id,
      }))
    : [{ itemId, hostedItemId, portId: port.id }]
}

function connectedIds(project: ProjectState, endpoint: ConnectionEndpoint): number[] {
  const key = endpointKey(endpoint)
  return project.connections.flatMap((connection) =>
    endpointKey(connection.from) === key || endpointKey(connection.to) === key
      ? [connection.id]
      : [],
  )
}

function descriptor(
  project: ProjectState,
  host: InventoryItem,
  owner: InventoryItem,
  port: InventoryPort,
  endpoint: ConnectionEndpoint,
): RuntimeTopologyEndpointDescriptor {
  const connectionIds = connectedIds(project, endpoint)
  const side = endpoint.endpointId === undefined
    ? null
    : port.endpoints?.find((candidate) => candidate.id === endpoint.endpointId)?.side ?? null
  return {
    endpoint,
    hostItemId: runtimeItemKey(host),
    ownerItemId: runtimeItemKey(owner),
    port_type: port.type,
    slot_number: port.slotNumber,
    side,
    speed: port.speed ?? null,
    connection_ids: connectionIds,
    placed: project.placements.some((placement) => placement.serverId === runtimeItemKey(host)),
    available: connectionIds.length === 0,
    power: null,
  }
}

function powerKind(
  host: InventoryItem,
  owner: InventoryItem,
  port: InventoryPort,
): RuntimePowerEndpoint['kind'] | null {
  if (port.type === 'ac-outlet') {
    return host.type === 'ups' ? 'ups-outlet' : 'power-strip-outlet'
  }
  if (port.type !== 'ac-input') return null
  if (host.type === 'powerStrip') return 'power-strip-input'
  if (host.type === 'monitor') return 'monitor-input'
  if (host.type === 'nas' && host === owner) return 'nas-internal-input'
  if (owner.type === 'powerSupply') return 'pc-power-supply-input'
  if (owner.type === 'powerAdapter') return 'oem-power-adapter-input'
  return null
}

function powerLabel(host: InventoryItem, owner: InventoryItem, port: InventoryPort): string {
  if (port.type === 'ac-outlet') {
    return `${host.name} / ${port.label ?? `Outlet ${String(port.slotNumber)}`}`
  }
  return host === owner
    ? `${host.name} / AC input`
    : `${host.name} / ${owner.name} / AC input`
}

export function topologyQueryFixture(project: ProjectState): TopologyQueryData {
  const descriptors: RuntimeTopologyEndpointDescriptor[] = []
  const powerEndpoints: RuntimePowerEndpoint[] = []

  for (const host of Object.values(project.items)) {
    const owners = [
      host,
      ...project.assignments
        .filter((assignment) => assignment.serverId === runtimeItemKey(host))
        .map((assignment) => project.items[assignment.itemId])
        .filter((item): item is InventoryItem => Boolean(item)),
    ]
    for (const owner of owners) {
      for (const port of owner.ports ?? []) {
        const endpoints = host === owner
          ? directEndpoints(host, port)
          : hostedEndpoints(host, owner, port)
        for (const endpoint of endpoints) {
          const endpointDescriptor = descriptor(project, host, owner, port, endpoint)
          const kind = powerKind(host, owner, port)
          if (kind) {
            const direction = port.type === 'ac-outlet' ? 'output' : 'input'
            endpointDescriptor.power = {
              direction,
              kind,
              allow_fan_out: false,
            }
            powerEndpoints.push({
              endpoint,
              direction,
              kind,
              label: powerLabel(host, owner, port),
              allowFanOut: false,
            })
          }
          descriptors.push(endpointDescriptor)
        }
      }
    }
  }

  return {
    revision: 1,
    endpoints: descriptors,
    connectionDerivedById: new Map(project.connections.map((connection) => [connection.id, {
      connectionType: connection.type,
      negotiatedSpeedMbps: connection.negotiatedSpeedMbps ?? null,
    }])),
    power: { endpoints: powerEndpoints, findings: [] },
    networkTraces: [],
    networkTraceByEndpointKey: new Map(),
    networkTracesByItemId: new Map(),
  }
}

export function allTopologyEndpointKeys(project: ProjectState): ReadonlySet<string> {
  return new Set(topologyQueryFixture(project).endpoints.map((entry) => endpointKey(entry.endpoint)))
}
