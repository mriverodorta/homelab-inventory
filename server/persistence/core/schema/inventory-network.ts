import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { inventoryItems } from './inventory-base.ts'

export const networkCards = sqliteTable('network_cards', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  portCount: integer('port_count'),
  maxSpeedBps: integer('max_speed_bps'),
  interface: text('interface'),
  formFactor: text('form_factor'),
}, (table) => [
  check('network_cards_port_count_check', sql`${table.portCount} IS NULL OR ${table.portCount} >= 0`),
  check('network_cards_speed_check', sql`${table.maxSpeedBps} IS NULL OR ${table.maxSpeedBps} >= 0`),
])

export const networkSwitches = sqliteTable('network_switches', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  managementType: text('management_type'),
  switchingCapacityBps: integer('switching_capacity_bps'),
  fanless: integer('fanless', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  check('network_switches_capacity_check', sql`${table.switchingCapacityBps} IS NULL OR ${table.switchingCapacityBps} >= 0`),
  check('network_switches_fanless_check', sql`${table.fanless} IN (0, 1)`),
])

export const patchPanels = sqliteTable('patch_panels', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  rackUnits: integer('rack_units'),
  mount: text('mount'),
}, (table) => [
  check('patch_panels_rack_units_check', sql`${table.rackUnits} IS NULL OR ${table.rackUnits} >= 0`),
])

export const monitors = sqliteTable('monitors', {
  id: integer('id').primaryKey().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  diagonalMm: integer('diagonal_mm'),
  diagonalSourceText: text('diagonal_source_text'),
  resolution: text('resolution'),
  refreshRateMillihz: integer('refresh_rate_millihz'),
}, (table) => [
  check('monitors_diagonal_check', sql`${table.diagonalMm} IS NULL OR ${table.diagonalMm} >= 0`),
  check('monitors_refresh_rate_check', sql`${table.refreshRateMillihz} IS NULL OR ${table.refreshRateMillihz} >= 0`),
])
