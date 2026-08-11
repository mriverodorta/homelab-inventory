import type { ProjectState } from '../../src/types/inventory.ts'

type Row = Record<string, any>

function parseItemKey(value: string) {
  const separator = value.lastIndexOf(':')
  return { type: value.slice(0, separator), id: Number(value.slice(separator + 1)) }
}

function persistedEndpoint(endpoint: Row) {
  const item = parseItemKey(endpoint.itemId)
  const hosted = endpoint.hostedItemId ? parseItemKey(endpoint.hostedItemId) : null
  return {
    itemType: item.type,
    itemId: item.id,
    portId: endpoint.portId,
    ...(endpoint.endpointId === undefined ? {} : { endpointId: endpoint.endpointId }),
    ...(hosted ? { hostedItemType: hosted.type, hostedItemId: hosted.id } : {}),
  }
}

export function logicalProjectSection(project: ProjectState) {
  return {
    id: project.id,
    revision: project.revision,
    metadata: structuredClone(project.metadata),
    placements: project.placements.map((placement: Row) => {
      const item = parseItemKey(placement.serverId)
      return { itemType: item.type, itemId: item.id, x: placement.x, y: placement.y }
    }),
    assignments: project.assignments.map((assignment: Row) => {
      const host = parseItemKey(assignment.serverId)
      const item = parseItemKey(assignment.itemId)
      return {
        id: assignment.id,
        hostType: host.type,
        hostId: host.id,
        itemType: item.type,
        itemId: item.id,
        type: assignment.type,
        assignedAt: assignment.assignedAt,
        ...(assignment.allocation ? { allocation: structuredClone(assignment.allocation) } : {}),
      }
    }),
    connections: project.connections.map((connection: Row) => ({
      ...structuredClone(connection),
      from: persistedEndpoint(connection.from),
      to: persistedEndpoint(connection.to),
    })),
    compatibilityPolicy: structuredClone(project.compatibilityPolicy),
  }
}

export function runtimeProjectFromLogical(section: Row, items: ProjectState['items']): ProjectState {
  return {
    id: section.id ?? 'default',
    revision: section.revision,
    metadata: structuredClone(section.metadata),
    items: structuredClone(items),
    placements: (section.placements ?? []).map((placement: Row) => ({
      serverId: `${placement.itemType}:${placement.itemId}`,
      x: placement.x,
      y: placement.y,
    })),
    assignments: (section.assignments ?? []).map((assignment: Row) => ({
      id: assignment.id,
      serverId: `${assignment.hostType}:${assignment.hostId}`,
      itemId: `${assignment.itemType}:${assignment.itemId}`,
      type: assignment.type,
      assignedAt: assignment.assignedAt,
      ...(assignment.allocation ? { allocation: structuredClone(assignment.allocation) } : {}),
    })),
    connections: (section.connections ?? []).map((connection: Row) => ({
      ...structuredClone(connection),
      from: {
        itemId: `${connection.from.itemType}:${connection.from.itemId}`,
        portId: connection.from.portId,
        ...(connection.from.endpointId === undefined ? {} : { endpointId: connection.from.endpointId }),
        ...(connection.from.hostedItemType ? {
          hostedItemId: `${connection.from.hostedItemType}:${connection.from.hostedItemId}`,
        } : {}),
      },
      to: {
        itemId: `${connection.to.itemType}:${connection.to.itemId}`,
        portId: connection.to.portId,
        ...(connection.to.endpointId === undefined ? {} : { endpointId: connection.to.endpointId }),
        ...(connection.to.hostedItemType ? {
          hostedItemId: `${connection.to.hostedItemType}:${connection.to.hostedItemId}`,
        } : {}),
      },
    })),
    compatibilityPolicy: structuredClone(section.compatibilityPolicy),
  }
}

export function buildLogicalStoreSnapshot(input: {
  meta: Row
  inventory: Row
  project: ProjectState
  routingCache: Row
  registry: Row
  agents: Row
  agentStatus: Row
  authentication: Row
  backupManagement: Row
}) {
  return {
    meta: structuredClone(input.meta),
    inventory: structuredClone(input.inventory),
    project: logicalProjectSection(input.project),
    routingCache: structuredClone(input.routingCache),
    registry: structuredClone(input.registry),
    agents: structuredClone(input.agents),
    agentStatus: structuredClone(input.agentStatus),
    authentication: structuredClone(input.authentication),
    backupManagement: structuredClone(input.backupManagement),
  }
}
