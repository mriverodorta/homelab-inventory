import type {
  TopologyEndpointDescriptor,
  TopologyEndpointRef,
  TopologyItemRef,
  TopologyConnectionRoute,
  TopologyNetworkTrace,
} from '../../shared/engine/protocol.mjs'
import type { DomainEngineClient } from '@/engine/client'
import { parseItemKey } from '@/lib/item-keys'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  ProjectState,
} from '@/types/inventory'

export type RuntimeTopologyEndpointDescriptor = Omit<
  TopologyEndpointDescriptor,
  'endpoint' | 'host' | 'owner'
> & {
  endpoint: ConnectionEndpoint
  hostItemId: string
  ownerItemId: string
}

export type RuntimeConnectionValidation = {
  ok: boolean
  code: string | null
  message: string | null
}

export type RuntimeNetworkTraceStep = {
  endpoint: ConnectionEndpoint
  state: 'connected' | 'open' | 'internal'
  connectionId?: number
}

export type RuntimeNetworkTrace = {
  start: ConnectionEndpoint
  steps: RuntimeNetworkTraceStep[]
  complete: boolean
}

export type RuntimePowerEndpoint = {
  endpoint: ConnectionEndpoint
  direction: 'input' | 'output'
  kind:
    | 'ups-outlet'
    | 'power-strip-outlet'
    | 'power-strip-input'
    | 'monitor-input'
    | 'nas-internal-input'
    | 'pc-power-supply-input'
    | 'oem-power-adapter-input'
  label: string
  allowFanOut: boolean
}

export type RuntimePowerFinding = {
  id: string
  code:
    | 'power.host.missing-input'
    | 'power.host.unpowered'
    | 'power.monitor.unpowered'
    | 'power.connection.stale-endpoint'
    | 'power.connection.invalid-direction'
    | 'power.connection.duplicate-input'
    | 'power.connection.output-fan-out'
    | 'power.connection.misclassified'
  severity: 'warning' | 'error'
  message: string
  itemId?: string
  connectionId?: number
  endpoint?: ConnectionEndpoint
}

export type RuntimePowerTopology = {
  endpoints: RuntimePowerEndpoint[]
  findings: RuntimePowerFinding[]
}

function topologyItemRef(project: ProjectState, runtimeKey: string): TopologyItemRef {
  const parsed = parseItemKey(runtimeKey)
  const item = project.items[runtimeKey]

  if (!parsed || !item || parsed.type !== item.type || parsed.id !== item.id) {
    throw new Error(`Topology endpoint references invalid inventory item ${runtimeKey}.`)
  }

  return { item_type: parsed.type, id: parsed.id }
}

function runtimeKey(item: TopologyItemRef): string {
  const key = `${item.item_type}:${String(item.id)}`
  if (!parseItemKey(key)) {
    throw new Error(`Topology engine returned invalid inventory item ${key}.`)
  }
  return key
}

export function toTopologyEndpointRef(
  project: ProjectState,
  endpoint: ConnectionEndpoint,
): TopologyEndpointRef {
  return {
    item: topologyItemRef(project, endpoint.itemId),
    port_id: endpoint.portId,
    endpoint_id: endpoint.endpointId ?? null,
    hosted_item: endpoint.hostedItemId
      ? topologyItemRef(project, endpoint.hostedItemId)
      : null,
  }
}

export function fromTopologyEndpointRef(endpoint: TopologyEndpointRef): ConnectionEndpoint {
  return {
    itemId: runtimeKey(endpoint.item),
    portId: endpoint.port_id,
    ...(endpoint.endpoint_id === null ? {} : { endpointId: endpoint.endpoint_id }),
    ...(endpoint.hosted_item === null
      ? {}
      : {
          hostedItemId: runtimeKey(endpoint.hosted_item),
        }),
  }
}

function runtimeDescriptor(
  descriptor: TopologyEndpointDescriptor,
): RuntimeTopologyEndpointDescriptor {
  return {
    ...descriptor,
    endpoint: fromTopologyEndpointRef(descriptor.endpoint),
    hostItemId: runtimeKey(descriptor.host),
    ownerItemId: runtimeKey(descriptor.owner),
  }
}

