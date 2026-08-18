import { createHash } from 'node:crypto'
import { isRelationalId } from '../db/relational-ids.mjs'
import { summarizeLocalStorage } from './storage-mounts.mjs'

const CPU_FIELDS = Object.freeze([
  'percent', 'idlePercent', 'ioWaitPercent', 'stealPercent', 'systemPercent', 'userPercent',
])

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function capabilityDigest(capabilities) {
  return createHash('sha256').update(canonicalJson(capabilities ?? {})).digest('hex')
}

function finite(record, key) {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalFinite(record, keys) {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = finite(record, key)
    return value === null ? [] : [[key, value]]
  }))
}

function wholeSeconds(record, key) {
  const value = finite(record, key)
  return value === null ? null : Math.max(0, Math.floor(value))
}

function cpuMetrics(cpu = {}) {
  return Object.fromEntries(CPU_FIELDS.map((field) => [field, finite(cpu, field)]))
}

function memoryMetrics(memory = {}) {
  const usedBytes = finite(memory, 'usedBytes')
  const totalBytes = finite(memory, 'totalBytes')
  return {
    usedBytes,
    usedPercent: finite(memory, 'usedPercent')
      ?? (usedBytes !== null && totalBytes !== null && totalBytes > 0 ? usedBytes * 100 / totalBytes : null),
  }
}

function sensorStates(sensors = []) {
  const cpu = []
  const nvme = new Map()
  for (const sensor of sensors) {
    const temperatureC = finite(sensor, 'temperatureC') ?? finite(sensor, 'temperatureCelsius')
    if (temperatureC === null) continue
    const identity = `${sensor.id ?? ''} ${sensor.name ?? ''} ${sensor.source ?? ''}`.toLowerCase()
    if (/(cpu|package|coretemp|k10temp|core\s)/.test(identity)) cpu.push(temperatureC)
    if (/(nvme|composite)/.test(identity)) {
      const key = String(sensor.source ?? sensor.id ?? sensor.name ?? sensor.key ?? '').trim()
      const normalizedKey = key.toLowerCase().startsWith('nvme:') ? key : `nvme:${key}`
      if (key) nvme.set(normalizedKey, { key: normalizedKey, kind: 'nvme', temperatureC })
    }
  }
  return [
    ...(cpu.length > 0 ? [{ key: 'cpu:average', kind: 'cpu-average', temperatureC: cpu.reduce((sum, value) => sum + value, 0) / cpu.length }] : []),
    ...nvme.values(),
  ]
}

function latestState(metrics = {}, hostname) {
  const storage = summarizeLocalStorage(metrics.filesystems ?? [])
  return {
    system: metrics.system || hostname ? { ...(metrics.system ?? {}), ...(hostname ? { hostname } : {}) } : null,
    runtime: {
      uptimeSeconds: wholeSeconds(metrics, 'uptimeSeconds'),
      loadAverage: Array.isArray(metrics.loadAverage) ? metrics.loadAverage.slice(0, 3) : [],
      memory: {
        totalBytes: finite(metrics.memory, 'totalBytes'),
        availableBytes: finite(metrics.memory, 'availableBytes'),
        cachedBytes: finite(metrics.memory, 'cachedBytes'),
        buffersBytes: finite(metrics.memory, 'buffersBytes'),
        swapTotalBytes: finite(metrics.memory, 'swapTotalBytes'),
        swapUsedBytes: finite(metrics.memory, 'swapUsedBytes'),
        ...optionalFinite(metrics.memory, [
          'freeBytes', 'reclaimableBytes', 'sharedBytes',
          'pageSizeBytes', 'pageCount', 'activePages', 'inactivePages', 'cachePages',
          'laundryPages', 'wiredPages', 'freePages', 'zfsArcBytes',
        ]),
      },
    },
    storage,
    gpus: metrics.gpus ?? [],
    sensors: sensorStates(metrics.sensors ?? []),
  }
}

function fullFamily(revision, changed) {
  return { revision, full: true, changed, removed: [] }
}

export function normalizeTelemetryEnvelope(heartbeat, { agentId, hostItemId, receivedAt }) {
  if (!isRelationalId(agentId) || !isRelationalId(hostItemId)) {
    throw new Error('Telemetry envelope requires canonical agent and host ids.')
  }
  const receivedAtMs = Date.parse(receivedAt)
  const collectedAtMs = Date.parse(heartbeat.collectedAt)
  if (!Number.isSafeInteger(receivedAtMs) || !Number.isSafeInteger(collectedAtMs)) {
    throw new Error('Telemetry envelope timestamps are invalid.')
  }
  const metrics = heartbeat.metrics ?? {}
  const revision = heartbeat.sequence
  const legacy = heartbeat.state === undefined
  const deltas = legacy ? {
    services: fullFamily(revision, heartbeat.services ?? []),
    containers: fullFamily(revision, heartbeat.containers ?? []),
    filesystems: fullFamily(revision, summarizeLocalStorage(metrics.filesystems ?? []).mounts),
    gpus: fullFamily(revision, metrics.gpus ?? []),
    sensors: fullFamily(revision, sensorStates(metrics.sensors ?? [])),
    system: fullFamily(revision, [latestState(metrics, heartbeat.hostname).system]),
    storageHealth: fullFamily(revision, heartbeat.storageHealth ?? []),
  } : {
    ...heartbeat.state,
    ...(heartbeat.state.filesystems ? {
      filesystems: {
        ...heartbeat.state.filesystems,
        changed: summarizeLocalStorage(heartbeat.state.filesystems.changed).mounts,
      },
    } : {}),
    ...(heartbeat.state.sensors ? {
      sensors: { ...heartbeat.state.sensors, changed: sensorStates(heartbeat.state.sensors.changed) },
    } : {}),
  }
  const compactSystem = !legacy && heartbeat.state.system?.changed?.[0]
    ? { ...heartbeat.state.system.changed[0], ...(heartbeat.hostname ? { hostname: heartbeat.hostname } : {}) }
    : null
  return {
    mode: legacy ? 'legacy-full' : 'delta',
    receipt: {
      agentId,
      hostItemId,
      sequence: heartbeat.sequence,
      collectedAtMs,
      receivedAtMs,
      droppedSamples: heartbeat.droppedSamples ?? 0,
      agentVersion: heartbeat.agentVersion,
      monitoringRevision: heartbeat.monitoringRevision ?? 0,
    },
    metricSample: {
      hostItemId,
      minuteBucketMs: Math.floor(receivedAtMs / 60_000) * 60_000,
      cpu: cpuMetrics(metrics.cpu),
      memory: memoryMetrics(metrics.memory),
    },
    latest: { ...latestState(metrics, legacy ? heartbeat.hostname : null), ...(compactSystem ? { system: compactSystem } : {}) },
    deltas,
    capabilities: heartbeat.capabilities,
    capabilitiesHash: heartbeat.capabilitiesHash ?? capabilityDigest(heartbeat.capabilities),
  }
}
