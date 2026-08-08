import { createHash } from 'node:crypto'
import { isRelationalId } from '../db/relational-ids.mjs'
import { AGENT_HOST_TYPES } from '../agents/protocol-v1.mjs'
import { exportTelemetryBackup, replaceTelemetryBackup } from './backup.mjs'

const HOST_TYPE_SET = new Set(AGENT_HOST_TYPES)
const DEFAULT_QUERY_LIMIT = 1_440
const MAX_QUERY_LIMIT = 10_080
const STORAGE_CHECKPOINT_MS = 24 * 60 * 60 * 1000

function timestampMs(value, field) {
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${field} must be a valid timestamp.`)
  return parsed
}

function hostReference(hostType, hostId) {
  if (!HOST_TYPE_SET.has(hostType) || !isRelationalId(hostId)) {
    throw new Error('Telemetry host reference is invalid.')
  }
  return { hostType, hostId }
}

function boundedLimit(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_QUERY_LIMIT)
    : DEFAULT_QUERY_LIMIT
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function state(value) {
  const json = canonicalJson(value)
  return { json, hash: createHash('sha256').update(json).digest('hex') }
}

function componentKey(family, component) {
  if (family === 'service') return component.name
  if (family === 'container') return `${component.runtime}\u0000${component.runtimeId}`
  return `${component.kind}\u0000${component.deviceId}`
}

function decodeSample(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    hostType: row.host_type,
    hostId: row.host_id,
    sequence: row.sequence,
    receivedAt: new Date(row.received_at_ms).toISOString(),
    collectedAt: new Date(row.collected_at_ms).toISOString(),
    agentVersion: row.agent_version,
    payload: JSON.parse(row.payload_json),
  }
}

function decodeComponent(row) {
  return {
    family: row.family,
    key: row.entity_key,
    observedAt: new Date(row.observed_at_ms).toISOString(),
    state: JSON.parse(row.state_json),
  }
}

export class TelemetryRepository {
  constructor(database, { storageCheckpointMs = STORAGE_CHECKPOINT_MS } = {}) {
    this.database = database
    this.storageCheckpointMs = storageCheckpointMs
    this.insertSample = database.prepare(`
      INSERT INTO telemetry_samples (
        device_id, host_type, host_id, sequence, received_at_ms,
        collected_at_ms, agent_version, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.upsertLatestHost = database.prepare(`
      INSERT INTO latest_host_state (
        host_type, host_id, device_id, sequence, received_at_ms,
        collected_at_ms, agent_version, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_type, host_id) DO UPDATE SET
        device_id = excluded.device_id,
        sequence = excluded.sequence,
        received_at_ms = excluded.received_at_ms,
        collected_at_ms = excluded.collected_at_ms,
        agent_version = excluded.agent_version,
        payload_json = excluded.payload_json
    `)
    this.listLatestComponents = database.prepare(`
      SELECT family, entity_key, state_hash, observed_at_ms, state_json
      FROM latest_component_state
      WHERE host_type = ? AND host_id = ? AND family = ?
    `)
    this.lastComponentEvent = database.prepare(`
      SELECT observed_at_ms
      FROM component_events
      WHERE host_type = ? AND host_id = ? AND family = ? AND entity_key = ?
      ORDER BY id DESC
      LIMIT 1
    `)
    this.upsertLatestComponent = database.prepare(`
      INSERT INTO latest_component_state (
        host_type, host_id, family, entity_key, state_hash, observed_at_ms, state_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_type, host_id, family, entity_key) DO UPDATE SET
        state_hash = excluded.state_hash,
        observed_at_ms = excluded.observed_at_ms,
        state_json = excluded.state_json
    `)
    this.deleteLatestComponent = database.prepare(`
      DELETE FROM latest_component_state
      WHERE host_type = ? AND host_id = ? AND family = ? AND entity_key = ?
    `)
    this.insertComponentEvent = database.prepare(`
      INSERT INTO component_events (
        host_type, host_id, family, entity_key, event_kind, observed_at_ms, state_hash, state_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.recordTransaction = database.transaction((input) => this.#recordHeartbeat(input))
    this.deleteHostTransaction = database.transaction((hostType, hostId) => {
      const counts = {}
      for (const table of ['component_events', 'latest_component_state', 'latest_host_state', 'telemetry_samples']) {
        counts[table] = this.database.query(`DELETE FROM ${table} WHERE host_type = ? AND host_id = ?`).run(hostType, hostId).changes
      }
      return counts
    })
  }

  #reconcileComponents({ hostType, hostId, family, components, observedAtMs }) {
    const existing = new Map(this.listLatestComponents.all(hostType, hostId, family).map((row) => [row.entity_key, row]))
    const nextKeys = new Set()
    for (const component of components) {
      const key = componentKey(family, component)
      const next = state(component)
      const previous = existing.get(key)
      const lastEventAt = family === 'storage-health' && previous
        ? this.lastComponentEvent.get(hostType, hostId, family, key)?.observed_at_ms
        : null
      const checkpoint = family === 'storage-health'
        && previous
        && Number.isSafeInteger(lastEventAt)
        && observedAtMs - lastEventAt >= this.storageCheckpointMs
      const eventKind = !previous ? 'observed' : previous.state_hash !== next.hash ? 'changed' : checkpoint ? 'checkpoint' : null
      if (eventKind) {
        this.insertComponentEvent.run(hostType, hostId, family, key, eventKind, observedAtMs, next.hash, next.json)
      }
      this.upsertLatestComponent.run(hostType, hostId, family, key, next.hash, observedAtMs, next.json)
      nextKeys.add(key)
    }
    for (const [key, previous] of existing) {
      if (nextKeys.has(key)) continue
      this.insertComponentEvent.run(hostType, hostId, family, key, 'removed', observedAtMs, previous.state_hash, null)
      this.deleteLatestComponent.run(hostType, hostId, family, key)
    }
  }

  #recordHeartbeat({ deviceId, hostType, hostId, receivedAt, payload }) {
    hostReference(hostType, hostId)
    if (!isRelationalId(deviceId)) throw new Error('Telemetry device id is invalid.')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Telemetry payload is invalid.')
    if (!isRelationalId(payload.sequence)) throw new Error('Telemetry sequence is invalid.')
    const receivedAtMs = timestampMs(receivedAt, 'receivedAt')
    const collectedAtMs = timestampMs(payload.collectedAt, 'payload.collectedAt')
    const payloadJson = canonicalJson(payload)
    this.insertSample.run(
      deviceId, hostType, hostId, payload.sequence, receivedAtMs,
      collectedAtMs, payload.agentVersion, payloadJson,
    )
    this.upsertLatestHost.run(
      hostType, hostId, deviceId, payload.sequence, receivedAtMs,
      collectedAtMs, payload.agentVersion, payloadJson,
    )
    this.#reconcileComponents({ hostType, hostId, family: 'service', components: payload.services ?? [], observedAtMs: receivedAtMs })
    this.#reconcileComponents({ hostType, hostId, family: 'container', components: payload.containers ?? [], observedAtMs: receivedAtMs })
    this.#reconcileComponents({ hostType, hostId, family: 'storage-health', components: payload.storageHealth ?? [], observedAtMs: receivedAtMs })
  }

  recordHeartbeat(input) {
    this.recordTransaction(input)
  }

  getHostSummary(hostType, hostId) {
    hostReference(hostType, hostId)
    const row = this.database.query(`
      SELECT device_id, host_type, host_id, sequence, received_at_ms,
        collected_at_ms, agent_version, payload_json
      FROM latest_host_state
      WHERE host_type = ? AND host_id = ?
    `).get(hostType, hostId)
    if (!row) return null
    const components = this.database.query(`
      SELECT family, entity_key, observed_at_ms, state_json
      FROM latest_component_state
      WHERE host_type = ? AND host_id = ?
      ORDER BY family, entity_key
    `).all(hostType, hostId).map(decodeComponent)
    return {
      ...decodeSample(row),
      services: components.filter((entry) => entry.family === 'service'),
      containers: components.filter((entry) => entry.family === 'container'),
      storageHealth: components.filter((entry) => entry.family === 'storage-health'),
    }
  }

  listSamples(hostType, hostId, { from = 0, to = Date.now(), limit = DEFAULT_QUERY_LIMIT } = {}) {
    hostReference(hostType, hostId)
    const fromMs = timestampMs(from, 'from')
    const toMs = timestampMs(to, 'to')
    if (fromMs > toMs) throw new Error('Telemetry query start must not be after its end.')
    return this.database.query(`
      SELECT * FROM (
        SELECT id, device_id, host_type, host_id, sequence, received_at_ms,
          collected_at_ms, agent_version, payload_json
        FROM telemetry_samples
        WHERE host_type = ? AND host_id = ?
          AND received_at_ms BETWEEN ? AND ?
        ORDER BY received_at_ms DESC, id DESC
        LIMIT ?
      ) recent_samples
      ORDER BY received_at_ms, id
    `).all(hostType, hostId, fromMs, toMs, boundedLimit(limit)).map(decodeSample)
  }

  deleteHost(hostType, hostId) {
    hostReference(hostType, hostId)
    return this.deleteHostTransaction(hostType, hostId)
  }

  exportBackup() {
    return exportTelemetryBackup(this.database)
  }

  replaceBackup(value, currentStores) {
    replaceTelemetryBackup(this.database, value, currentStores)
  }
}
