import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems } from './inventory-base.ts'

export const agents = sqliteTable('agents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  publicKey: text('public_key').notNull(),
  protocolMajor: integer('protocol_major').notNull(),
  agentVersion: text('agent_version').notNull(),
  capabilitiesJson: text('capabilities_json').notNull().default('{}'),
  lastSequence: integer('last_sequence').notNull().default(0),
  lastSeenAtMs: integer('last_seen_at_ms'),
  revokedAtMs: integer('revoked_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('agents_public_key_unique').on(table.publicKey),
  check('agents_protocol_check', sql`${table.protocolMajor} > 0 AND ${table.lastSequence} >= 0`),
  check('agents_capabilities_json_check', sql`json_valid(${table.capabilitiesJson})`),
])

export const agentHostBindings = sqliteTable('agent_host_bindings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: integer('agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }),
  state: text('state').notNull(),
  boundAtMs: integer('bound_at_ms').notNull(),
  unboundAtMs: integer('unbound_at_ms'),
}, (table) => [
  uniqueIndex('agent_host_bindings_agent_active_unique').on(table.agentId).where(sql`${table.state} = 'active'`),
  uniqueIndex('agent_host_bindings_host_active_unique').on(table.hostItemId).where(sql`${table.state} = 'active'`),
  index('agent_host_bindings_host_index').on(table.hostItemId),
  check('agent_host_bindings_state_check', sql`${table.state} IN ('active', 'revoked', 'replaced', 'unlinked')`),
])

export const agentMonitoringPolicies = sqliteTable('agent_monitoring_policies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  heartbeatIntervalSeconds: integer('heartbeat_interval_seconds').notNull().default(60),
  selectedIntervalSeconds: integer('selected_interval_seconds').notNull().default(60),
  defaultIntervalSeconds: integer('default_interval_seconds').notNull().default(600),
  policyJson: text('policy_json').notNull().default('{}'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('agent_monitoring_policies_host_revision_unique').on(table.hostItemId, table.revision),
  check('agent_monitoring_policies_intervals_check', sql`${table.revision} > 0 AND ${table.heartbeatIntervalSeconds} > 0 AND ${table.selectedIntervalSeconds} > 0 AND ${table.defaultIntervalSeconds} > 0`),
  check('agent_monitoring_policies_json_check', sql`json_valid(${table.policyJson})`),
])

export const agentEnrollmentCodes = sqliteTable('agent_enrollment_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  usedAtMs: integer('used_at_ms'),
  revokedAtMs: integer('revoked_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('agent_enrollment_codes_token_unique').on(table.tokenHash),
  index('agent_enrollment_codes_host_index').on(table.hostItemId),
  check('agent_enrollment_codes_hash_check', sql`length(${table.tokenHash}) = 64`),
])

export const agentHardwareSnapshots = sqliteTable('agent_hardware_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: integer('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  payloadJson: text('payload_json').notNull(),
  collectedAtMs: integer('collected_at_ms').notNull(),
  receivedAtMs: integer('received_at_ms').notNull(),
}, (table) => [
  uniqueIndex('agent_hardware_snapshots_agent_sequence_unique').on(table.agentId, table.sequence),
  index('agent_hardware_snapshots_host_index').on(table.hostItemId, table.receivedAtMs),
  check('agent_hardware_snapshots_sequence_check', sql`${table.sequence} > 0`),
  check('agent_hardware_snapshots_payload_json_check', sql`json_valid(${table.payloadJson})`),
])

export const agentHardwareEvents = sqliteTable('agent_hardware_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => agentHardwareSnapshots.id, { onDelete: 'cascade' }),
  hostItemId: integer('host_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  componentKey: text('component_key'),
  detailsJson: text('details_json').notNull().default('{}'),
  occurredAtMs: integer('occurred_at_ms').notNull(),
}, (table) => [
  index('agent_hardware_events_host_index').on(table.hostItemId, table.occurredAtMs),
  check('agent_hardware_events_details_json_check', sql`json_valid(${table.detailsJson})`),
])
