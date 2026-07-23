import { getProjectAuditWarnings } from '@/lib/audit'
import type { RuntimePowerEndpoint } from '@/engine/topology'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import type {
  ComponentAssignment,
  ConnectionEndpoint,
  ProjectState,
} from '@/types/inventory'

export type CanvasProjectIndex = {
  assignmentsByHostId: ReadonlyMap<string, readonly ComponentAssignment[]>
  assignedHostByItemId: ReadonlyMap<string, string>
  auditWarningCountByItemId: ReadonlyMap<string, number>
  availableEndpointKeys: ReadonlySet<string>
  compatibleEndpointKeys: ReadonlySet<string> | null
  connectedEndpointKeys: ReadonlySet<string>
  powerEndpointByKey: ReadonlyMap<string, RuntimePowerEndpoint>
}

export function buildCanvasProjectIndex(
  project: ProjectState,
  topology: TopologyQueryData | null = null,
  compatibleEndpointKeys: ReadonlySet<string> | null = null,
): CanvasProjectIndex {
  const assignmentsByHostId = new Map<string, ComponentAssignment[]>()
  const assignedHostByItemId = new Map<string, string>()
  const auditWarningCountByItemId = new Map<string, number>()
  const availableEndpointKeys = new Set(
    topology?.endpoints
      .filter((descriptor) => descriptor.available)
      .map((descriptor) => endpointKey(descriptor.endpoint)) ?? [],
  )
  const connectedEndpointKeys = new Set<string>()
  const powerEndpointByKey = new Map<string, RuntimePowerEndpoint>()

  const auditTopology = topology ? {
    endpoints: topology.endpoints,
    networkTraces: topology.networkTraces,
    powerEndpoints: topology.power.endpoints,
    powerFindings: topology.power.findings,
  } : undefined
  for (const group of getProjectAuditWarnings(project, {}, auditTopology)) {
    auditWarningCountByItemId.set(runtimeItemKey(group.item), group.warnings.length)
  }

  for (const connection of project.connections ?? []) {
    connectedEndpointKeys.add(endpointKey(connection.from))
    connectedEndpointKeys.add(endpointKey(connection.to))
  }

  for (const assignment of project.assignments) {
    assignmentsByHostId.set(assignment.serverId, [
      ...(assignmentsByHostId.get(assignment.serverId) ?? []),
      assignment,
    ])
    assignedHostByItemId.set(assignment.itemId, assignment.serverId)

  }

  for (const powerEndpoint of topology?.power.endpoints ?? []) {
    const key = endpointKey(powerEndpoint.endpoint)
    powerEndpointByKey.set(key, powerEndpoint)

  }

  return {
    assignmentsByHostId,
    assignedHostByItemId,
    auditWarningCountByItemId,
    availableEndpointKeys,
    compatibleEndpointKeys,
    connectedEndpointKeys,
    powerEndpointByKey,
  }
}

export function canvasEndpointConnected(
  index: CanvasProjectIndex,
  endpoint: ConnectionEndpoint,
): boolean {
  return index.connectedEndpointKeys.has(endpointKey(endpoint))
}

export function canvasEndpointAvailable(
  index: CanvasProjectIndex,
  endpoint: ConnectionEndpoint,
): boolean {
  return index.availableEndpointKeys.has(endpointKey(endpoint))
}

export function canvasEndpointsCompatible(
  index: CanvasProjectIndex,
  source: ConnectionEndpoint | null,
  target: ConnectionEndpoint,
): boolean {
  if (!source || endpointKey(source) === endpointKey(target)) {
    return true
  }

  return index.compatibleEndpointKeys?.has(endpointKey(target)) ?? false
}

export function canvasAuditWarningCount(index: CanvasProjectIndex, itemId: string): number {
  return index.auditWarningCountByItemId.get(itemId) ?? 0
}
