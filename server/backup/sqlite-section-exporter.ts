import type { Database } from 'bun:sqlite'
import type { ProjectState } from '../../src/types/inventory.ts'

type Row = Record<string, any>

const PROJECT_WORKBOOK_TABLES = [
  'projects',
  'workspaces',
  'canvas_workspaces',
  'project_preferences',
  'project_compatibility_policies',
  'project_inventory_memberships',
  'project_inventory_overrides',
  'workspace_placements',
  'workspace_connection_visibility',
  'workspace_manual_bend_points',
  'component_assignments',
  'component_assignment_slots',
  'project_connections',
  'connection_endpoints',
  'compatibility_audits',
  'compatibility_audit_findings',
  'compatibility_audit_ignores',
] as const

const INVENTORY_METADATA_TABLES = [
  'custom_field_definitions',
  'custom_field_applicability',
  'custom_field_options',
  'inventory_custom_field_values',
  'inventory_custom_field_option_values',
  'inventory_tags',
  'inventory_item_tags',
] as const

function tableRows(database: Database, table: string) {
  return database.query(`SELECT * FROM ${table} ORDER BY 1`).all() as Row[]
}

export function logicalProjectWorkbooks(database: Database) {
  return {
    contractVersion: 1,
    tables: Object.fromEntries(PROJECT_WORKBOOK_TABLES.map((table) => [table, tableRows(database, table)])),
    identities: {
      items: database.query(`
        SELECT i.id AS canonical_id, a.legacy_type_key AS item_type, a.legacy_id AS item_id,
               i.scope, i.owner_project_id
        FROM inventory_items i
        JOIN inventory_identity_aliases a ON a.item_id = i.id
        ORDER BY i.id
      `).all(),
      ports: database.query(`
        SELECT p.id AS canonical_id, a.legacy_type_key AS item_type,
               a.legacy_id AS item_id, pa.legacy_port_id AS port_id
        FROM inventory_ports p
        JOIN inventory_identity_aliases a ON a.item_id = p.item_id
        JOIN port_identity_aliases pa ON pa.port_id = p.id
        ORDER BY p.id
      `).all(),
      endpointFaces: database.query(`
        SELECT f.id AS canonical_id, a.legacy_type_key AS item_type,
               a.legacy_id AS item_id, pa.legacy_port_id AS port_id,
               f.endpoint_number
        FROM port_endpoint_faces f
        JOIN inventory_ports p ON p.id = f.port_id
        JOIN inventory_identity_aliases a ON a.item_id = p.item_id
        JOIN port_identity_aliases pa ON pa.port_id = p.id
        ORDER BY f.id
      `).all(),
      resourceSlots: database.query(`
        SELECT s.id AS canonical_id, a.legacy_type_key AS item_type,
               a.legacy_id AS item_id, ra.legacy_resource_key,
               s.position
        FROM host_resource_slots s
        JOIN host_resource_groups g ON g.id = s.resource_group_id
        JOIN inventory_identity_aliases a ON a.item_id = g.host_item_id
        JOIN resource_identity_aliases ra ON ra.resource_id = g.resource_identity_id
        ORDER BY s.id
      `).all(),
    },
  }
}

export function logicalWorkspaceRouteCache(database: Database) {
  return {
    contractVersion: 1,
    rows: tableRows(database, 'workspace_route_cache'),
  }
}

export function logicalInventoryMetadata(database: Database) {
  return {
    contractVersion: 1,
    tables: Object.fromEntries(INVENTORY_METADATA_TABLES.map((table) => [table, tableRows(database, table)])),
    identities: {
      items: database.query(`
        SELECT item.id AS canonical_id, alias.legacy_type_key AS item_type,
               alias.legacy_id AS item_id
        FROM inventory_items item
        JOIN inventory_identity_aliases alias ON alias.item_id = item.id
        ORDER BY item.id
      `).all(),
    },
  }
}

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
  database: Database
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
    inventory: {
      ...structuredClone(input.inventory),
      metadata: logicalInventoryMetadata(input.database),
    },
    project: {
      ...logicalProjectSection(input.project),
      workbooks: logicalProjectWorkbooks(input.database),
    },
    routingCache: {
      ...structuredClone(input.routingCache),
      workspaces: logicalWorkspaceRouteCache(input.database),
    },
    registry: structuredClone(input.registry),
    agents: structuredClone(input.agents),
    agentStatus: structuredClone(input.agentStatus),
    authentication: structuredClone(input.authentication),
    backupManagement: structuredClone(input.backupManagement),
  }
}
