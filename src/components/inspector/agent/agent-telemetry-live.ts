import type { AgentContainer, AgentMetrics, AgentService, AgentTelemetryRange } from '@/types/agent'
import type { ApplicationLiveEvent } from '@/live-events/model'

type EntityPatch = Readonly<{ key: string; set: Record<string, unknown>; unset: readonly string[] }>
type FamilyPatch = Readonly<{
  family: 'services' | 'containers' | 'filesystems' | 'gpus' | 'sensors' | 'storageHealth'
  changes: readonly EntityPatch[]
  removed: readonly string[]
}>

type TelemetryDelta = Readonly<{
  version: 1
  sequence: number
  receivedAt: string
  collectedAt: string
  agentVersion: string
  metricBucket?: AgentTelemetryRange['metricBuckets'][number]
  runtime?: Readonly<{ uptimeSeconds?: number; loadAverage?: number[]; memory?: Record<string, unknown> }>
  system?: Record<string, unknown>
  families?: readonly FamilyPatch[]
  storage?: AgentTelemetryRange['storage']
}>

type TelemetryEventPayload = Readonly<{
  mode: 'delta' | 'resync-required'
  status?: AgentTelemetryRange['status'] | null
  telemetry?: TelemetryDelta | null
}>

function entityKey(family: FamilyPatch['family'], value: Record<string, unknown>) {
  const text = (candidate: unknown) => typeof candidate === 'string' ? candidate.trim() : ''
  if (family === 'services') return `${text(value.manager ?? value.serviceManager) || 'systemd'}\0${text(value.name ?? value.key)}`
  if (family === 'containers') return `${text(value.runtime)}\0${text(value.runtimeId ?? value.id)}`
  if (family === 'filesystems') return text(value.mountPoint ?? value.mount ?? value.key)
  if (family === 'gpus') return text(value.id ?? value.pciAddress ?? value.uuid ?? value.key ?? value.name)
  if (family === 'sensors') return text(value.key ?? value.id ?? value.name)
  return text(value.deviceId ?? value.device ?? value.key ?? value.name)
}

function patchEntities(
  family: FamilyPatch['family'],
  current: readonly Record<string, unknown>[],
  patch: FamilyPatch,
) {
  const values = new Map(current.map((value) => [entityKey(family, value), value]))
  for (const change of patch.changes) {
    const next = { ...(values.get(change.key) ?? {}), ...change.set }
    for (const key of change.unset) delete next[key]
    values.set(change.key, next)
  }
  for (const key of patch.removed) values.delete(key)
  return [...values.values()]
}

function appendMetricBucket(
  current: AgentTelemetryRange['metricBuckets'],
  next: AgentTelemetryRange['metricBuckets'][number],
  intervalMs: number,
) {
  const values = [...current]
  const nextAt = Date.parse(next.at)
  const lastAt = Date.parse(values.at(-1)?.at ?? '')
  if (Number.isFinite(lastAt) && nextAt > lastAt) {
    const previousMetrics = values.at(-1)?.metrics ?? null
    for (let at = lastAt + intervalMs; at < nextAt; at += intervalMs) {
      values.push({ at: new Date(at).toISOString(), received: false, metrics: previousMetrics })
    }
  }
  const existing = values.findIndex((bucket) => bucket.at === next.at)
  if (existing >= 0) values[existing] = next
  else values.push(next)
  return values.sort((left, right) => Date.parse(left.at) - Date.parse(right.at)).slice(-30)
}

function appendOverdueBuckets(current: AgentTelemetryRange, at: string) {
  const state = current.status.state
  if (state !== 'stale' && state !== 'offline') return current.metricBuckets
  const latestReceived = [...current.metricBuckets].reverse().find((bucket) => bucket.received)
  const receivedAt = Date.parse(current.status.lastSeenAt ?? current.latest?.observedAt ?? latestReceived?.at ?? '')
  const now = Date.parse(at)
  if (!Number.isFinite(receivedAt) || !Number.isFinite(now)) return current.metricBuckets
  const overdue = now - receivedAt - current.timing.onlineMaxAgeMs
  if (overdue <= 0) return current.metricBuckets
  const count = Math.ceil(overdue / current.timing.heartbeatIntervalMs)
  const end = Math.floor(receivedAt / current.timing.heartbeatIntervalMs) * current.timing.heartbeatIntervalMs
    + (count * current.timing.heartbeatIntervalMs)
  const last = current.metricBuckets.at(-1)
  const lastAt = Date.parse(last?.at ?? '')
  if (!Number.isFinite(lastAt) || end <= lastAt) return current.metricBuckets
  const values = [...current.metricBuckets]
  for (let bucketAt = lastAt + current.timing.heartbeatIntervalMs; bucketAt <= end; bucketAt += current.timing.heartbeatIntervalMs) {
    values.push({ at: new Date(bucketAt).toISOString(), received: false, metrics: values.at(-1)?.metrics ?? null })
  }
  return values.slice(-30)
}

