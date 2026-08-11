import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { users } from './authentication.ts'
import { inventoryItems } from './inventory-base.ts'

export const notificationSettings = sqliteTable('notification_settings', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  incidentRetentionDays: integer('incident_retention_days').notNull().default(90),
  deliveryAttemptRetentionDays: integer('delivery_attempt_retention_days').notNull().default(30),
  lastEvaluatedAtMs: integer('last_evaluated_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('notification_settings_singleton_check', sql`${table.id} = 1`),
  check('notification_settings_values_check', sql`${table.revision} > 0 AND ${table.incidentRetentionDays} > 0 AND ${table.deliveryAttemptRetentionDays} > 0`),
])

export const notificationSecrets = sqliteTable('notification_secrets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  algorithm: text('algorithm').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  ciphertext: text('ciphertext').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [check('notification_secrets_algorithm_check', sql`${table.algorithm} = 'aes-256-gcm'`)])

export const notificationContactPoints = sqliteTable('notification_contact_points', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  secretId: integer('secret_id').references(() => notificationSecrets.id, { onDelete: 'set null' }),
  configJson: text('config_json').notNull().default('{}'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('notification_contact_points_name_unique').on(table.name),
  check('notification_contact_points_type_check', sql`${table.type} IN ('ntfy', 'webhook')`),
  check('notification_contact_points_config_json_check', sql`json_valid(${table.configJson})`),
])

export const notificationRules = sqliteTable('notification_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  debounceSeconds: integer('debounce_seconds').notNull(),
  cooldownSeconds: integer('cooldown_seconds').notNull(),
  reminderIntervalSeconds: integer('reminder_interval_seconds'),
}, (table) => [
  uniqueIndex('notification_rules_event_unique').on(table.eventType),
  check('notification_rules_event_check', sql`${table.eventType} IN ('host.offline', 'service.unhealthy', 'container.unhealthy', 'container.missing', 'storage.warning', 'storage.failed')`),
  check('notification_rules_severity_check', sql`${table.severity} IN ('info', 'warning', 'critical')`),
  check('notification_rules_timing_check', sql`${table.debounceSeconds} >= 0 AND ${table.cooldownSeconds} >= 0 AND (${table.reminderIntervalSeconds} IS NULL OR ${table.reminderIntervalSeconds} > 0)`),
])

export const notificationRuleContactPoints = sqliteTable('notification_rule_contact_points', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ruleId: integer('rule_id').notNull().references(() => notificationRules.id, { onDelete: 'cascade' }),
  contactPointId: integer('contact_point_id').notNull().references(() => notificationContactPoints.id, { onDelete: 'restrict' }),
}, (table) => [uniqueIndex('notification_rule_contact_points_unique').on(table.ruleId, table.contactPointId)])

export const notificationQuietHours = sqliteTable('notification_quiet_hours', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  timezone: text('timezone').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  weekdaysJson: text('weekdays_json').notNull(),
}, (table) => [
  check('notification_quiet_hours_start_check', sql`${table.startTime} GLOB '[0-2][0-9]:[0-5][0-9]'`),
  check('notification_quiet_hours_end_check', sql`${table.endTime} GLOB '[0-2][0-9]:[0-5][0-9]'`),
  check('notification_quiet_hours_weekdays_json_check', sql`json_valid(${table.weekdaysJson})`),
])

export const notificationMonitoredResources = sqliteTable('notification_monitored_resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  family: text('family').notNull(),
  resourceKey: text('resource_key').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
}, (table) => [
  uniqueIndex('notification_monitored_resources_unique').on(table.hostItemId, table.family, table.resourceKey),
  check('notification_monitored_resources_family_check', sql`${table.family} IN ('service', 'container', 'storage-health')`),
])

export const notificationHostOverrides = sqliteTable('notification_host_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
  mutedUntilMs: integer('muted_until_ms'),
  rulesJson: text('rules_json').notNull().default('[]'),
}, (table) => [
  uniqueIndex('notification_host_overrides_host_unique').on(table.hostItemId),
  check('notification_host_overrides_mode_check', sql`${table.mode} IN ('inherit', 'custom', 'disabled')`),
  check('notification_host_overrides_rules_json_check', sql`json_valid(${table.rulesJson})`),
])

export const notificationHostOverrideResources = sqliteTable('notification_host_override_resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostOverrideId: integer('host_override_id').notNull().references(() => notificationHostOverrides.id, { onDelete: 'cascade' }),
  monitoredResourceId: integer('monitored_resource_id').notNull().references(() => notificationMonitoredResources.id, { onDelete: 'cascade' }),
}, (table) => [uniqueIndex('notification_host_override_resources_unique').on(table.hostOverrideId, table.monitoredResourceId)])

