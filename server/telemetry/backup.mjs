import { isRelationalId } from '../db/relational-ids.mjs'
import { TELEMETRY_SCHEMA_VERSION } from './schema.mjs'

const TABLES = Object.freeze({
  heartbeat_receipts: ['id', 'agent_id', 'host_item_id', 'host_type', 'host_id', 'sequence', 'collected_at_ms', 'received_at_ms', 'dropped_samples', 'agent_version', 'monitoring_revision'],
  host_metric_samples: ['host_item_id', 'minute_bucket_ms', 'cpu_percent', 'cpu_idle_percent', 'cpu_iowait_percent', 'cpu_steal_percent', 'cpu_system_percent', 'cpu_user_percent', 'memory_used_bytes', 'memory_used_percent'],
  agent_capabilities: ['agent_id', 'capabilities_hash', 'capabilities_json', 'updated_at_ms'],
  host_system_facts: ['host_item_id', 'facts_json', 'updated_at_ms'],
  host_runtime_state: ['host_item_id', 'uptime_seconds', 'load_1', 'load_5', 'load_15', 'memory_json', 'updated_at_ms'],
  telemetry_family_revisions: ['host_item_id', 'family', 'revision', 'reconciled_at_ms'],
  service_states: ['host_item_id', 'service_manager', 'service_key', 'lifecycle_hash', 'state_json', 'updated_at_ms'],
  container_states: ['host_item_id', 'runtime', 'runtime_id', 'lifecycle_hash', 'state_json', 'updated_at_ms'],
  storage_device_states: ['host_item_id', 'device_key', 'state_json', 'updated_at_ms'],
  filesystem_mount_states: ['host_item_id', 'mount_key', 'state_json', 'updated_at_ms'],
  gpu_states: ['host_item_id', 'gpu_key', 'state_json', 'updated_at_ms'],
  sensor_states: ['host_item_id', 'sensor_key', 'state_json', 'updated_at_ms'],
  storage_health_states: ['host_item_id', 'device_key', 'lifecycle_hash', 'state_json', 'updated_at_ms'],
  component_events: ['id', 'host_item_id', 'family', 'entity_key', 'event_kind', 'observed_at_ms', 'state_hash', 'state_json'],
  latest_virtualization_state: ['host_item_id', 'entity_key', 'state_hash', 'observed_at_ms', 'state_json'],
  virtualization_events: ['id', 'host_item_id', 'entity_key', 'event_kind', 'observed_at_ms', 'state_hash', 'state_json'],
  manual_inventory_reports: ['id', 'agent_id', 'host_item_id', 'sequence', 'collected_at_ms', 'received_at_ms', 'payload_hash', 'payload_json', 'complete'],
  manual_inventory_components: ['id', 'report_id', 'host_item_id', 'kind', 'locator', 'values_json'],
  agent_field_suggestions: ['id', 'host_item_id', 'report_id', 'component_id', 'target_item_id', 'field_path', 'value_json', 'state', 'created_at_ms', 'updated_at_ms'],
})
const DELETE_ORDER = Object.freeze([
  'agent_field_suggestions', 'manual_inventory_components', 'manual_inventory_reports',
  'virtualization_events', 'latest_virtualization_state', 'component_events',
  'telemetry_family_revisions', 'service_states', 'container_states', 'storage_device_states',
  'filesystem_mount_states', 'gpu_states', 'sensor_states', 'storage_health_states',
  'host_metric_samples', 'host_runtime_state', 'host_system_facts', 'agent_capabilities', 'heartbeat_receipts',
])
const MAX_ROWS = 250_000

export function emptyTelemetryBackup() {
  return {
    formatVersion: 2,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    tables: Object.fromEntries(Object.keys(TABLES).map((table) => [table, []])),
  }
}

function invalid(message) {
  throw new Error(`Agent telemetry backup ${message}`)
}

function assertJson(value, field, nullable = false) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || value.length > 1024 * 1024) invalid(`${field} is invalid.`)
  try { JSON.parse(value) } catch { invalid(`${field} contains invalid JSON.`) }
}

function assertKeys(row, columns, field) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) invalid(`${field} is invalid.`)
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...columns].sort())) invalid(`${field} has unsupported fields.`)
}

export function exportTelemetryBackup(database) {
  return {
    ...emptyTelemetryBackup(),
    tables: Object.fromEntries(Object.entries(TABLES).map(([table, columns]) => [
      table,
      database.query(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${columns.join(', ')}`).all(),
    ])),
  }
}

function normalizeBackup(value) {
  if (value?.formatVersion === 1 && value?.schemaVersion < TELEMETRY_SCHEMA_VERSION) return emptyTelemetryBackup()
  return value
}

export function validateTelemetryBackup(input) {
  const value = normalizeBackup(input)
  if (!value || typeof value !== 'object' || value.formatVersion !== 2 || value.schemaVersion !== TELEMETRY_SCHEMA_VERSION || !value.tables || typeof value.tables !== 'object') {
    invalid('format is unsupported.')
  }
  if (JSON.stringify(Object.keys(value.tables).sort()) !== JSON.stringify(Object.keys(TABLES).sort())) invalid('table set is invalid.')
  let rows = 0
  for (const [table, columns] of Object.entries(TABLES)) {
    if (!Array.isArray(value.tables[table])) invalid(`${table} must be an array.`)
    rows += value.tables[table].length
    if (rows > MAX_ROWS) invalid('contains too many rows.')
    for (const [index, row] of value.tables[table].entries()) {
      const field = `${table}[${index}]`
      assertKeys(row, columns, field)
      for (const key of ['id', 'agent_id', 'host_item_id', 'host_id', 'sequence', 'report_id']) {
        if (key in row && row[key] !== null && !isRelationalId(row[key])) invalid(`${field}.${key} is invalid.`)
      }
      for (const key of Object.keys(row).filter((name) => name.endsWith('_at_ms') || name === 'minute_bucket_ms')) {
        if (!Number.isSafeInteger(row[key]) || row[key] < 0) invalid(`${field}.${key} is invalid.`)
      }
      for (const key of Object.keys(row).filter((name) => name.endsWith('_json'))) assertJson(row[key], `${field}.${key}`, key === 'state_json')
    }
  }
  return value
}

export function replaceTelemetryBackup(database, input) {
  const value = validateTelemetryBackup(input)
  database.transaction(() => {
    for (const table of DELETE_ORDER) database.exec(`DELETE FROM ${table};`)
    for (const [table, columns] of Object.entries(TABLES)) {
      const statement = database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      for (const row of value.tables[table]) statement.run(...columns.map((column) => row[column]))
    }
  })()
}

export const AGENT_TELEMETRY_BACKUP_FILE = 'telemetry/telemetry-v2.json'
