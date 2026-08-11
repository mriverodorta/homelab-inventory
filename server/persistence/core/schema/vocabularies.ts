import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

function vocabularyTable(name: string) {
  return sqliteTable(name, {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull(),
  }, (table) => [
    uniqueIndex(`${name}_key_unique`).on(table.key),
    uniqueIndex(`${name}_sort_order_unique`).on(table.sortOrder),
    check(`${name}_key_format_check`, sql`${table.key} = lower(trim(${table.key})) AND length(${table.key}) > 0`),
    check(`${name}_label_check`, sql`length(trim(${table.label})) > 0`),
  ])
}

export const cpuSocketTypes = vocabularyTable('cpu_socket_types')
export const memoryGenerations = vocabularyTable('memory_generations')
export const memoryModuleTypes = vocabularyTable('memory_module_types')
export const storageInterfaces = vocabularyTable('storage_interfaces')
export const storageFormFactors = vocabularyTable('storage_form_factors')
export const expansionSlotTypes = vocabularyTable('expansion_slot_types')
export const portKinds = vocabularyTable('port_kinds')
export const connectorTypes = vocabularyTable('connector_types')
export const chassisTypes = vocabularyTable('chassis_types')
export const powerConnectorTypes = vocabularyTable('power_connector_types')
