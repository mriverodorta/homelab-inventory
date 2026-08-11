import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems, inventoryPorts } from './inventory-base.ts'
import { powerConnectorTypes } from './vocabularies.ts'

export const powerSupplies = sqliteTable('power_supplies', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  formFactor: text('form_factor'),
  ratedPowerMw: integer('rated_power_mw'),
  efficiencyRating: text('efficiency_rating'),
}, (table) => [
  check('power_supplies_rated_power_check', sql`${table.ratedPowerMw} IS NULL OR ${table.ratedPowerMw} >= 0`),
])

export const powerSupplyConnectors = sqliteTable('power_supply_connectors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  powerSupplyId: integer('power_supply_id').notNull().references(() => powerSupplies.id, { onDelete: 'cascade' }),
  connectorTypeId: integer('connector_type_id').references(() => powerConnectorTypes.id, { onDelete: 'restrict' }),
  connectorText: text('connector_text'),
  count: integer('count').notNull(),
}, (table) => [
  index('power_supply_connectors_type_index').on(table.connectorTypeId),
  uniqueIndex('power_supply_connectors_type_unique').on(
    table.powerSupplyId,
    table.connectorTypeId,
    table.connectorText,
  ),
  check('power_supply_connectors_count_check', sql`${table.count} > 0`),
  check('power_supply_connectors_value_check', sql`
    ${table.connectorTypeId} IS NOT NULL OR length(trim(${table.connectorText})) > 0
  `),
])

export const powerAdapters = sqliteTable('power_adapters', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  ratedPowerMw: integer('rated_power_mw'),
  connectorTypeId: integer('connector_type_id').references(() => powerConnectorTypes.id, { onDelete: 'restrict' }),
  connectorText: text('connector_text'),
}, (table) => [
  index('power_adapters_connector_type_index').on(table.connectorTypeId),
  check('power_adapters_rated_power_check', sql`${table.ratedPowerMw} IS NULL OR ${table.ratedPowerMw} >= 0`),
])

export const upsSystems = sqliteTable('ups_systems', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  ratedPowerMw: integer('rated_power_mw'),
  capacityMillivoltAmps: integer('capacity_millivolt_amps'),
  batteryOutletCount: integer('battery_outlet_count'),
  surgeOutletCount: integer('surge_outlet_count'),
  outletCount: integer('outlet_count'),
}, (table) => [
  check('ups_systems_rated_power_check', sql`${table.ratedPowerMw} IS NULL OR ${table.ratedPowerMw} >= 0`),
  check('ups_systems_capacity_check', sql`${table.capacityMillivoltAmps} IS NULL OR ${table.capacityMillivoltAmps} >= 0`),
  check('ups_systems_battery_outlet_check', sql`${table.batteryOutletCount} IS NULL OR ${table.batteryOutletCount} >= 0`),
  check('ups_systems_surge_outlet_check', sql`${table.surgeOutletCount} IS NULL OR ${table.surgeOutletCount} >= 0`),
  check('ups_systems_outlet_check', sql`${table.outletCount} IS NULL OR ${table.outletCount} >= 0`),
])

export const powerStrips = sqliteTable('power_strips', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  outletCount: integer('outlet_count'),
  surgeProtected: integer('surge_protected', { mode: 'boolean' }),
  surgeOutletCount: integer('surge_outlet_count'),
}, (table) => [
  check('power_strips_outlet_check', sql`${table.outletCount} IS NULL OR ${table.outletCount} >= 0`),
  check('power_strips_surge_outlet_check', sql`${table.surgeOutletCount} IS NULL OR ${table.surgeOutletCount} >= 0`),
  check('power_strips_surge_protected_check', sql`${table.surgeProtected} IS NULL OR ${table.surgeProtected} IN (0, 1)`),
])

export const powerStripSmartConfigurations = sqliteTable('power_strip_smart_configurations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  powerStripId: integer('power_strip_id').notNull().references(() => powerStrips.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  displayName: text('display_name'),
  managementIp: text('management_ip'),
  macAddress: text('mac_address'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('power_strip_smart_configurations_strip_unique').on(table.powerStripId),
  check('power_strip_smart_configurations_enabled_check', sql`${table.enabled} IN (0, 1)`),
])

export const powerStripOutletNames = sqliteTable('power_strip_outlet_names', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  smartConfigurationId: integer('smart_configuration_id').notNull().references(
    () => powerStripSmartConfigurations.id,
    { onDelete: 'cascade' },
  ),
  portId: integer('port_id').notNull().references(() => inventoryPorts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
}, (table) => [
  uniqueIndex('power_strip_outlet_names_configuration_port_unique').on(
    table.smartConfigurationId,
    table.portId,
  ),
  index('power_strip_outlet_names_port_index').on(table.portId),
  check('power_strip_outlet_names_name_check', sql`length(trim(${table.name})) > 0`),
])
