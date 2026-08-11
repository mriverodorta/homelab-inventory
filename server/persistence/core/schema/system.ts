import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const applicationMetadata = sqliteTable('application_metadata', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  valueJson: text('value_json').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('application_metadata_key_unique').on(table.key),
  check('application_metadata_value_json_check', sql`json_valid(${table.valueJson})`),
])

export const applicationSettings = sqliteTable('application_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  valueJson: text('value_json').notNull(),
  source: text('source').notNull().default('database'),
  rowVersion: integer('row_version').notNull().default(1),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('application_settings_key_unique').on(table.key),
  check('application_settings_source_check', sql`${table.source} IN ('database', 'environment', 'default')`),
  check('application_settings_row_version_check', sql`${table.rowVersion} > 0`),
  check('application_settings_value_json_check', sql`json_valid(${table.valueJson})`),
])

export const applicationConfiguration = sqliteTable('application_configuration', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull().default(1),
  settingsJson: text('settings_json').notNull().default('{}'),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('application_configuration_singleton_check', sql`${table.id} = 1`),
  check('application_configuration_revision_check', sql`${table.revision} > 0`),
  check('application_configuration_json_check', sql`json_valid(${table.settingsJson})`),
])

export const settingSourceMetadata = sqliteTable('setting_source_metadata', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull(),
  settingKey: text('setting_key').notNull(),
  source: text('source').notNull(),
  environmentVariable: text('environment_variable'),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('setting_source_metadata_domain_key_unique').on(table.domain, table.settingKey),
  check('setting_source_metadata_source_check', sql`${table.source} IN ('database', 'environment', 'default')`),
  check('setting_source_metadata_environment_check', sql`
    (${table.source} = 'environment' AND ${table.environmentVariable} IS NOT NULL)
    OR (${table.source} <> 'environment' AND ${table.environmentVariable} IS NULL)
  `),
])

export const migrationRuns = sqliteTable('migration_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  migrationKey: text('migration_key').notNull(),
  sourceEngine: text('source_engine').notNull(),
  targetEngine: text('target_engine').notNull(),
  state: text('state').notNull(),
  backupPath: text('backup_path'),
  sourceDigest: text('source_digest'),
  targetDigest: text('target_digest'),
  errorCode: text('error_code'),
  startedAtMs: integer('started_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  index('migration_runs_migration_key_index').on(table.migrationKey),
  index('migration_runs_state_index').on(table.state),
  check('migration_runs_state_check', sql`${table.state} IN ('preparing', 'importing', 'verifying', 'activated', 'rolled-back', 'failed')`),
])

export const restoreRuns = sqliteTable('restore_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  backupFormatVersion: integer('backup_format_version').notNull(),
  state: text('state').notNull(),
  selectedSectionsJson: text('selected_sections_json').notNull(),
  sourceDigest: text('source_digest'),
  errorCode: text('error_code'),
  startedAtMs: integer('started_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  index('restore_runs_state_index').on(table.state),
  check('restore_runs_format_version_check', sql`${table.backupFormatVersion} > 0`),
  check('restore_runs_state_check', sql`${table.state} IN ('preparing', 'validating', 'restoring', 'verified', 'rolled-back', 'failed')`),
  check('restore_runs_sections_json_check', sql`json_valid(${table.selectedSectionsJson})`),
])

export const crossDatabaseOperations = sqliteTable('cross_database_operations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operationKey: text('operation_key').notNull(),
  operationType: text('operation_type').notNull(),
  state: text('state').notNull(),
  coreRevision: integer('core_revision'),
  telemetryRevision: integer('telemetry_revision'),
  catalogRevision: integer('catalog_revision'),
  detailsJson: text('details_json').notNull().default('{}'),
  startedAtMs: integer('started_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  uniqueIndex('cross_database_operations_key_unique').on(table.operationKey),
  index('cross_database_operations_state_index').on(table.state),
  check('cross_database_operations_state_check', sql`${table.state} IN ('pending', 'running', 'completed', 'compensating', 'failed')`),
  check('cross_database_operations_details_json_check', sql`json_valid(${table.detailsJson})`),
])