export const notificationNormalizedStates = sqliteTable('notification_normalized_states', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  monitoredResourceId: integer('monitored_resource_id').references(() => notificationMonitoredResources.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  state: text('state').notNull(),
  sequence: integer('sequence'),
  observedAtMs: integer('observed_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('notification_normalized_states_event_unique').on(table.hostItemId, table.monitoredResourceId, table.eventType),
  check('notification_normalized_states_state_check', sql`${table.state} IN ('healthy', 'problem', 'unknown')`),
  check('notification_normalized_states_sequence_check', sql`${table.sequence} IS NULL OR ${table.sequence} >= 0`),
])

export const notificationPendingTransitions = sqliteTable('notification_pending_transitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  monitoredResourceId: integer('monitored_resource_id').references(() => notificationMonitoredResources.id, { onDelete: 'cascade' }),
  eventKey: text('event_key').notNull(),
  eventType: text('event_type').notNull(),
  candidateState: text('candidate_state').notNull(),
  firstObservedAtMs: integer('first_observed_at_ms').notNull(),
  lastObservedAtMs: integer('last_observed_at_ms').notNull(),
  observationCount: integer('observation_count').notNull().default(1),
  dueAtMs: integer('due_at_ms').notNull(),
}, (table) => [
  uniqueIndex('notification_pending_transitions_event_unique').on(table.eventKey),
  index('notification_pending_transitions_due_index').on(table.dueAtMs),
  check('notification_pending_transitions_state_check', sql`${table.candidateState} IN ('healthy', 'problem')`),
  check('notification_pending_transitions_count_check', sql`${table.observationCount} > 0`),
])

export const incidents = sqliteTable('incidents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }),
  monitoredResourceId: integer('monitored_resource_id').references(() => notificationMonitoredResources.id, { onDelete: 'set null' }),
  eventKey: text('event_key').notNull(),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  state: text('state').notNull(),
  openedAtMs: integer('opened_at_ms').notNull(),
  resolvedAtMs: integer('resolved_at_ms'),
  notificationDeliveredAtMs: integer('notification_delivered_at_ms'),
  lastReminderAtMs: integer('last_reminder_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('incidents_active_event_unique').on(table.eventKey).where(sql`${table.state} IN ('pending', 'open')`),
  index('incidents_state_index').on(table.state, table.updatedAtMs),
  check('incidents_type_check', sql`${table.eventType} IN ('host.offline', 'service.unhealthy', 'container.unhealthy', 'container.missing', 'storage.warning', 'storage.failed')`),
  check('incidents_severity_check', sql`${table.severity} IN ('info', 'warning', 'critical')`),
  check('incidents_state_check', sql`${table.state} IN ('pending', 'open', 'resolved', 'cancelled')`),
])

export const incidentTransitions = sqliteTable('incident_transitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: integer('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  reason: text('reason'),
  occurredAtMs: integer('occurred_at_ms').notNull(),
}, (table) => [index('incident_transitions_incident_index').on(table.incidentId, table.occurredAtMs)])

export const incidentAcknowledgements = sqliteTable('incident_acknowledgements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: integer('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  note: text('note'),
  acknowledgedAtMs: integer('acknowledged_at_ms').notNull(),
}, (table) => [index('incident_acknowledgements_incident_index').on(table.incidentId)])

export const notificationDeliveries = sqliteTable('notification_deliveries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: integer('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  contactPointId: integer('contact_point_id').notNull().references(() => notificationContactPoints.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(),
  state: text('state').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  availableAtMs: integer('available_at_ms').notNull(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAtMs: integer('lease_expires_at_ms'),
  deliveredAtMs: integer('delivered_at_ms'),
  lastError: text('last_error'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('notification_deliveries_idempotency_unique').on(table.idempotencyKey),
  index('notification_deliveries_queue_index').on(table.state, table.availableAtMs),
  check('notification_deliveries_kind_check', sql`${table.kind} IN ('opening', 'reminder', 'recovery')`),
  check('notification_deliveries_state_check', sql`${table.state} IN ('queued', 'leased', 'delivered', 'retrying', 'exhausted', 'cancelled')`),
])

export const notificationDeliveryAttempts = sqliteTable('notification_delivery_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deliveryId: integer('delivery_id').notNull().references(() => notificationDeliveries.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  state: text('state').notNull(),
  statusCode: integer('status_code'),
  errorCode: text('error_code'),
  attemptedAtMs: integer('attempted_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  uniqueIndex('notification_delivery_attempts_number_unique').on(table.deliveryId, table.attemptNumber),
  check('notification_delivery_attempts_number_check', sql`${table.attemptNumber} > 0`),
  check('notification_delivery_attempts_state_check', sql`${table.state} IN ('delivered', 'failed', 'cancelled')`),
])

export const notificationCooldowns = sqliteTable('notification_cooldowns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  monitoredResourceId: integer('monitored_resource_id').references(() => notificationMonitoredResources.id, { onDelete: 'cascade' }),
  contactPointId: integer('contact_point_id').notNull().references(() => notificationContactPoints.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('notification_cooldowns_event_unique').on(table.hostItemId, table.monitoredResourceId, table.contactPointId, table.eventType),
])

export const notificationEvaluationCursors = sqliteTable('notification_evaluation_cursors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  lastSequence: integer('last_sequence').notNull().default(0),
  lastCollectedAtMs: integer('last_collected_at_ms'),
  lastReceivedAtMs: integer('last_received_at_ms'),
  candidateCollectedAtMs: integer('candidate_collected_at_ms'),
  candidateReceivedAtMs: integer('candidate_received_at_ms'),
}, (table) => [
  uniqueIndex('notification_evaluation_cursors_host_unique').on(table.hostItemId),
  check('notification_evaluation_cursors_sequence_check', sql`${table.lastSequence} >= 0`),
])
