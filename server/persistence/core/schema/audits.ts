import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems } from './inventory-base.ts'
import { projects } from './project-base.ts'
import { users } from './authentication.ts'

export const compatibilityAudits = sqliteTable('compatibility_audits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  inputRevision: integer('input_revision').notNull(),
  engineVersion: text('engine_version').notNull(),
  startedAtMs: integer('started_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  index('compatibility_audits_project_index').on(table.projectId, table.startedAtMs),
  check('compatibility_audits_state_check', sql`${table.state} IN ('running', 'completed', 'failed')`),
  check('compatibility_audits_revision_check', sql`${table.inputRevision} > 0`),
])

export const compatibilityAuditFindings = sqliteTable('compatibility_audit_findings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  componentItemId: integer('component_item_id').references(() => inventoryItems.id, { onDelete: 'cascade' }),
  findingKey: text('finding_key').notNull(),
  ruleKey: text('rule_key').notNull(),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  detailsJson: text('details_json').notNull().default('{}'),
  firstSeenAtMs: integer('first_seen_at_ms').notNull(),
  lastSeenAtMs: integer('last_seen_at_ms').notNull(),
  resolvedAtMs: integer('resolved_at_ms'),
}, (table) => [
  uniqueIndex('compatibility_audit_findings_project_key_unique').on(table.projectId, table.findingKey),
  index('compatibility_audit_findings_host_index').on(table.projectId, table.hostItemId, table.resolvedAtMs),
  check('compatibility_audit_findings_severity_check', sql`${table.severity} IN ('info', 'warning', 'error')`),
  check('compatibility_audit_findings_details_json_check', sql`json_valid(${table.detailsJson})`),
])

export const compatibilityAuditIgnores = sqliteTable('compatibility_audit_ignores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  findingId: integer('finding_id').notNull().references(() => compatibilityAuditFindings.id, { onDelete: 'cascade' }),
  ignoredByUserId: integer('ignored_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason'),
  ignoredAtMs: integer('ignored_at_ms').notNull(),
}, (table) => [uniqueIndex('compatibility_audit_ignores_finding_unique').on(table.findingId)])
