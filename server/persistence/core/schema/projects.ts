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
import { inventoryItems } from './inventory-base.ts'
import { projects } from './project-base.ts'

export { projects } from './project-base.ts'

export const workspaces = sqliteTable('workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  iconKey: text('icon_key').notNull(),
  colorKey: text('color_key').notNull(),
  sortOrder: integer('sort_order').notNull(),
  revision: integer('revision').notNull().default(1),
  systemKey: text('system_key'),
  archivedAtMs: integer('archived_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('workspaces_project_id_id_unique').on(table.projectId, table.id),
  uniqueIndex('workspaces_project_sort_order_unique')
    .on(table.projectId, table.sortOrder)
    .where(sql`${table.archivedAtMs} IS NULL`),
  uniqueIndex('workspaces_project_system_unique')
    .on(table.projectId)
    .where(sql`${table.type} = 'systems'`),
  index('workspaces_project_id_index').on(table.projectId),
  check('workspaces_type_check', sql`${table.type} IN ('systems', 'canvas', 'rack', 'diagram', 'vlan')`),
  check('workspaces_name_check', sql`length(trim(${table.name})) > 0`),
  check('workspaces_sort_order_check', sql`${table.sortOrder} >= 0`),
  check('workspaces_revision_check', sql`${table.revision} > 0`),
  check('workspaces_system_shape_check', sql`
    (${table.type} <> 'systems') OR (
      ${table.name} = 'Systems'
      AND ${table.iconKey} = 'server'
      AND ${table.colorKey} = 'neutral'
      AND ${table.sortOrder} = 0
      AND ${table.systemKey} = 'systems'
      AND ${table.archivedAtMs} IS NULL
    )
  `),
  check('workspaces_non_system_key_check', sql`
    (${table.type} = 'systems') OR ${table.systemKey} IS NULL
  `),
])

export const canvasWorkspaces = sqliteTable('canvas_workspaces', {
  id: integer('id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  viewportX: integer('viewport_x').notNull().default(0),
  viewportY: integer('viewport_y').notNull().default(0),
  viewportZoomBasisPoints: integer('viewport_zoom_basis_points').notNull().default(10000),
  settingsJson: text('settings_json').notNull().default('{}'),
}, (table) => [
  check('canvas_workspaces_zoom_check', sql`${table.viewportZoomBasisPoints} > 0`),
  check('canvas_workspaces_settings_json_check', sql`json_valid(${table.settingsJson})`),
])

export const projectPreferences = sqliteTable('project_preferences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  defaultWorkspaceId: integer('default_workspace_id').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('project_preferences_project_unique').on(table.projectId),
  index('project_preferences_default_workspace_index').on(table.defaultWorkspaceId),
  foreignKey({
    name: 'project_preferences_workspace_fk',
    columns: [table.projectId, table.defaultWorkspaceId],
    foreignColumns: [workspaces.projectId, workspaces.id],
  }).onDelete('cascade'),
])

export const projectInventoryMemberships = sqliteTable('project_inventory_memberships', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('project_inventory_memberships_unique').on(table.projectId, table.itemId),
  index('project_inventory_memberships_item_index').on(table.itemId),
])

export const projectInventoryOverrides = sqliteTable('project_inventory_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  notes: text('notes'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('project_inventory_overrides_unique').on(table.projectId, table.itemId),
  index('project_inventory_overrides_item_index').on(table.itemId),
  check('project_inventory_overrides_content_check', sql`
    ${table.displayName} IS NOT NULL OR ${table.notes} IS NOT NULL
  `),
])
