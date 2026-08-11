import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
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
}, (table) => [
  check('nas_systems_drive_bay_count_check', sql`${table.driveBayCount} IS NULL OR ${table.driveBayCount} >= 0`),
  check('nas_systems_m2_slot_count_check', sql`${table.m2SlotCount} IS NULL OR ${table.m2SlotCount} >= 0`),
  check('nas_systems_power_configuration_check', sql`${table.powerConfiguration} IN ('internal-psu', 'external-adapter')`),
])

export const pcBuilds = sqliteTable('pc_builds', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  operatingSystem: text('operating_system'),
  usageRole: text('usage_role'),
})
