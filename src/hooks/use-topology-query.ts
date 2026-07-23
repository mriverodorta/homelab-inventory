import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getPowerTopology,
  getConnectionDerivedStates,
  getCompatibleTopologyDestinations,
  getTopologyEndpoints,
  getTopologyNetworkTraces,
  type RuntimeNetworkTrace,
  type RuntimePowerTopology,
  type RuntimeTopologyEndpointDescriptor,
} from '@/engine/topology'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import { endpointKey, getConnectionPort } from '@/lib/project'
import { formatPortRole } from '@/lib/format'
import type { ConnectionEndpoint, InventoryPort, ProjectState } from '@/types/inventory'

export type PresentedNetworkTraceStep = RuntimeNetworkTrace['steps'][number] & {
  label: string
}

export type PresentedNetworkTrace = Omit<RuntimeNetworkTrace, 'steps'> & {
  steps: PresentedNetworkTraceStep[]
}

export type TopologyQueryData = {
  revision: number
  endpoints: RuntimeTopologyEndpointDescriptor[]
  connectionDerivedById: ReadonlyMap<number, {
    connectionType: string
    negotiatedSpeedMbps: number | null
  }>
  power: RuntimePowerTopology
  networkTraces: PresentedNetworkTrace[]
  networkTraceByEndpointKey: ReadonlyMap<string, PresentedNetworkTrace>
  networkTracesByItemId: ReadonlyMap<string, readonly PresentedNetworkTrace[]>
}

function portTypeLabel(type: InventoryPort['type']): string {
  if (type === 'sfp-plus') return 'SFP+'
  if (type === 'displayport') return 'DP'
  if (type === 'mini-displayport') return 'MiniDP'
  return type.toUpperCase()
}

function endpointSide(project: ProjectState, endpoint: ConnectionEndpoint): string | null {
  if (endpoint.endpointId === undefined) return null
  const owner = project.items[endpoint.hostedItemId ?? endpoint.itemId]
  const port = owner?.ports?.find((candidate) => candidate.id === endpoint.portId)
  return port?.endpoints?.find((candidate) => candidate.id === endpoint.endpointId)?.side ?? null
}

function describeNetworkEndpoint(project: ProjectState, endpoint: ConnectionEndpoint): string {
  const host = project.items[endpoint.itemId]
  const owner = endpoint.hostedItemId ? project.items[endpoint.hostedItemId] : host
  const port = getConnectionPort(project, endpoint)
  if (!host || !owner || !port) return 'Missing port'

  const slot = String(port.slotNumber).padStart(2, '0')
  const side = endpointSide(project, endpoint)
  const customLabel = port.label?.trim()
  const type = port.speed
    ? `${portTypeLabel(port.type)} ${port.speed}`
    : portTypeLabel(port.type)
  const portLabel = customLabel
    ? (side ? `${customLabel} ${side}` : customLabel)
    : side ? `${slot} ${side}` : slot
  const role = port.role ? ` / ${formatPortRole(port.role)}` : ''
  const ownerLabel = endpoint.hostedItemId ? `${host.name} / ${owner.name}` : host.name
  return `${ownerLabel} / ${portLabel} / ${type}${role}`
}

function presentTrace(project: ProjectState, trace: RuntimeNetworkTrace): PresentedNetworkTrace {
  return {
    ...trace,
    steps: trace.steps.map((step) => ({
      ...step,
      label: step.state === 'open'
        ? `${describeNetworkEndpoint(project, step.endpoint)} is open`
        : describeNetworkEndpoint(project, step.endpoint),
    })),
  }
}

export function useTopologyQuery(project: ProjectState | null) {
  const domainEngine = useDomainEngine()
  const revision = domainEngine.state.phase === 'ready'
    ? domainEngine.state.revision
    : null
  const query = useQuery({
    queryKey: ['domain-engine-topology', project?.id ?? null, revision],
    enabled: domainEngine.enabled && project !== null && revision !== null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      if (!project || revision === null) {
        throw new Error('Topology query requires a ready project revision.')
      }
      const [endpoints, networkTraces, power, connectionDerivedStates] = await Promise.all([
        getTopologyEndpoints(domainEngine.client),
        getTopologyNetworkTraces(domainEngine.client),
        getPowerTopology(domainEngine.client, project),
        getConnectionDerivedStates(domainEngine.client),
      ])
      return { revision, endpoints, networkTraces, power, connectionDerivedStates }
    },
  })

  const data = useMemo<TopologyQueryData | null>(() => {
    if (!project || !query.data) return null
    const networkTraces = query.data.networkTraces.map((trace) => presentTrace(project, trace))
    const networkTraceByEndpointKey = new Map<string, PresentedNetworkTrace>()
    const networkTracesByItemId = new Map<string, PresentedNetworkTrace[]>()
    const connectionDerivedById = new Map(
      query.data.connectionDerivedStates.map((state) => [state.connection_id, {
        connectionType: state.connection_type,
        negotiatedSpeedMbps: state.negotiated_speed_mbps,
      }]),
    )
    for (const trace of networkTraces) {
      networkTraceByEndpointKey.set(endpointKey(trace.start), trace)
      networkTracesByItemId.set(trace.start.itemId, [
        ...(networkTracesByItemId.get(trace.start.itemId) ?? []),
        trace,
      ])
    }
    return {
      revision: query.data.revision,
      endpoints: query.data.endpoints,
      connectionDerivedById,
      power: query.data.power,
      networkTraces,
      networkTraceByEndpointKey,
      networkTracesByItemId,
    }
  }, [project, query.data])

  return {
    ...query,
    data,
  }
}

export function useCompatibleTopologyDestinations(
  project: ProjectState | null,
  source: ConnectionEndpoint | null,
) {
  const domainEngine = useDomainEngine()
  const revision = domainEngine.state.phase === 'ready'
    ? domainEngine.state.revision
    : null
  const sourceKey = source ? endpointKey(source) : null
  const query = useQuery({
    queryKey: ['domain-engine-compatible-endpoints', project?.id ?? null, revision, sourceKey],
    enabled: domainEngine.enabled && project !== null && revision !== null && source !== null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      if (!project || !source) return []
      return getCompatibleTopologyDestinations(domainEngine.client, project, source)
    },
  })
  const endpointKeys = useMemo(
    () => query.data === undefined
      ? null
      : new Set(query.data.map((descriptor) => endpointKey(descriptor.endpoint))),
    [query.data],
  )
  return { ...query, endpointKeys }
}
