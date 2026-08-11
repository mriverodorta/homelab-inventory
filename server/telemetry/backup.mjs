import { isRelationalId } from '../db/relational-ids.mjs'
import { TELEMETRY_SCHEMA_VERSION } from './schema.mjs'

const HOST_TABLES = Object.freeze({ server: 'servers', nas: 'nas', pcBuild: 'pcBuilds' })
const TABLES = Object.freeze({
  telemetry_samples: ['id', 'device_id', 'host_type', 'host_id', 'sequence', 'received_at_ms', 'collected_at_ms', 'agent_version', 'payload_json'],
  latest_host_state: ['host_type', 'host_id', 'device_id', 'sequence', 'received_at_ms', 'collected_at_ms', 'agent_version', 'payload_json'],
  latest_component_state: ['host_type', 'host_id', 'family', 'entity_key', 'state_hash', 'observed_at_ms', 'state_json'],
  component_events: ['id', 'host_type', 'host_id', 'family', 'entity_key', 'event_kind', 'observed_at_ms', 'state_hash', 'state_json'],
})
const MAX_ROWS = 2_000_000

export function emptyTelemetryBackup() {
  return {
    formatVersion: 1,
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

function assertHost(row, currentStores, field) {
  const table = HOST_TABLES[row.host_type]
  if (!table || !isRelationalId(row.host_id)) invalid(`${field} has an invalid host reference.`)
  if (!currentStores.inventory[table]?.some((item) => item.id === row.host_id)) invalid(`${field} references a missing host.`)
  const device = currentStores.agents.devices?.[String(row.device_id)]
  if ('device_id' in row && (!isRelationalId(row.device_id) || !device || device.hostType !== row.host_type || device.hostId !== row.host_id)) {
    invalid(`${field} references a missing or different agent device.`)
  }
}

function assertKeys(row, columns, field) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) invalid(`${field} is invalid.`)
  const actual = Object.keys(row).sort()
  const expected = [...columns].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) invalid(`${field} has unsupported fields.`)
}

export function exportTelemetryBackup(database) {
  return {
    ...emptyTelemetryBackup(),
    tables: Object.fromEntries(Object.entries(TABLES).map(([table, columns]) => [table, database.query(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${columns.join(', ')}`).all()])),
  }
}

export function validateTelemetryBackup(value, currentStores) {
  if (!value || typeof value !== 'object' || value.formatVersion !== 1 || value.schemaVersion !== TELEMETRY_SCHEMA_VERSION || !value.tables || typeof value.tables !== 'object') {
    invalid('format is unsupported.')
  }
  const tableNames = Object.keys(value.tables).sort()
  if (JSON.stringify(tableNames) !== JSON.stringify(Object.keys(TABLES).sort())) invalid('table set is invalid.')
  let rows = 0
  for (const [table, columns] of Object.entries(TABLES)) {
    const tableRows = value.tables[table]
    if (!Array.isArray(tableRows)) invalid(`${table} must be an array.`)
    rows += tableRows.length
    if (rows > MAX_ROWS) invalid('contains too many rows.')
    for (const [index, row] of tableRows.entries()) {
      const field = `${table}[${index}]`
      assertKeys(row, columns, field)
      assertHost(row, currentStores, field)
      if ('id' in row && !isRelationalId(row.id)) invalid(`${field}.id is invalid.`)
      if ('sequence' in row && !isRelationalId(row.sequence)) invalid(`${field}.sequence is invalid.`)
      for (const timestamp of ['received_at_ms', 'collected_at_ms', 'observed_at_ms']) {
        if (timestamp in row && (!Number.isSafeInteger(row[timestamp]) || row[timestamp] < 0)) invalid(`${field}.${timestamp} is invalid.`)
      }
      if ('payload_json' in row) assertJson(row.payload_json, `${field}.payload_json`)
      if ('state_json' in row) assertJson(row.state_json, `${field}.state_json`, table === 'component_events')
    }
  }
  return value
}

export function replaceTelemetryBackup(database, value, currentStores) {
  validateTelemetryBackup(value, currentStores)
  database.transaction(() => {
    database.exec('DELETE FROM component_events; DELETE FROM latest_component_state; DELETE FROM latest_host_state; DELETE FROM telemetry_samples;')
    for (const [table, columns] of Object.entries(TABLES)) {
      const placeholders = columns.map(() => '?').join(', ')
      const statement = database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
      for (const row of value.tables[table]) statement.run(...columns.map((column) => row[column]))
    }
  })()
}

export const AGENT_TELEMETRY_BACKUP_FILE = 'telemetry/telemetry-v1.json'
