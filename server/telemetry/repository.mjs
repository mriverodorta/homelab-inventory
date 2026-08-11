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
    agentId: row.agent_id ?? null,
    hostType: row.host_type,
    hostId: row.host_id,
    hostItemId: row.host_item_id ?? null,
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
        collected_at_ms, agent_version, payload_json, agent_id, host_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.upsertLatestHost = database.prepare(`
      INSERT INTO latest_host_state (
        host_type, host_id, device_id, sequence, received_at_ms,
        collected_at_ms, agent_version, payload_json, agent_id, host_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_type, host_id) DO UPDATE SET
        device_id = excluded.device_id,
        sequence = excluded.sequence,
        received_at_ms = excluded.received_at_ms,
        collected_at_ms = excluded.collected_at_ms,
        agent_version = excluded.agent_version,
        payload_json = excluded.payload_json,
        agent_id = excluded.agent_id,
        host_item_id = excluded.host_item_id
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
        host_type, host_id, family, entity_key, state_hash, observed_at_ms, state_json, host_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_type, host_id, family, entity_key) DO UPDATE SET
        state_hash = excluded.state_hash,
        observed_at_ms = excluded.observed_at_ms,
        state_json = excluded.state_json,
        host_item_id = excluded.host_item_id
    `)
    this.deleteLatestComponent = database.prepare(`
      DELETE FROM latest_component_state
      WHERE host_type = ? AND host_id = ? AND family = ? AND entity_key = ?
    `)
    this.insertComponentEvent = database.prepare(`
      INSERT INTO component_events (
        host_type, host_id, family, entity_key, event_kind, observed_at_ms, state_hash, state_json, host_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.insertHostMetrics = database.prepare(`
      INSERT INTO host_metric_samples (
        sample_id, host_item_id, uptime_seconds, cpu_percent,
        memory_used_bytes, memory_total_bytes, load_1, load_5, load_15
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.insertNetworkSample = database.prepare(`
      INSERT INTO network_interface_samples (
        sample_id, host_item_id, interface_key, metrics_json
      ) VALUES (?, ?, ?, ?)
    `)
    this.insertStorageSample = database.prepare(`
      INSERT INTO storage_device_samples (
        sample_id, host_item_id, device_key, metrics_json
      ) VALUES (?, ?, ?, ?)
    `)
    this.insertFilesystemSample = database.prepare(`
      INSERT INTO filesystem_samples (
        sample_id, host_item_id, mount_key, device_key, filesystem_type,
        total_bytes, used_bytes, available_bytes, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.insertManualReport = database.prepare(`
      INSERT INTO manual_inventory_reports (
        agent_id, host_item_id, sequence, collected_at_ms, received_at_ms,
        payload_hash, payload_json, complete
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `)
    this.insertManualComponent = database.prepare(`
      INSERT INTO manual_inventory_components (
        report_id, host_item_id, kind, locator, values_json
      ) VALUES (?, ?, ?, ?, ?)
    `)
    this.recordTransaction = database.transaction((input) => this.#recordHeartbeat(input))
    this.deleteHostTransaction = database.transaction((hostType, hostId) => {
      const counts = {}
      const canonical = this.database.query(`
        SELECT host_item_id
        FROM latest_host_state
        WHERE host_type = ? AND host_id = ?
      `).get(hostType, hostId)?.host_item_id
      if (isRelationalId(canonical)) {
        for (const table of ['agent_field_suggestions', 'manual_inventory_reports', 'virtualization_events', 'latest_virtualization_state']) {
          counts[table] = this.database.query(`DELETE FROM ${table} WHERE host_item_id = ?`).run(canonical).changes
        }
      }
      for (const table of ['component_events', 'latest_component_state', 'latest_host_state', 'telemetry_samples']) {
        counts[table] = this.database.query(`DELETE FROM ${table} WHERE host_type = ? AND host_id = ?`).run(hostType, hostId).changes
      }
      return counts
    })
  }

  #reconcileComponents({ hostType, hostId, hostItemId, family, components, observedAtMs }) {
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
        this.insertComponentEvent.run(hostType, hostId, family, key, eventKind, observedAtMs, next.hash, next.json, hostItemId ?? null)
      }
      this.upsertLatestComponent.run(hostType, hostId, family, key, next.hash, observedAtMs, next.json, hostItemId ?? null)
      nextKeys.add(key)
    }
    for (const [key, previous] of existing) {
      if (nextKeys.has(key)) continue
      this.insertComponentEvent.run(hostType, hostId, family, key, 'removed', observedAtMs, previous.state_hash, null, hostItemId ?? null)
      this.deleteLatestComponent.run(hostType, hostId, family, key)
    }
  }

  #recordMetricProjections(sampleId, hostItemId, metrics) {
    if (!isRelationalId(hostItemId)) return
    const load = Array.isArray(metrics.loadAverage) ? metrics.loadAverage : []
    this.insertHostMetrics.run(
      sampleId,
      hostItemId,
      Number.isSafeInteger(metrics.uptimeSeconds) ? metrics.uptimeSeconds : null,
      Number.isFinite(metrics.cpu?.percent) ? metrics.cpu.percent : null,
      Number.isSafeInteger(metrics.memory?.usedBytes) ? metrics.memory.usedBytes : null,
      Number.isSafeInteger(metrics.memory?.totalBytes) ? metrics.memory.totalBytes : null,
      Number.isFinite(load[0]) ? load[0] : null,
      Number.isFinite(load[1]) ? load[1] : null,
      Number.isFinite(load[2]) ? load[2] : null,
    )
    for (const [index, network] of (metrics.network ?? []).entries()) {
      const key = network.name ?? network.interface ?? network.device ?? `network-${index + 1}`
      this.insertNetworkSample.run(sampleId, hostItemId, String(key), canonicalJson(network))
    }
    for (const [index, disk] of (metrics.diskIo ?? []).entries()) {
      const key = disk.deviceId ?? disk.device ?? disk.name ?? `storage-${index + 1}`
      this.insertStorageSample.run(sampleId, hostItemId, String(key), canonicalJson(disk))
    }
    for (const [index, filesystem] of (metrics.filesystems ?? []).entries()) {
      const mountKey = filesystem.mountPoint ?? filesystem.mount ?? `filesystem-${index + 1}`
      this.insertFilesystemSample.run(
        sampleId,
        hostItemId,
        String(mountKey),
        filesystem.deviceId ?? filesystem.device ?? null,
        filesystem.filesystemType ?? filesystem.type ?? null,
        Number.isSafeInteger(filesystem.totalBytes) ? filesystem.totalBytes : null,
        Number.isSafeInteger(filesystem.usedBytes) ? filesystem.usedBytes : null,
        Number.isSafeInteger(filesystem.availableBytes) ? filesystem.availableBytes : null,
        canonicalJson(filesystem),
      )
    }
  }

  #recordHeartbeat({ deviceId, agentId, hostType, hostId, hostItemId, receivedAt, payload }) {
    hostReference(hostType, hostId)
    if (!isRelationalId(deviceId)) throw new Error('Telemetry device id is invalid.')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Telemetry payload is invalid.')
    if (!isRelationalId(payload.sequence)) throw new Error('Telemetry sequence is invalid.')
    const receivedAtMs = timestampMs(receivedAt, 'receivedAt')
    const collectedAtMs = timestampMs(payload.collectedAt, 'payload.collectedAt')
    const payloadJson = canonicalJson(payload)
    if (agentId !== undefined && agentId !== null && !isRelationalId(agentId)) throw new Error('Canonical telemetry agent id is invalid.')
    if (hostItemId !== undefined && hostItemId !== null && !isRelationalId(hostItemId)) throw new Error('Canonical telemetry host id is invalid.')
    const sample = this.insertSample.run(
      deviceId, hostType, hostId, payload.sequence, receivedAtMs,
      collectedAtMs, payload.agentVersion, payloadJson, agentId ?? null, hostItemId ?? null,
    )
    this.upsertLatestHost.run(
      hostType, hostId, deviceId, payload.sequence, receivedAtMs,
      collectedAtMs, payload.agentVersion, payloadJson, agentId ?? null, hostItemId ?? null,
    )
    const sampleId = Number(sample.lastInsertRowid)
    this.#recordMetricProjections(sampleId, hostItemId, payload.metrics ?? {})
    this.#reconcileComponents({ hostType, hostId, hostItemId, family: 'service', components: payload.services ?? [], observedAtMs: receivedAtMs })
    this.#reconcileComponents({ hostType, hostId, hostItemId, family: 'container', components: payload.containers ?? [], observedAtMs: receivedAtMs })
    this.#reconcileComponents({ hostType, hostId, hostItemId, family: 'storage-health', components: payload.storageHealth ?? [], observedAtMs: receivedAtMs })
  }

  recordHeartbeat(input) {
    this.recordTransaction(input)
  }

  recordManualInventoryReport({ agentId, hostItemId, sequence, collectedAt, receivedAt, payload }) {
    if (!isRelationalId(agentId) || !isRelationalId(hostItemId) || !isRelationalId(sequence)) {
      throw new Error('Manual inventory report identity is invalid.')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.components)) {
      throw new Error('Manual inventory report payload is invalid.')
    }
    const payloadJson = canonicalJson(payload)
    return this.database.transaction(() => {
      const result = this.insertManualReport.run(
        agentId,
        hostItemId,
        sequence,
        timestampMs(collectedAt, 'collectedAt'),
        timestampMs(receivedAt, 'receivedAt'),
        createHash('sha256').update(payloadJson).digest('hex'),
        payloadJson,
      )
      const reportId = Number(result.lastInsertRowid)
      for (const component of payload.components) {
        this.insertManualComponent.run(
          reportId,
          hostItemId,
          String(component.kind),
          String(component.locator),
          canonicalJson(component.values ?? {}),
        )
      }
      return { id: reportId, componentCount: payload.components.length }
    }).immediate()
  }

  getHostSummary(hostType, hostId) {
    hostReference(hostType, hostId)
    const row = this.database.query(`
      SELECT device_id, agent_id, host_type, host_id, host_item_id, sequence, received_at_ms,
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
        SELECT id, device_id, agent_id, host_type, host_id, host_item_id, sequence, received_at_ms,
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
