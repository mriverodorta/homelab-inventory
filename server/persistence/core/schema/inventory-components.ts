import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems, manufacturers } from './inventory-base.ts'
import {
  memoryGenerations,
  memoryModuleTypes,
  storageFormFactors,
  storageInterfaces,
} from './vocabularies.ts'

export const inventoryItemAliases = sqliteTable('inventory_item_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  normalizedAlias: text('normalized_alias').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_item_aliases_unique').on(table.itemId, table.normalizedAlias),
  index('inventory_item_aliases_normalized_index').on(table.normalizedAlias),
  check('inventory_item_aliases_normalized_check', sql`
    ${table.normalizedAlias} = lower(trim(${table.normalizedAlias}))
    AND length(${table.normalizedAlias}) > 0
  `),
])

export const inventoryItemProperties = sqliteTable('inventory_item_properties', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_item_properties_unique').on(table.itemId, table.key),
  check('inventory_item_properties_key_check', sql`length(trim(${table.key})) > 0`),
])

export const inventorySecondaryManufacturers = sqliteTable('inventory_secondary_manufacturers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  manufacturerId: integer('manufacturer_id').references(() => manufacturers.id, { onDelete: 'restrict' }),
  manufacturerText: text('manufacturer_text'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('inventory_secondary_manufacturers_item_unique').on(table.itemId),
  index('inventory_secondary_manufacturers_manufacturer_index').on(table.manufacturerId),
  check('inventory_secondary_manufacturers_value_check', sql`
    (${table.manufacturerId} IS NOT NULL AND ${table.manufacturerText} IS NULL)
    OR (${table.manufacturerId} IS NULL AND length(trim(${table.manufacturerText})) > 0)
  `),
])

export const cpus = sqliteTable('cpus', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  coreCount: integer('core_count'),
  threadCount: integer('thread_count'),
  baseClockMhz: integer('base_clock_mhz'),
  boostClockMhz: integer('boost_clock_mhz'),
}, (table) => [
  check('cpus_core_count_check', sql`${table.coreCount} IS NULL OR ${table.coreCount} > 0`),
  check('cpus_thread_count_check', sql`${table.threadCount} IS NULL OR ${table.threadCount} > 0`),
  check('cpus_base_clock_check', sql`${table.baseClockMhz} IS NULL OR ${table.baseClockMhz} >= 0`),
  check('cpus_boost_clock_check', sql`${table.boostClockMhz} IS NULL OR ${table.boostClockMhz} >= 0`),
])

export const memoryModules = sqliteTable('memory_modules', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  capacityMib: integer('capacity_mib'),
  memoryGenerationId: integer('memory_generation_id').references(() => memoryGenerations.id, { onDelete: 'restrict' }),
  speedMtps: integer('speed_mtps'),
  formFactor: text('form_factor'),
  moduleTypeId: integer('module_type_id').references(() => memoryModuleTypes.id, { onDelete: 'restrict' }),
  ecc: integer('ecc', { mode: 'boolean' }),
  rank: text('rank'),
  voltageMv: integer('voltage_mv'),
}, (table) => [
  index('memory_modules_generation_index').on(table.memoryGenerationId),
  index('memory_modules_module_type_index').on(table.moduleTypeId),
  check('memory_modules_capacity_check', sql`${table.capacityMib} IS NULL OR ${table.capacityMib} >= 0`),
  check('memory_modules_speed_check', sql`${table.speedMtps} IS NULL OR ${table.speedMtps} >= 0`),
  check('memory_modules_voltage_check', sql`${table.voltageMv} IS NULL OR ${table.voltageMv} >= 0`),
  check('memory_modules_ecc_check', sql`${table.ecc} IS NULL OR ${table.ecc} IN (0, 1)`),
])

export const storageDevices = sqliteTable('storage_devices', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  capacityBytes: integer('capacity_bytes'),
  interfaceId: integer('interface_id').references(() => storageInterfaces.id, { onDelete: 'restrict' }),
  formFactorId: integer('form_factor_id').references(() => storageFormFactors.id, { onDelete: 'restrict' }),
  interfaceText: text('interface_text'),
  formFactorText: text('form_factor_text'),
  partitionTable: text('partition_table'),
}, (table) => [
  index('storage_devices_interface_index').on(table.interfaceId),
  index('storage_devices_form_factor_index').on(table.formFactorId),
  check('storage_devices_capacity_check', sql`${table.capacityBytes} IS NULL OR ${table.capacityBytes} >= 0`),
])

export const graphicsCards = sqliteTable('graphics_cards', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  vramMib: integer('vram_mib'),
  formFactor: text('form_factor'),
  slotWidth: text('slot_width'),
  pcie: text('pcie'),
}, (table) => [
  check('graphics_cards_vram_check', sql`${table.vramMib} IS NULL OR ${table.vramMib} >= 0`),
])

export const motherboards = sqliteTable('motherboards', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  chipset: text('chipset'),
  formFactor: text('form_factor'),
  boardRevision: text('board_revision'),
  launchDateText: text('launch_date_text'),
  discontinued: integer('discontinued', { mode: 'boolean' }),
  wifiGeneration: text('wifi_generation'),
  bluetooth: text('bluetooth'),
}, (table) => [
  check('motherboards_discontinued_check', sql`${table.discontinued} IS NULL OR ${table.discontinued} IN (0, 1)`),
])

export const cpuCoolers = sqliteTable('cpu_coolers', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  coolerType: text('cooler_type'),
}, (table) => [
  check('cpu_coolers_type_check', sql`${table.coolerType} IS NULL OR ${table.coolerType} IN ('air', 'aio', 'custom-loop', 'passive')`),
])

export const computerCases = sqliteTable('computer_cases', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
})

export const caseFormFactorSupport = sqliteTable('case_form_factor_support', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  caseId: integer('case_id').notNull().references(() => computerCases.id, { onDelete: 'cascade' }),
  formFactor: text('form_factor').notNull(),
}, (table) => [
  uniqueIndex('case_form_factor_support_unique').on(table.caseId, table.formFactor),
  check('case_form_factor_support_value_check', sql`length(trim(${table.formFactor})) > 0`),
])

export const soundCards = sqliteTable('sound_cards', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  interface: text('interface'),
})

export const wirelessCards = sqliteTable('wireless_cards', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  interface: text('interface'),
  wifiGeneration: text('wifi_generation'),
  bluetooth: integer('bluetooth', { mode: 'boolean' }),
}, (table) => [
  check('wireless_cards_bluetooth_check', sql`${table.bluetooth} IS NULL OR ${table.bluetooth} IN (0, 1)`),
])
