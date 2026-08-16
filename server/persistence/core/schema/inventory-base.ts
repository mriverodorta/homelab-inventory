import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { projects } from './project-base.ts'

export const inventoryItemTypes = sqliteTable('inventory_item_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull(),
}, (table) => [
  uniqueIndex('inventory_item_types_key_unique').on(table.key),
  uniqueIndex('inventory_item_types_sort_order_unique').on(table.sortOrder),
])

export const manufacturers = sqliteTable('manufacturers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('manufacturers_normalized_name_unique').on(table.normalizedName),
  check('manufacturers_name_check', sql`length(trim(${table.name})) > 0`),
  check('manufacturers_normalized_name_check', sql`
    ${table.normalizedName} = lower(trim(${table.normalizedName}))
    AND length(${table.normalizedName}) > 0
  `),
])

export const manufacturerAliases = sqliteTable('manufacturer_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  manufacturerId: integer('manufacturer_id').notNull().references(() => manufacturers.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  normalizedAlias: text('normalized_alias').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('manufacturer_aliases_normalized_unique').on(table.normalizedAlias),
  index('manufacturer_aliases_manufacturer_index').on(table.manufacturerId),
  check('manufacturer_aliases_normalized_check', sql`
    ${table.normalizedAlias} = lower(trim(${table.normalizedAlias}))
    AND length(${table.normalizedAlias}) > 0
  `),
])

export const inventoryItems = sqliteTable('inventory_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  typeId: integer('type_id').notNull().references(() => inventoryItemTypes.id, { onDelete: 'restrict' }),
  scope: text('scope').notNull(),
  ownerProjectId: integer('owner_project_id').references(() => projects.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  manufacturerId: integer('manufacturer_id').references(() => manufacturers.id, { onDelete: 'restrict' }),
  manufacturerText: text('manufacturer_text'),
  model: text('model'),
  family: text('family'),
  productNumber: text('product_number'),
  subtype: text('subtype'),
  serialNumber: text('serial_number'),
  notes: text('notes'),
  extensionsJson: text('extensions_json').notNull().default('{}'),
  rowVersion: integer('row_version').notNull().default(1),
  archivedAtMs: integer('archived_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  index('inventory_items_type_index').on(table.typeId),
  index('inventory_items_owner_project_index').on(table.ownerProjectId),
  index('inventory_items_manufacturer_index').on(table.manufacturerId),
  index('inventory_items_archived_index').on(table.archivedAtMs),
  check('inventory_items_scope_check', sql`${table.scope} IN ('global', 'project')`),
  check('inventory_items_scope_owner_check', sql`
    (${table.scope} = 'global' AND ${table.ownerProjectId} IS NULL)
    OR (${table.scope} = 'project' AND ${table.ownerProjectId} IS NOT NULL)
  `),
  check('inventory_items_name_check', sql`length(trim(${table.name})) > 0`),
  check('inventory_items_row_version_check', sql`${table.rowVersion} > 0`),
  check('inventory_items_extensions_json_check', sql`json_valid(${table.extensionsJson})`),
])

export const inventoryIdentityAliases = sqliteTable('inventory_identity_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }),
  legacyTypeKey: text('legacy_type_key').notNull(),
  legacyId: integer('legacy_id').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_identity_aliases_legacy_unique').on(table.legacyTypeKey, table.legacyId),
  uniqueIndex('inventory_identity_aliases_item_unique').on(table.itemId),
  check('inventory_identity_aliases_legacy_id_check', sql`${table.legacyId} > 0`),
])

export const inventoryCompatibilityAliases = sqliteTable('inventory_compatibility_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  legacyTypeKey: text('legacy_type_key').notNull(),
  legacyId: integer('legacy_id').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_compatibility_aliases_legacy_unique').on(table.legacyTypeKey, table.legacyId),
  index('inventory_compatibility_aliases_item_index').on(table.itemId),
  check('inventory_compatibility_aliases_legacy_id_check', sql`${table.legacyId} > 0`),
])

export const inventoryPorts = sqliteTable('inventory_ports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  index('inventory_ports_item_index').on(table.itemId),
])

export const portIdentityAliases = sqliteTable('port_identity_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  portId: integer('port_id').notNull().references(() => inventoryPorts.id, { onDelete: 'restrict' }),
  legacyItemTypeKey: text('legacy_item_type_key').notNull(),
  legacyItemId: integer('legacy_item_id').notNull(),
  legacyPortId: integer('legacy_port_id').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('port_identity_aliases_legacy_unique').on(
    table.legacyItemTypeKey,
    table.legacyItemId,
    table.legacyPortId,
  ),
  uniqueIndex('port_identity_aliases_port_unique').on(table.portId),
  check('port_identity_aliases_ids_check', sql`${table.legacyItemId} > 0 AND ${table.legacyPortId} > 0`),
])

export const portCompatibilityAliases = sqliteTable('port_compatibility_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  portId: integer('port_id').notNull().references(() => inventoryPorts.id, { onDelete: 'cascade' }),
  legacyItemTypeKey: text('legacy_item_type_key').notNull(),
  legacyItemId: integer('legacy_item_id').notNull(),
  legacyPortId: integer('legacy_port_id').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('port_compatibility_aliases_legacy_unique').on(
    table.legacyItemTypeKey,
    table.legacyItemId,
    table.legacyPortId,
  ),
  index('port_compatibility_aliases_port_index').on(table.portId),
  check('port_compatibility_aliases_item_id_check', sql`${table.legacyItemId} > 0`),
  check('port_compatibility_aliases_port_id_check', sql`${table.legacyPortId} > 0`),
])

export const inventoryResources = sqliteTable('inventory_resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  index('inventory_resources_item_index').on(table.itemId),
])

export const resourceIdentityAliases = sqliteTable('resource_identity_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceId: integer('resource_id').notNull().references(() => inventoryResources.id, { onDelete: 'restrict' }),
  legacyItemTypeKey: text('legacy_item_type_key').notNull(),
  legacyItemId: integer('legacy_item_id').notNull(),
  legacyResourceKey: text('legacy_resource_key').notNull(),
  legacyResourceGroupId: integer('legacy_resource_group_id'),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('resource_identity_aliases_legacy_unique').on(
    table.legacyItemTypeKey,
    table.legacyItemId,
    table.legacyResourceKey,
  ),
  uniqueIndex('resource_identity_aliases_resource_unique').on(table.resourceId),
  check('resource_identity_aliases_item_id_check', sql`${table.legacyItemId} > 0`),
  check('resource_identity_aliases_group_id_check', sql`
    ${table.legacyResourceGroupId} IS NULL OR ${table.legacyResourceGroupId} > 0
  `),
])