function runtimeNetworkTrace(trace: TopologyNetworkTrace): RuntimeNetworkTrace {
  return {
    start: fromTopologyEndpointRef(trace.start),
    steps: trace.steps.map((step) => ({
      endpoint: fromTopologyEndpointRef(step.endpoint),
      state: step.state,
      ...(step.connection_id === null ? {} : { connectionId: step.connection_id }),
    })),
    complete: trace.complete,
  }
}

function powerEndpointLabel(
  project: ProjectState,
  descriptor: TopologyEndpointDescriptor,
): string {
  const hostKey = runtimeKey(descriptor.host)
  const ownerKey = runtimeKey(descriptor.owner)
  const host = project.items[hostKey]
  const owner = project.items[ownerKey]
  const port = owner?.ports?.find((candidate) => candidate.id === descriptor.endpoint.port_id)
  if (descriptor.power?.direction === 'output') {
    return `${host?.name ?? hostKey} / ${port?.label ?? `Outlet ${String(descriptor.slot_number)}`}`
  }
  if (hostKey !== ownerKey) {
    return `${host?.name ?? hostKey} / ${owner?.name ?? ownerKey} / AC input`
  }
  return `${host?.name ?? hostKey} / AC input`
}

function powerFindingMessage(
  project: ProjectState,
  code: RuntimePowerFinding['code'],
  itemId: string | undefined,
  connectionId: number | undefined,
): string {
  const item = itemId ? project.items[itemId] : undefined
  const connection = connectionId === undefined
    ? undefined
    : project.connections.find((candidate) => candidate.id === connectionId)
  switch (code) {
    case 'power.host.missing-input': {
      const required = item?.type === 'pcBuild' ? 'power supply' : 'power adapter'
      return `${item?.name ?? itemId ?? 'Placed host'} needs an assigned ${required} before it can be powered.`
    }
    case 'power.host.unpowered':
    case 'power.monitor.unpowered':
      return `${item?.name ?? itemId ?? 'Placed equipment'} is not connected to a power source.`
    case 'power.connection.stale-endpoint':
      return `Power connection ${String(connectionId)} references a missing endpoint.`
    case 'power.connection.invalid-direction':
      return `Power connection ${String(connectionId)} must run from an outlet to a different device's AC input.`
    case 'power.connection.duplicate-input':
      return `Power connection ${String(connectionId)} shares an AC input with another connection.`
    case 'power.connection.output-fan-out':
      return `Power connection ${String(connectionId)} shares an outlet that does not allow fan-out.`
    case 'power.connection.misclassified':
      return `Connection ${String(connectionId)} uses a power endpoint but is classified as ${connection?.type ?? 'other'}.`
  }
}

export async function getTopologyEndpoints(
  client: DomainEngineClient,
): Promise<RuntimeTopologyEndpointDescriptor[]> {
  const response = await client.queryConsistent({
    operation: { kind: 'topology-endpoints' },
  })

  if (response.result.kind === 'topology-endpoints') {
    return response.result.payload.endpoints.map(runtimeDescriptor)
  }

  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Topology endpoints could not be loaded.',
  )
}

export async function getCompatibleTopologyDestinations(
  client: DomainEngineClient,
  project: ProjectState,
  source: ConnectionEndpoint,
): Promise<RuntimeTopologyEndpointDescriptor[]> {
  const response = await client.queryConsistent({
    operation: {
      kind: 'compatible-destinations',
      payload: { source: toTopologyEndpointRef(project, source) },
    },
  })

  if (response.result.kind === 'topology-endpoints') {
    return response.result.payload.endpoints.map(runtimeDescriptor)
  }

  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Compatible connection endpoints could not be loaded.',
  )
}

export async function validateTopologyConnection(
  client: DomainEngineClient,
  project: ProjectState,
  first: ConnectionEndpoint,
  second: ConnectionEndpoint,
): Promise<RuntimeConnectionValidation> {
  const response = await client.queryConsistent({
    operation: {
      kind: 'validate-connection',
      payload: {
        from: toTopologyEndpointRef(project, first),
        to: toTopologyEndpointRef(project, second),
      },
    },
  })

  if (response.result.kind === 'connection-validation') {
    return response.result.payload
  }

  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Connection endpoints could not be validated.',
  )
}

