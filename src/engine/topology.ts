import type {
  TopologyEndpointDescriptor,
  TopologyEndpointRef,
  TopologyItemRef,
} from '../../shared/engine/protocol.mjs'
import type { DomainEngineClient } from '@/engine/client'
import { parseItemKey } from '@/lib/item-keys'
import type { ConnectionEndpoint, ProjectState } from '@/types/inventory'

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
