import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems } from './inventory-base.ts'
import { chassisTypes } from './vocabularies.ts'

export const servers = sqliteTable('servers', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  hardwareClass: text('hardware_class').notNull().default('server'),
  usageRole: text('usage_role').notNull().default('server'),
  chassisTypeId: integer('chassis_type_id').references(() => chassisTypes.id, { onDelete: 'restrict' }),
  formFactorText: text('form_factor_text'),
  networkSlot: text('network_slot'),
  wireless: text('wireless'),
}, (table) => [
  index('servers_chassis_type_index').on(table.chassisTypeId),
  check('servers_hardware_class_check', sql`${table.hardwareClass} IN ('desktop', 'workstation', 'server')`),
  check('servers_usage_role_check', sql`${table.usageRole} IN ('server', 'desktop', 'workstation', 'other')`),
])

export const nasSystems = sqliteTable('nas_systems', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  driveBayCount: integer('drive_bay_count'),
  m2SlotCount: integer('m2_slot_count'),
  powerConfiguration: text('power_configuration').notNull().default('internal-psu'),
  formFactorText: text('form_factor_text'),
  platformFamily: text('platform_family'),
  variantKey: text('variant_key'),
  hardwareRevision: text('hardware_revision'),
  boardRevision: text('board_revision'),
  releaseDateText: text('release_date_text'),
  discontinued: integer('discontinued', { mode: 'boolean' }),
  widthMm: integer('width_mm'),
  heightMm: integer('height_mm'),
  depthMm: integer('depth_mm'),
  massGrams: integer('mass_grams'),
  rackUnits: integer('rack_units'),
}, (table) => [
  check('nas_systems_drive_bay_count_check', sql`${table.driveBayCount} IS NULL OR ${table.driveBayCount} >= 0`),
  check('nas_systems_m2_slot_count_check', sql`${table.m2SlotCount} IS NULL OR ${table.m2SlotCount} >= 0`),
  check('nas_systems_power_configuration_check', sql`${table.powerConfiguration} IN ('internal-psu', 'external-adapter')`),
  check('nas_systems_discontinued_check', sql`${table.discontinued} IS NULL OR ${table.discontinued} IN (0, 1)`),
  check('nas_systems_dimensions_check', sql`
    (${table.widthMm} IS NULL OR ${table.widthMm} >= 0)
    AND (${table.heightMm} IS NULL OR ${table.heightMm} >= 0)
    AND (${table.depthMm} IS NULL OR ${table.depthMm} >= 0)
  `),
  check('nas_systems_mass_check', sql`${table.massGrams} IS NULL OR ${table.massGrams} >= 0`),
  check('nas_systems_rack_units_check', sql`${table.rackUnits} IS NULL OR ${table.rackUnits} > 0`),
])

export const hostFixedComponents = sqliteTable('host_fixed_components', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  catalogComponentId: integer('catalog_component_id').notNull(),
  componentType: text('component_type').notNull(),
  disposition: text('disposition').notNull(),
  label: text('label').notNull(),
  templateKey: text('template_key'),
  templateRevision: integer('template_revision'),
  itemJson: text('item_json').notNull(),
  extensionsJson: text('extensions_json').notNull().default('{}'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  index('host_fixed_components_host_type_index').on(table.hostItemId, table.componentType),
  uniqueIndex('host_fixed_components_host_catalog_id_unique').on(table.hostItemId, table.catalogComponentId),
  check('host_fixed_components_catalog_id_check', sql`${table.catalogComponentId} > 0`),
  check('host_fixed_components_type_check', sql`length(trim(${table.componentType})) > 0`),
  check('host_fixed_components_disposition_check', sql`${table.disposition} IN ('fixed', 'soldered')`),
  check('host_fixed_components_label_check', sql`length(trim(${table.label})) > 0`),
  check('host_fixed_components_template_revision_check', sql`
    ${table.templateRevision} IS NULL
    OR (${table.templateRevision} > 0 AND ${table.templateKey} IS NOT NULL AND length(trim(${table.templateKey})) > 0)
  `),
  check('host_fixed_components_item_json_check', sql`json_valid(${table.itemJson}) AND json_type(${table.itemJson}) = 'object'`),
  check('host_fixed_components_extensions_json_check', sql`json_valid(${table.extensionsJson}) AND json_type(${table.extensionsJson}) = 'object'`),
])

export const pcBuilds = sqliteTable('pc_builds', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  operatingSystem: text('operating_system'),
  usageRole: text('usage_role'),
})