function mergeLatest(current: AgentTelemetryRange['latest'], delta: TelemetryDelta): NonNullable<AgentTelemetryRange['latest']> {
  const base = current ?? {
    source: 'reconstructed-latest-state' as const,
    observedAt: delta.receivedAt,
    agentVersion: delta.agentVersion,
    sequence: delta.sequence,
    metrics: {},
    services: [],
    containers: [],
    storageHealth: [],
  }
  const metric = delta.metricBucket?.metrics ?? {}
  let filesystems = [...(base.metrics?.filesystems ?? [])]
  let gpus = [...(base.metrics?.gpus ?? [])]
  let sensors = [...(base.metrics?.sensors ?? [])]
  let services = [...(base.services ?? [])]
  let containers = [...(base.containers ?? [])]
  let storageHealth = [...(base.storageHealth ?? [])]
  for (const family of delta.families ?? []) {
    if (family.family === 'services') services = patchEntities(family.family, services, family) as AgentService[]
    else if (family.family === 'containers') containers = patchEntities(family.family, containers, family) as AgentContainer[]
    else if (family.family === 'storageHealth') storageHealth = patchEntities(family.family, storageHealth, family)
    else if (family.family === 'filesystems') filesystems = patchEntities(family.family, filesystems, family)
    else if (family.family === 'gpus') gpus = patchEntities(family.family, gpus, family)
    else if (family.family === 'sensors') sensors = patchEntities(family.family, sensors, family)
  }
  const metrics: AgentMetrics = {
    ...(base.metrics ?? {}),
    ...(delta.runtime?.uptimeSeconds !== undefined ? { uptimeSeconds: delta.runtime.uptimeSeconds } : {}),
    ...(delta.runtime?.loadAverage !== undefined ? { loadAverage: delta.runtime.loadAverage } : {}),
    ...(metric.cpu !== undefined ? { cpu: metric.cpu } : {}),
    ...(delta.runtime?.memory !== undefined || metric.memory !== undefined
      ? { memory: { ...(base.metrics?.memory ?? {}), ...(delta.runtime?.memory ?? {}), ...(metric.memory ?? {}) } }
      : {}),
    ...(delta.system ? { system: delta.system } : {}),
    filesystems,
    gpus,
    sensors,
  }
  return {
    ...base,
    observedAt: delta.receivedAt,
    agentVersion: delta.agentVersion,
    sequence: delta.sequence,
    collectedAt: delta.collectedAt,
    metrics,
    services,
    containers,
    storageHealth,
  }
}

export function mergeAgentTelemetryEvent(current: AgentTelemetryRange, event: ApplicationLiveEvent) {
  const payload = event.payload as TelemetryEventPayload
  if (payload.mode !== 'delta') return null
  const delta = payload.telemetry
  if (!delta) {
    if (!payload.status) return current
    const status = { ...current.status, ...payload.status }
    const withStatus = { ...current, status }
    const metricBuckets = appendOverdueBuckets(withStatus, event.occurredAt)
    return {
      ...withStatus,
      serverTime: event.occurredAt,
      from: metricBuckets[0]?.at ?? current.from,
      to: metricBuckets.at(-1)?.at ?? current.to,
      heartbeatBuckets: metricBuckets.map(({ at, received }) => ({ at, received })),
      metricBuckets,
    }
  }
  const metricBuckets = delta.metricBucket
    ? appendMetricBucket(current.metricBuckets, delta.metricBucket, current.timing.heartbeatIntervalMs)
    : current.metricBuckets
  return {
    ...current,
    serverTime: event.occurredAt,
    status: payload.status ? { ...current.status, ...payload.status } : current.status,
    from: metricBuckets[0]?.at ?? current.from,
    to: metricBuckets.at(-1)?.at ?? current.to,
    heartbeatBuckets: metricBuckets.map(({ at, received }) => ({ at, received })),
    metricBuckets,
    latest: mergeLatest(current.latest, delta),
    ...(delta.storage ? { storage: delta.storage } : {}),
  }
}