export async function traceTopologyNetworkPath(
  client: DomainEngineClient,
  project: ProjectState,
  start: ConnectionEndpoint,
): Promise<RuntimeNetworkTrace | null> {
  const response = await client.queryConsistent({
    operation: {
      kind: 'trace-network-path',
      payload: { start: toTopologyEndpointRef(project, start) },
    },
  })

  if (response.result.kind === 'network-trace') {
    return response.result.payload.trace === null
      ? null
      : runtimeNetworkTrace(response.result.payload.trace)
  }

  throw new Error(
    response.result.kind === 'error'
      ? response.result.payload.message
      : 'Network path could not be traced.',
  )
}

export async function getPowerTopology(
  client: DomainEngineClient,
  project: ProjectState,
): Promise<RuntimePowerTopology> {
  const response = await client.queryConsistent({
    operation: { kind: 'power-topology' },
  })

  if (response.result.kind !== 'power-topology') {
    throw new Error(
      response.result.kind === 'error'
        ? response.result.payload.message
        : 'Power topology could not be loaded.',
    )
  }

  return {
    endpoints: response.result.payload.topology.endpoints.map((descriptor) => {
      if (!descriptor.power) {
        throw new Error('Power topology returned an endpoint without power metadata.')
      }
      return {
        endpoint: fromTopologyEndpointRef(descriptor.endpoint),
        direction: descriptor.power.direction as RuntimePowerEndpoint['direction'],
        kind: descriptor.power.kind as RuntimePowerEndpoint['kind'],
        label: powerEndpointLabel(project, descriptor),
        allowFanOut: descriptor.power.allow_fan_out,
      }
    }),
    findings: response.result.payload.topology.findings.map((finding) => {
      const itemId = finding.item === null ? undefined : runtimeKey(finding.item)
      const connectionId = finding.connection_id ?? undefined
      return {
        id: finding.id,
        code: finding.code,
        severity: finding.severity,
        message: powerFindingMessage(project, finding.code, itemId, connectionId),
        ...(itemId === undefined ? {} : { itemId }),
        ...(connectionId === undefined ? {} : { connectionId }),
        ...(finding.endpoint === null
          ? {}
          : { endpoint: fromTopologyEndpointRef(finding.endpoint) }),
      }
    }),
  }
}

function topologyConnectionRoute(
  route: ConnectionRoutePreferences,
): TopologyConnectionRoute | null {
  const result: TopologyConnectionRoute = {
    source_side: route.sourceSide ?? null,
    target_side: route.targetSide ?? null,
    bend_points: route.bendPoints ?? [],
    avoid_cable_overlap: route.avoidCableOverlap === true,
  }
  return result.source_side === null
    && result.target_side === null
    && result.bend_points.length === 0
    && !result.avoid_cable_overlap
    ? null
    : result
}

export function createTopologyConnection(
  client: DomainEngineClient,
  project: ProjectState,
  first: ConnectionEndpoint,
  second: ConnectionEndpoint,
) {
  return client.mutate({
    operation: {
      kind: 'create-connection',
      payload: {
        from: toTopologyEndpointRef(project, first),
        to: toTopologyEndpointRef(project, second),
        created_at: new Date().toISOString(),
      },
    },
  })
}

export function removeTopologyConnection(client: DomainEngineClient, connectionId: number) {
  return client.mutate({
    operation: {
      kind: 'remove-connection',
      payload: { connection_id: connectionId },
    },
  })
}

export function updateTopologyConnectionLabel(
  client: DomainEngineClient,
  connectionId: number,
  label: string,
) {
  return client.mutate({
    operation: {
      kind: 'update-connection-label',
      payload: {
        connection_id: connectionId,
        label: label.trim() === '' ? null : label,
      },
    },
  })
}

export function updateTopologyConnectionRoute(
  client: DomainEngineClient,
  connectionId: number,
  route: ConnectionRoutePreferences,
) {
  return client.mutate({
    operation: {
      kind: 'update-connection-route',
      payload: {
        connection_id: connectionId,
        route: topologyConnectionRoute(route),
      },
    },
  })
}
