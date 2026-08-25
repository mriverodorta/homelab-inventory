import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { inventoryItems, inventoryPorts } from './inventory-base.ts'
import { projects } from './project-base.ts'
import { portEndpointFaces } from './ports.ts'
import { workspaces } from './projects.ts'
import { hostResourceSlots } from './resources.ts'

export const componentAssignments = sqliteTable('component_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull(),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }),
  componentItemId: integer('component_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }),
  resourceSlotId: integer('resource_slot_id'),
  assignedAtMs: integer('assigned_at_ms').notNull(),
}, (table) => [
  uniqueIndex('component_assignments_project_component_unique').on(table.projectId, table.workspaceId, table.componentItemId),
  uniqueIndex('component_assignments_project_id_unique').on(table.projectId, table.id),
  uniqueIndex('component_assignments_workspace_id_unique').on(table.projectId, table.workspaceId, table.id),
  uniqueIndex('component_assignments_project_slot_unique')
    .on(table.projectId, table.workspaceId, table.resourceSlotId)
    .where(sql`${table.resourceSlotId} IS NOT NULL`),
  index('component_assignments_host_index').on(table.projectId, table.workspaceId, table.hostItemId),
  foreignKey({
    name: 'component_assignments_workspace_fk',
    columns: [table.projectId, table.workspaceId],
    foreignColumns: [workspaces.projectId, workspaces.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'component_assignments_host_slot_fk',
    columns: [table.hostItemId, table.resourceSlotId],
    foreignColumns: [hostResourceSlots.hostItemId, hostResourceSlots.id],
  }).onDelete('restrict'),
  check('component_assignments_distinct_items_check', sql`${table.hostItemId} <> ${table.componentItemId}`),
])

export const componentAssignmentSlots = sqliteTable('component_assignment_slots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull(),
  workspaceId: integer('workspace_id').notNull(),
  assignmentId: integer('assignment_id').notNull(),
  hostItemId: integer('host_item_id').notNull(),
  resourceSlotId: integer('resource_slot_id').notNull(),
  position: integer('position').notNull(),
}, (table) => [
  uniqueIndex('component_assignment_slots_assignment_position_unique').on(table.assignmentId, table.position),
  uniqueIndex('component_assignment_slots_assignment_slot_unique').on(table.assignmentId, table.resourceSlotId),
  uniqueIndex('component_assignment_slots_project_slot_unique').on(table.projectId, table.workspaceId, table.resourceSlotId),
  foreignKey({
    name: 'component_assignment_slots_assignment_fk',
    columns: [table.projectId, table.workspaceId, table.assignmentId],
    foreignColumns: [componentAssignments.projectId, componentAssignments.workspaceId, componentAssignments.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'component_assignment_slots_host_slot_fk',
    columns: [table.hostItemId, table.resourceSlotId],
    foreignColumns: [hostResourceSlots.hostItemId, hostResourceSlots.id],
  }).onDelete('restrict'),
  check('component_assignment_slots_position_check', sql`${table.position} >= 0`),
])

export const projectConnections = sqliteTable('project_connections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull(),
  connectionType: text('connection_type').notNull(),
  negotiatedSpeedBps: integer('negotiated_speed_bps'),
  label: text('label'),
  sourceSide: text('source_side').notNull(),
  targetSide: text('target_side').notNull(),
  avoidCableOverlap: integer('avoid_cable_overlap', { mode: 'boolean' }).notNull().default(false),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms'),
}, (table) => [
  uniqueIndex('project_connections_project_id_unique').on(table.projectId, table.id),
  uniqueIndex('project_connections_workspace_id_unique').on(table.projectId, table.workspaceId, table.id),
  index('project_connections_project_type_index').on(table.projectId, table.workspaceId, table.connectionType),
  foreignKey({
    name: 'project_connections_workspace_fk',
    columns: [table.projectId, table.workspaceId],
    foreignColumns: [workspaces.projectId, workspaces.id],
  }).onDelete('cascade'),
  check('project_connections_type_check', sql`${table.connectionType} IN ('network', 'display', 'power', 'other')`),
  check('project_connections_speed_check', sql`${table.negotiatedSpeedBps} IS NULL OR ${table.negotiatedSpeedBps} >= 0`),
  check('project_connections_source_side_check', sql`${table.sourceSide} IN ('left', 'right', 'top', 'bottom')`),
  check('project_connections_target_side_check', sql`${table.targetSide} IN ('left', 'right', 'top', 'bottom')`),
  check('project_connections_overlap_check', sql`${table.avoidCableOverlap} IN (0, 1)`),
])

export const connectionEndpoints = sqliteTable('connection_endpoints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id').notNull(),
  connectionId: integer('connection_id').notNull().references(() => projectConnections.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  portId: integer('port_id').notNull().references(() => inventoryPorts.id, { onDelete: 'restrict' }),
  endpointFaceId: integer('endpoint_face_id'),
}, (table) => [
  uniqueIndex('connection_endpoints_connection_role_unique').on(table.connectionId, table.role),
  uniqueIndex('connection_endpoints_port_face_unique').on(
    table.workspaceId,
    table.portId,
    sql`coalesce(${table.endpointFaceId}, 0)`,
  ),
  index('connection_endpoints_connection_index').on(table.connectionId),
  foreignKey({
    name: 'connection_endpoints_face_fk',
    columns: [table.portId, table.endpointFaceId],
    foreignColumns: [portEndpointFaces.portId, portEndpointFaces.id],
  }).onDelete('restrict'),
  check('connection_endpoints_role_check', sql`${table.role} IN ('source', 'target')`),
])
