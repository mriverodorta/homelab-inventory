import { getProjectAuditWarnings } from '@/lib/audit'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey, portsCompatible } from '@/lib/project'
import { getPowerEndpoints, type PowerEndpoint } from '@/lib/power-topology'
import type {
  ComponentAssignment,
  ConnectionEndpoint,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

export type CanvasProjectIndex = {
  assignmentsByHostId: ReadonlyMap<string, readonly ComponentAssignment[]>
  assignedHostByItemId: ReadonlyMap<string, string>
  auditWarningCountByItemId: ReadonlyMap<string, number>
  connectedEndpointKeys: ReadonlySet<string>
  portByEndpointKey: ReadonlyMap<string, InventoryPort>
  powerEndpointByKey: ReadonlyMap<string, PowerEndpoint>
}

function indexPort(
  portByEndpointKey: Map<string, InventoryPort>,
  itemId: string,
  port: InventoryPort,
  hostedItemId?: string,
): void {
  if (port.endpoints?.length) {
    for (const endpoint of port.endpoints) {
      portByEndpointKey.set(endpointKey({
        itemId,
        hostedItemId,
        portId: port.id,
        endpointId: endpoint.id,
      }), port)
    }
    return
  }

  portByEndpointKey.set(endpointKey({ itemId, hostedItemId, portId: port.id }), port)
}

export function buildCanvasProjectIndex(project: ProjectState): CanvasProjectIndex {
  const assignmentsByHostId = new Map<string, ComponentAssignment[]>()
  const assignedHostByItemId = new Map<string, string>()
  const auditWarningCountByItemId = new Map<string, number>()
  const connectedEndpointKeys = new Set<string>()
  const portByEndpointKey = new Map<string, InventoryPort>()
  const powerEndpointByKey = new Map<string, PowerEndpoint>()

  for (const group of getProjectAuditWarnings(project)) {
    auditWarningCountByItemId.set(runtimeItemKey(group.item), group.warnings.length)
  }

  for (const connection of project.connections ?? []) {
    connectedEndpointKeys.add(endpointKey(connection.from))
    connectedEndpointKeys.add(endpointKey(connection.to))
  }

  for (const [itemId, item] of Object.entries(project.items)) {
    for (const port of item.ports ?? []) {
      indexPort(portByEndpointKey, itemId, port)
    }
  }

  for (const assignment of project.assignments) {
    assignmentsByHostId.set(assignment.serverId, [
      ...(assignmentsByHostId.get(assignment.serverId) ?? []),
      assignment,
    ])
    assignedHostByItemId.set(assignment.itemId, assignment.serverId)

    const item = project.items[assignment.itemId]
    for (const port of item?.ports ?? []) {
      indexPort(portByEndpointKey, assignment.serverId, port, assignment.itemId)
    }
  }

  for (const powerEndpoint of getPowerEndpoints(project)) {
    const key = endpointKey(powerEndpoint.endpoint)
    powerEndpointByKey.set(key, powerEndpoint)

    const ownerId = powerEndpoint.endpoint.hostedItemId ?? powerEndpoint.endpoint.itemId
    const port = project.items[ownerId]?.ports?.find(
      (candidate) => candidate.id === powerEndpoint.endpoint.portId,
    )
    if (port) portByEndpointKey.set(key, port)
  }

  return {
    assignmentsByHostId,
    assignedHostByItemId,
    auditWarningCountByItemId,
    connectedEndpointKeys,
    portByEndpointKey,
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
  const key = endpointKey(endpoint)
  return index.powerEndpointByKey.get(key)?.allowFanOut === true || !index.connectedEndpointKeys.has(key)
}

export function canvasEndpointsCompatible(
  index: CanvasProjectIndex,
  source: ConnectionEndpoint | null,
  target: ConnectionEndpoint,
): boolean {
  if (!source || endpointKey(source) === endpointKey(target)) {
    return true
  }

  const sourcePower = index.powerEndpointByKey.get(endpointKey(source))
  const targetPower = index.powerEndpointByKey.get(endpointKey(target))

  if (sourcePower || targetPower) {
    return Boolean(
      sourcePower &&
      targetPower &&
      sourcePower.direction !== targetPower.direction,
    )
  }

  const sourcePort = index.portByEndpointKey.get(endpointKey(source))
  const targetPort = index.portByEndpointKey.get(endpointKey(target))
  return Boolean(sourcePort && targetPort && portsCompatible(sourcePort.type, targetPort.type))
}

export function canvasAuditWarningCount(index: CanvasProjectIndex, itemId: string): number {
  return index.auditWarningCountByItemId.get(itemId) ?? 0
}
