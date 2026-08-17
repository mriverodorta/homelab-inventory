import { createHash } from 'node:crypto'
import { isRelationalId } from '../db/relational-ids.mjs'
import { AGENT_HOST_TYPES } from '../agents/protocol-v1.mjs'
import { normalizeTelemetryEnvelope } from '../agents/telemetry-envelope.mjs'
import { containerKey, deviceKey, gpuKey, mountKey, sensorKey, serviceKey } from './entity-keys.mjs'
import { exportTelemetryBackup, replaceTelemetryBackup } from './backup.mjs'

const HOST_TYPE_SET = new Set(AGENT_HOST_TYPES)
const METRIC_WINDOW = 30
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000
const DEFAULT_ONLINE_MAX_AGE_MS = 90_000

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function timestampMs(value, field) {
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${field} must be a valid timestamp.`)
  return parsed
}

function positiveDuration(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function hostReference(hostType, hostId) {
  if (!HOST_TYPE_SET.has(hostType) || !isRelationalId(hostId)) throw new Error('Telemetry host reference is invalid.')
}

function parseJson(value, fallback = {}) {
  return typeof value === 'string' ? JSON.parse(value) : fallback
}

function lifecycleState(family, value) {
  if (family === 'service') {
    return {
      name: value.name ?? value.key,
      manager: value.manager ?? value.serviceManager ?? 'systemd',
      activeState: value.activeState ?? value.state ?? null,
      subState: value.subState ?? null,
      enabled: value.enabled ?? null,
      classification: value.classification ?? value.scope ?? null,
    }
  }
  if (family === 'container') {
    return {
      runtime: value.runtime,
      runtimeId: value.runtimeId ?? value.id,
      name: value.name ?? null,
      image: value.image ?? null,
      state: value.state ?? null,
      health: value.health ?? null,
      ports: value.ports ?? [],
      networks: value.networks ?? value.network ?? [],
      serviceName: value.serviceName ?? value.composeService ?? null,
    }
  }
  return {
    deviceId: value.deviceId ?? value.device ?? value.key,
    kind: value.kind ?? null,
    state: value.state ?? value.health ?? null,
    warnings: value.warnings ?? [],
  }
}

const FAMILY_CONFIG = Object.freeze({
  services: { table: 'service_states', family: 'service', key: serviceKey },
  containers: { table: 'container_states', family: 'container', key: containerKey },
  filesystems: { table: 'filesystem_mount_states', family: null, key: mountKey },
  gpus: { table: 'gpu_states', family: null, key: gpuKey },
  sensors: { table: 'sensor_states', family: null, key: sensorKey },
  storageHealth: { table: 'storage_health_states', family: 'storage-health', key: deviceKey },
})

function tableKeyParts(name, value) {
  if (name === 'services') return [value.manager ?? value.serviceManager ?? 'systemd', value.name ?? value.key]
  if (name === 'containers') return [value.runtime, value.runtimeId ?? value.id]
  return [FAMILY_CONFIG[name].key(value)]
}

function keyColumns(name) {
  if (name === 'services') return ['service_manager', 'service_key']
  if (name === 'containers') return ['runtime', 'runtime_id']
  return [{ filesystems: 'mount_key', gpus: 'gpu_key', sensors: 'sensor_key', storageHealth: 'device_key' }[name]]
}

export class TelemetryRepository {
  constructor(database) {
    this.database = database
    this.recordTransaction = database.transaction((envelope) => this.#recordEnvelope(envelope))
    this.manualReportTransaction = database.transaction((input) => this.#recordManualInventoryReport(input))
  }

  #upsertLatest(table, columns, values, state, observedAtMs, lifecycleHash = null) {
    const names = ['host_item_id', ...columns, ...(lifecycleHash ? ['lifecycle_hash'] : []), 'state_json', 'updated_at_ms']
    const conflict = ['host_item_id', ...columns].join(', ')
    const updates = [...(lifecycleHash ? ['lifecycle_hash = excluded.lifecycle_hash'] : []), 'state_json = excluded.state_json', 'updated_at_ms = excluded.updated_at_ms']
    this.database.query(`
      INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})
      ON CONFLICT (${conflict}) DO UPDATE SET ${updates.join(', ')}
    `).run(...values, ...(lifecycleHash ? [lifecycleHash] : []), canonicalJson(state), observedAtMs)
  }

  #removeState(name, hostItemId, rawKey, observedAtMs) {
    const config = FAMILY_CONFIG[name]
    const columns = keyColumns(name)
    const parts = String(rawKey).split('\0')
    const where = ['host_item_id = ?', ...columns.map((column) => `${column} = ?`)].join(' AND ')
    const row = this.database.query(`SELECT * FROM ${config.table} WHERE ${where}`).get(hostItemId, ...parts)
    if (!row) return
    if (config.family) {
      this.database.query(`
        INSERT INTO component_events (host_item_id, family, entity_key, event_kind, observed_at_ms, state_hash, state_json)
        VALUES (?, ?, ?, 'removed', ?, ?, NULL)
      `).run(hostItemId, config.family, rawKey, observedAtMs, row.lifecycle_hash)
    }
    this.database.query(`DELETE FROM ${config.table} WHERE ${where}`).run(hostItemId, ...parts)
  }

  #applyFamily(name, hostItemId, delta, observedAtMs) {
    const config = FAMILY_CONFIG[name]
    if (!config || !delta) return { accepted: null, reconcile: false }
    const previous = this.database.query(`
      SELECT revision FROM telemetry_family_revisions WHERE host_item_id = ? AND family = ?
    `).get(hostItemId, name)?.revision ?? 0
    if (delta.revision <= previous) return { accepted: previous, reconcile: false }
    if (!delta.full && delta.revision !== previous + 1) return { accepted: previous, reconcile: true }

    const columns = keyColumns(name)
    const incoming = new Set()
    for (const value of delta.changed) {
      const entityKey = config.key(value)
      const parts = tableKeyParts(name, value)
      incoming.add(entityKey)
      const current = this.database.query(`SELECT ${config.family ? 'lifecycle_hash' : 'NULL AS lifecycle_hash'}, state_json FROM ${config.table} WHERE ${[
        'host_item_id = ?', ...columns.map((column) => `${column} = ?`),
      ].join(' AND ')}`).get(hostItemId, ...parts)
      const semanticHash = config.family ? hash(lifecycleState(config.family, value)) : null
      if (config.family && (!current || current.lifecycle_hash !== semanticHash)) {
        this.database.query(`
          INSERT INTO component_events (host_item_id, family, entity_key, event_kind, observed_at_ms, state_hash, state_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(hostItemId, config.family, entityKey, current ? 'changed' : 'observed', observedAtMs, semanticHash, canonicalJson(value))
      }
      this.#upsertLatest(config.table, columns, [hostItemId, ...parts], value, observedAtMs, semanticHash)
    }
    for (const removed of delta.removed) this.#removeState(name, hostItemId, removed, observedAtMs)

    if (delta.full) {
      const rows = this.database.query(`SELECT ${columns.join(', ')} FROM ${config.table} WHERE host_item_id = ?`).all(hostItemId)
      for (const row of rows) {
        const persistedKey = columns.map((column) => row[column]).join('\0')
        if (!incoming.has(persistedKey)) this.#removeState(name, hostItemId, persistedKey, observedAtMs)
      }
    }
    this.database.query(`
      INSERT INTO telemetry_family_revisions (host_item_id, family, revision, reconciled_at_ms)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (host_item_id, family) DO UPDATE SET revision = excluded.revision, reconciled_at_ms = excluded.reconciled_at_ms
    `).run(hostItemId, name, delta.revision, observedAtMs)
    return { accepted: delta.revision, reconcile: false }
  }

  #recordEnvelope(envelope) {
    const { receipt, metricSample, latest } = envelope
    const storedCapabilityHash = this.database.query('SELECT capabilities_hash FROM agent_capabilities WHERE agent_id = ?').get(receipt.agentId)?.capabilities_hash
    const requestCapabilities = !envelope.capabilities && storedCapabilityHash !== envelope.capabilitiesHash
    const result = this.database.query(`
      INSERT INTO heartbeat_receipts (
        agent_id, host_item_id, host_type, host_id, sequence, collected_at_ms, received_at_ms,
        dropped_samples, agent_version, monitoring_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (agent_id, sequence) DO NOTHING
    `).run(
      receipt.agentId, receipt.hostItemId, receipt.hostType, receipt.hostId, receipt.sequence,
      receipt.collectedAtMs, receipt.receivedAtMs, receipt.droppedSamples, receipt.agentVersion,
      receipt.monitoringRevision,
    )
    if (result.changes === 0) return { duplicate: true, acceptedRevisions: {}, reconcile: [], requestCapabilities }
    this.database.query(`
      DELETE FROM heartbeat_receipts WHERE host_item_id = ? AND id NOT IN (
        SELECT id FROM heartbeat_receipts WHERE host_item_id = ?
        ORDER BY received_at_ms DESC, id DESC LIMIT ${METRIC_WINDOW}
      )
    `).run(receipt.hostItemId, receipt.hostItemId)

    this.database.query(`
      INSERT INTO host_metric_samples (
        host_item_id, minute_bucket_ms, cpu_percent, cpu_idle_percent, cpu_iowait_percent,
        cpu_steal_percent, cpu_system_percent, cpu_user_percent, memory_used_bytes, memory_used_percent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (host_item_id, minute_bucket_ms) DO UPDATE SET
        cpu_percent = excluded.cpu_percent, cpu_idle_percent = excluded.cpu_idle_percent,
        cpu_iowait_percent = excluded.cpu_iowait_percent, cpu_steal_percent = excluded.cpu_steal_percent,
        cpu_system_percent = excluded.cpu_system_percent, cpu_user_percent = excluded.cpu_user_percent,
        memory_used_bytes = excluded.memory_used_bytes, memory_used_percent = excluded.memory_used_percent
    `).run(
      metricSample.hostItemId, metricSample.minuteBucketMs, metricSample.cpu.percent,
      metricSample.cpu.idlePercent, metricSample.cpu.ioWaitPercent, metricSample.cpu.stealPercent,
      metricSample.cpu.systemPercent, metricSample.cpu.userPercent, metricSample.memory.usedBytes,
      metricSample.memory.usedPercent,
    )
    this.database.query(`
      DELETE FROM host_metric_samples WHERE host_item_id = ? AND minute_bucket_ms NOT IN (
        SELECT minute_bucket_ms FROM host_metric_samples WHERE host_item_id = ?
        ORDER BY minute_bucket_ms DESC LIMIT ${METRIC_WINDOW}
      )
    `).run(receipt.hostItemId, receipt.hostItemId)

    if (envelope.capabilities) {
      this.database.query(`
        INSERT INTO agent_capabilities (agent_id, capabilities_hash, capabilities_json, updated_at_ms)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (agent_id) DO UPDATE SET capabilities_hash = excluded.capabilities_hash,
          capabilities_json = excluded.capabilities_json, updated_at_ms = excluded.updated_at_ms
      `).run(receipt.agentId, envelope.capabilitiesHash, canonicalJson(envelope.capabilities), receipt.receivedAtMs)
    }
    if (latest.system) {
      this.database.query(`
        INSERT INTO host_system_facts (host_item_id, facts_json, updated_at_ms) VALUES (?, ?, ?)
        ON CONFLICT (host_item_id) DO UPDATE SET facts_json = excluded.facts_json, updated_at_ms = excluded.updated_at_ms
      `).run(receipt.hostItemId, canonicalJson(latest.system), receipt.receivedAtMs)
      if (Array.isArray(latest.system.storageDevices)) {
        const keys = new Set()
        for (const device of latest.system.storageDevices) {
          const key = deviceKey(device)
          keys.add(key)
          this.#upsertLatest('storage_device_states', ['device_key'], [receipt.hostItemId, key], device, receipt.receivedAtMs)
        }
        for (const row of this.database.query('SELECT device_key FROM storage_device_states WHERE host_item_id = ?').all(receipt.hostItemId)) {
          if (!keys.has(row.device_key)) this.database.query('DELETE FROM storage_device_states WHERE host_item_id = ? AND device_key = ?').run(receipt.hostItemId, row.device_key)
        }
      }
    }
    const load = latest.runtime.loadAverage ?? []
    this.database.query(`
      INSERT INTO host_runtime_state (host_item_id, uptime_seconds, load_1, load_5, load_15, memory_json, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (host_item_id) DO UPDATE SET uptime_seconds = excluded.uptime_seconds,
        load_1 = excluded.load_1, load_5 = excluded.load_5, load_15 = excluded.load_15,
        memory_json = excluded.memory_json, updated_at_ms = excluded.updated_at_ms
    `).run(receipt.hostItemId, latest.runtime.uptimeSeconds, load[0] ?? null, load[1] ?? null, load[2] ?? null, canonicalJson(latest.runtime.memory), receipt.receivedAtMs)

    const acceptedRevisions = {}
    const reconcile = []
    for (const [name, delta] of Object.entries(envelope.deltas)) {
      if (name === 'system') continue
      const applied = this.#applyFamily(name, receipt.hostItemId, delta, receipt.receivedAtMs)
      if (applied.accepted !== null) acceptedRevisions[name] = applied.accepted
      if (applied.reconcile) reconcile.push(name)
    }
    return { duplicate: false, acceptedRevisions, reconcile, requestCapabilities }
  }

  recordEnvelope(envelope) {
    return this.recordTransaction(envelope)
  }

  recordHeartbeat({ deviceId, agentId, hostType, hostId, hostItemId, receivedAt, payload }) {
    hostReference(hostType, hostId)
    const envelope = normalizeTelemetryEnvelope(payload, {
      agentId: agentId ?? deviceId,
      hostItemId: hostItemId ?? hostId,
      receivedAt,
    })
    envelope.receipt.hostType = hostType
    envelope.receipt.hostId = hostId
    return this.recordEnvelope(envelope)
  }

  #recordManualInventoryReport({ agentId, hostItemId, sequence, collectedAt, receivedAt, payload }) {
    if (!isRelationalId(agentId) || !isRelationalId(hostItemId) || !isRelationalId(sequence)) throw new Error('Manual inventory report identity is invalid.')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.components)) throw new Error('Manual inventory report payload is invalid.')
    const payloadJson = canonicalJson(payload)
    const result = this.database.query(`
      INSERT INTO manual_inventory_reports (
        agent_id, host_item_id, sequence, collected_at_ms, received_at_ms, payload_hash, payload_json, complete
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(agentId, hostItemId, sequence, timestampMs(collectedAt, 'collectedAt'), timestampMs(receivedAt, 'receivedAt'), hash(payload), payloadJson)
    const reportId = Number(result.lastInsertRowid)
    const statement = this.database.prepare(`
      INSERT INTO manual_inventory_components (report_id, host_item_id, kind, locator, values_json)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const component of payload.components) {
      statement.run(reportId, hostItemId, String(component.kind), String(component.locator), canonicalJson(component.values ?? {}))
    }
    return { id: reportId, componentCount: payload.components.length }
  }

  recordManualInventoryReport(input) {
    return this.manualReportTransaction(input)
  }

  #latestReceipt(hostType, hostId) {
    return this.database.query(`
      SELECT * FROM heartbeat_receipts WHERE host_type = ? AND host_id = ?
      ORDER BY received_at_ms DESC, id DESC LIMIT 1
    `).get(hostType, hostId)
  }

  #states(table, hostItemId) {
    return this.database.query(`SELECT state_json FROM ${table} WHERE host_item_id = ? ORDER BY state_json`).all(hostItemId).map((row) => parseJson(row.state_json))
  }

  getHostSummary(hostType, hostId) {
    hostReference(hostType, hostId)
    const receipt = this.#latestReceipt(hostType, hostId)
    if (!receipt) return null
    const facts = this.database.query('SELECT * FROM host_system_facts WHERE host_item_id = ?').get(receipt.host_item_id)
    const runtime = this.database.query('SELECT * FROM host_runtime_state WHERE host_item_id = ?').get(receipt.host_item_id)
    const metrics = this.database.query('SELECT * FROM host_metric_samples WHERE host_item_id = ? ORDER BY minute_bucket_ms DESC LIMIT 1').get(receipt.host_item_id)
    const payload = {
      protocolMajor: 1,
      sequence: receipt.sequence,
      agentVersion: receipt.agent_version,
      collectedAt: new Date(receipt.collected_at_ms).toISOString(),
      metrics: {
        uptimeSeconds: runtime?.uptime_seconds ?? null,
        loadAverage: [runtime?.load_1, runtime?.load_5, runtime?.load_15],
        cpu: { percent: metrics?.cpu_percent ?? null },
        memory: { ...parseJson(runtime?.memory_json), usedBytes: metrics?.memory_used_bytes ?? null, usedPercent: metrics?.memory_used_percent ?? null },
        system: parseJson(facts?.facts_json),
        filesystems: this.#states('filesystem_mount_states', receipt.host_item_id),
        gpus: this.#states('gpu_states', receipt.host_item_id),
        sensors: this.#states('sensor_states', receipt.host_item_id),
      },
      services: this.#states('service_states', receipt.host_item_id),
      containers: this.#states('container_states', receipt.host_item_id),
      storageHealth: this.#states('storage_health_states', receipt.host_item_id),
    }
    return {
      id: receipt.id,
      deviceId: receipt.agent_id,
      agentId: receipt.agent_id,
      hostType,
      hostId,
      hostItemId: receipt.host_item_id,
      sequence: receipt.sequence,
      receivedAt: new Date(receipt.received_at_ms).toISOString(),
      collectedAt: new Date(receipt.collected_at_ms).toISOString(),
      agentVersion: receipt.agent_version,
      payload,
      services: payload.services.map((state) => ({ family: 'service', state })),
      containers: payload.containers.map((state) => ({ family: 'container', state })),
      storageHealth: payload.storageHealth.map((state) => ({ family: 'storage-health', state })),
    }
  }

  getSystemsSnapshot(hostItemIds) {
    const ids = [...new Set(hostItemIds)]
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0)
    if (!ids.length) return new Map()
    const requested = ids.map(() => '(?)').join(', ')
    const rows = this.database.query(`
      WITH requested(host_item_id) AS (VALUES ${requested}),
      latest_receipts AS (
        SELECT receipt.*,
          row_number() OVER (
            PARTITION BY receipt.host_item_id
            ORDER BY receipt.received_at_ms DESC, receipt.id DESC
          ) AS position
        FROM heartbeat_receipts receipt
        JOIN requested ON requested.host_item_id = receipt.host_item_id
      ),
      latest_metrics AS (
        SELECT metrics.*,
          row_number() OVER (
            PARTITION BY metrics.host_item_id
            ORDER BY metrics.minute_bucket_ms DESC
          ) AS position
        FROM host_metric_samples metrics
        JOIN requested ON requested.host_item_id = metrics.host_item_id
      ),
      root_filesystems AS (
        SELECT filesystem.host_item_id, filesystem.state_json,
          row_number() OVER (
            PARTITION BY filesystem.host_item_id
            ORDER BY filesystem.updated_at_ms DESC, filesystem.mount_key
          ) AS position
        FROM filesystem_mount_states filesystem
        JOIN requested ON requested.host_item_id = filesystem.host_item_id
        WHERE json_extract(filesystem.state_json, '$.mountPoint') = '/'
      )
      SELECT requested.host_item_id,
        receipt.agent_id,
        receipt.host_type,
        receipt.host_id,
        receipt.sequence,
        receipt.received_at_ms,
        receipt.agent_version,
        metrics.cpu_percent,
        metrics.memory_used_percent,
        runtime.uptime_seconds,
        facts.facts_json,
        filesystem.state_json AS root_filesystem_json
      FROM requested
      LEFT JOIN latest_receipts receipt
        ON receipt.host_item_id = requested.host_item_id AND receipt.position = 1
      LEFT JOIN latest_metrics metrics
        ON metrics.host_item_id = requested.host_item_id AND metrics.position = 1
      LEFT JOIN host_runtime_state runtime
        ON runtime.host_item_id = requested.host_item_id
      LEFT JOIN host_system_facts facts
        ON facts.host_item_id = requested.host_item_id
      LEFT JOIN root_filesystems filesystem
        ON filesystem.host_item_id = requested.host_item_id AND filesystem.position = 1
      ORDER BY requested.host_item_id
    `).all(...ids)

    return new Map(rows.map((row) => [row.host_item_id, {
      hostItemId: row.host_item_id,
      agentId: row.agent_id ?? null,
      hostType: row.host_type ?? null,
      hostId: row.host_id ?? null,
      sequence: row.sequence ?? null,
      receivedAt: row.received_at_ms == null ? null : new Date(row.received_at_ms).toISOString(),
      agentVersion: row.agent_version ?? null,
      cpuPercent: row.cpu_percent ?? null,
      memoryPercent: row.memory_used_percent ?? null,
      uptimeSeconds: row.uptime_seconds ?? null,
      system: parseJson(row.facts_json),
      rootFilesystem: parseJson(row.root_filesystem_json),
    }]))
  }

  listSamples(hostType, hostId, { from = 0, to = Date.now(), limit = METRIC_WINDOW } = {}) {
    hostReference(hostType, hostId)
    const fromMs = timestampMs(from, 'from')
    const toMs = timestampMs(to, 'to')
    if (fromMs > toMs) throw new Error('Telemetry query start must not be after its end.')
    const receipt = this.#latestReceipt(hostType, hostId)
    if (!receipt) return []
    return this.database.query(`
      SELECT * FROM host_metric_samples WHERE host_item_id = ? AND minute_bucket_ms BETWEEN ? AND ?
      ORDER BY minute_bucket_ms DESC LIMIT ?
    `).all(receipt.host_item_id, fromMs, toMs, Math.min(Math.max(Number(limit) || METRIC_WINDOW, 1), METRIC_WINDOW)).reverse().map((row) => ({
      id: row.minute_bucket_ms,
      agentId: receipt.agent_id,
      hostType,
      hostId,
      hostItemId: receipt.host_item_id,
      sequence: receipt.sequence,
      receivedAt: new Date(row.minute_bucket_ms).toISOString(),
      collectedAt: new Date(row.minute_bucket_ms).toISOString(),
      agentVersion: receipt.agent_version,
      payload: { metrics: {
        cpu: {
          percent: row.cpu_percent,
          idlePercent: row.cpu_idle_percent,
          ioWaitPercent: row.cpu_iowait_percent,
          stealPercent: row.cpu_steal_percent,
          systemPercent: row.cpu_system_percent,
          userPercent: row.cpu_user_percent,
        },
        memory: { usedBytes: row.memory_used_bytes, usedPercent: row.memory_used_percent },
      } },
    }))
  }

  getTelemetryView(hostType, hostId, {
    now = Date.now(),
    minutes = METRIC_WINDOW,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    onlineMaxAgeMs = DEFAULT_ONLINE_MAX_AGE_MS,
  } = {}) {
    const boundedMinutes = Math.min(Math.max(Number(minutes) || METRIC_WINDOW, 1), METRIC_WINDOW)
    const interval = positiveDuration(heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS)
    const grace = positiveDuration(onlineMaxAgeMs, DEFAULT_ONLINE_MAX_AGE_MS)
    const latest = this.getHostSummary(hostType, hostId)
    const latestReceivedAt = latest ? Date.parse(latest.receivedAt) : null
    const overdueSlots = latestReceivedAt !== null && now - latestReceivedAt > grace
      ? Math.ceil((now - latestReceivedAt - grace) / interval)
      : 0
    const end = latestReceivedAt === null
      ? Math.floor(now / interval) * interval
      : (Math.floor(latestReceivedAt / interval) * interval) + (overdueSlots * interval)
    const rows = new Map(this.listSamples(hostType, hostId, { from: end - ((boundedMinutes - 1) * interval), to: end, limit: boundedMinutes })
      .map((sample) => [Date.parse(sample.receivedAt), sample]))
    let previous = null
    const buckets = []
    for (let index = boundedMinutes - 1; index >= 0; index -= 1) {
      const at = end - (index * interval)
      const sample = rows.get(at)
      if (sample) previous = sample.payload.metrics
      buckets.push({ at: new Date(at).toISOString(), received: Boolean(sample), metrics: sample?.payload.metrics ?? previous })
    }
    return { buckets, latest }
  }

  deleteHost(hostType, hostId) {
    hostReference(hostType, hostId)
    const receipt = this.#latestReceipt(hostType, hostId)
    if (!receipt) return {}
    const counts = {}
    this.database.transaction(() => {
      for (const table of [
        'agent_field_suggestions', 'manual_inventory_reports', 'virtualization_events', 'latest_virtualization_state',
        'component_events', 'telemetry_family_revisions', 'service_states', 'container_states', 'storage_device_states',
        'filesystem_mount_states', 'gpu_states', 'sensor_states', 'storage_health_states', 'host_metric_samples',
        'host_runtime_state', 'host_system_facts',
      ]) counts[table] = this.database.query(`DELETE FROM ${table} WHERE host_item_id = ?`).run(receipt.host_item_id).changes
      counts.heartbeat_receipts = this.database.query('DELETE FROM heartbeat_receipts WHERE host_item_id = ?').run(receipt.host_item_id).changes
      counts.agent_capabilities = this.database.query('DELETE FROM agent_capabilities WHERE agent_id = ?').run(receipt.agent_id).changes
    })()
    return counts
  }

  exportBackup() {
    return exportTelemetryBackup(this.database)
  }

  replaceBackup(value, currentStores) {
    replaceTelemetryBackup(this.database, value, currentStores)
  }
}
