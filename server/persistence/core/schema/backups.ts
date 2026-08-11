import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './authentication.ts'

export const backupSchedules = sqliteTable('backup_schedules', {
  id: integer('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  frequency: text('frequency').notNull().default('daily'),
  localTime: text('local_time').notNull().default('02:00'),
  weekday: integer('weekday').notNull().default(0),
  timezone: text('timezone'),
  retentionCount: integer('retention_count').notNull().default(7),
  nextRunAtMs: integer('next_run_at_ms'),
  lastRunAtMs: integer('last_run_at_ms'),
  lastResult: text('last_result'),
  updatedAtMs: integer('updated_at_ms'),
}, (table) => [
  check('backup_schedules_singleton_check', sql`${table.id} = 1`),
  check('backup_schedules_frequency_check', sql`${table.frequency} IN ('daily', 'weekly')`),
  check('backup_schedules_time_check', sql`
    length(${table.localTime}) = 5
    AND substr(${table.localTime}, 3, 1) = ':'
    AND CAST(substr(${table.localTime}, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    AND CAST(substr(${table.localTime}, 4, 2) AS INTEGER) BETWEEN 0 AND 59
  `),
  check('backup_schedules_weekday_check', sql`${table.weekday} BETWEEN 0 AND 6`),
  check('backup_schedules_retention_check', sql`${table.retentionCount} BETWEEN 1 AND 365`),
])

export const backupRuns = sqliteTable('backup_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  state: text('state').notNull(),
  formatVersion: integer('format_version').notNull(),
  selectedSectionsJson: text('selected_sections_json').notNull(),
  path: text('path'),
  sizeBytes: integer('size_bytes'),
  digest: text('digest'),
  errorCode: text('error_code'),
  startedByUserId: integer('started_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAtMs: integer('started_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  index('backup_runs_state_index').on(table.state, table.startedAtMs),
  check('backup_runs_kind_check', sql`${table.kind} IN ('manual', 'scheduled', 'pre-migration', 'pre-restore')`),
  check('backup_runs_state_check', sql`${table.state} IN ('preparing', 'writing', 'verified', 'failed', 'deleted')`),
  check('backup_runs_format_check', sql`${table.formatVersion} > 0`),
  check('backup_runs_sections_json_check', sql`json_valid(${table.selectedSectionsJson})`),
  check('backup_runs_size_check', sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
])

export const backupRestoreJournal = sqliteTable('backup_restore_journal', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  backupRunId: integer('backup_run_id').references(() => backupRuns.id, { onDelete: 'set null' }),
  state: text('state').notNull(),
  formatVersion: integer('format_version').notNull(),
  selectedSectionsJson: text('selected_sections_json').notNull(),
  stagingPath: text('staging_path'),
  sourceDigest: text('source_digest'),
  targetDigest: text('target_digest'),
  errorCode: text('error_code'),
  startedByUserId: integer('started_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAtMs: integer('started_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  index('backup_restore_journal_state_index').on(table.state, table.startedAtMs),
  check('backup_restore_journal_state_check', sql`${table.state} IN ('preparing', 'validating', 'staging', 'restoring', 'verified', 'rolled-back', 'failed')`),
  check('backup_restore_journal_format_check', sql`${table.formatVersion} > 0`),
  check('backup_restore_journal_sections_json_check', sql`json_valid(${table.selectedSectionsJson})`),
])

export const backupOperations = sqliteTable('backup_operations', {
  id: integer('id').primaryKey(),
  operationType: text('operation_type').notNull(),
  relatedRecordId: integer('related_record_id'),
  state: text('state').notNull(),
  startedAtMs: integer('started_at_ms').notNull(),
}, (table) => [
  check('backup_operations_singleton_check', sql`${table.id} = 1`),
  check('backup_operations_type_check', sql`${table.operationType} IN ('backup', 'restore')`),
  check('backup_operations_state_check', sql`${table.state} IN ('running')`),
])
