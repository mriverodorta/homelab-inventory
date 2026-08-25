import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { inventoryItems } from './inventory-base.ts'
import { projects } from './project-base.ts'
import { workspaces } from './projects.ts'
import { projectConnections } from './topology.ts'

export const workspacePlacements = sqliteTable('workspace_placements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull(),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  x: real('x').notNull(),
  y: real('y').notNull(),
  orientation: text('orientation'),
  zIndex: integer('z_index').notNull().default(0),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('workspace_placements_workspace_item_unique').on(table.workspaceId, table.itemId),
  index('workspace_placements_item_index').on(table.itemId),
  foreignKey({
    name: 'workspace_placements_workspace_fk',
    columns: [table.projectId, table.workspaceId],
    foreignColumns: [workspaces.projectId, workspaces.id],
  }).onDelete('cascade'),
  check('workspace_placements_coordinate_check', sql`
    abs(${table.x}) <= 1000000000 AND abs(${table.y}) <= 1000000000
  `),
])

export const workspaceConnectionVisibility = sqliteTable('workspace_connection_visibility', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull(),
  connectionId: integer('connection_id').notNull(),
  visible: integer('visible', { mode: 'boolean' }).notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('workspace_connection_visibility_unique').on(table.workspaceId, table.connectionId),
  foreignKey({
    name: 'workspace_connection_visibility_workspace_fk',
    columns: [table.projectId, table.workspaceId],
    foreignColumns: [workspaces.projectId, workspaces.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'workspace_connection_visibility_connection_fk',
    columns: [table.projectId, table.workspaceId, table.connectionId],
    foreignColumns: [projectConnections.projectId, projectConnections.workspaceId, projectConnections.id],
  }).onDelete('cascade'),
  check('workspace_connection_visibility_visible_check', sql`${table.visible} IN (0, 1)`),
])

export const workspaceManualBendPoints = sqliteTable('workspace_manual_bend_points', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull(),
  connectionId: integer('connection_id').notNull(),
  position: integer('position').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
}, (table) => [
  uniqueIndex('workspace_manual_bend_points_position_unique').on(
    table.workspaceId,
    table.connectionId,
    table.position,
  ),
  foreignKey({
    name: 'workspace_manual_bend_points_workspace_fk',
    columns: [table.projectId, table.workspaceId],
    foreignColumns: [workspaces.projectId, workspaces.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'workspace_manual_bend_points_connection_fk',
    columns: [table.projectId, table.workspaceId, table.connectionId],
    foreignColumns: [projectConnections.projectId, projectConnections.workspaceId, projectConnections.id],
  }).onDelete('cascade'),
  check('workspace_manual_bend_points_position_check', sql`${table.position} >= 0`),
])

export const workspaceRouteCache = sqliteTable('workspace_route_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull(),
  connectionId: integer('connection_id').notNull(),
  engineVersion: text('engine_version').notNull(),
  layoutFingerprint: text('layout_fingerprint').notNull(),
  routeFingerprint: text('route_fingerprint').notNull(),
  routePayloadJson: text('route_payload_json').notNull(),
  calculatedAtMs: integer('calculated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('workspace_route_cache_workspace_connection_unique').on(table.workspaceId, table.connectionId),
  index('workspace_route_cache_layout_index').on(table.workspaceId, table.layoutFingerprint),
  foreignKey({
    name: 'workspace_route_cache_workspace_fk',
    columns: [table.projectId, table.workspaceId],
    foreignColumns: [workspaces.projectId, workspaces.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'workspace_route_cache_connection_fk',
    columns: [table.projectId, table.workspaceId, table.connectionId],
    foreignColumns: [projectConnections.projectId, projectConnections.workspaceId, projectConnections.id],
  }).onDelete('cascade'),
  check('workspace_route_cache_payload_check', sql`json_valid(${table.routePayloadJson})`),
])
