const MAX_EVENT_PAYLOAD_BYTES = 14 * 1024

export function compactAgentStatus(currentStore, host) {
  const value = currentStore.getAgentStatusSummary({ now: Date.now() }).hosts?.[`${host.hostType}:${host.hostId}`] ?? null
  if (!value) return null
  return Object.fromEntries([
    'hostType', 'hostId', 'state', 'connected', 'ageMs', 'lastSeenAt', 'agentVersion',
    'collectedAt', 'hostname', 'droppedSamples', 'monitoringRevision',
  ].flatMap((key) => value[key] === undefined ? [] : [[key, value[key]]]))
}

function telemetryPayload(host, status, telemetry) {
  return { mode: 'delta', host, status, telemetry }
}

function fitsLivePayload(payload) {
  return Buffer.byteLength(JSON.stringify(payload)) <= MAX_EVENT_PAYLOAD_BYTES
}

function splitTelemetryFamily(host, status, metadata, family) {
  const queue = [family]
  const chunks = []
  while (queue.length > 0) {
    const current = queue.shift()
    const payload = telemetryPayload(host, status, { ...metadata, families: [current] })
    if (fitsLivePayload(payload)) { chunks.push(payload); continue }
    const entries = [
      ...current.changes.map((value) => ({ kind: 'change', value })),
      ...current.removed.map((value) => ({ kind: 'removed', value })),
    ]
    if (entries.length <= 1) return null
    const midpoint = Math.ceil(entries.length / 2)
    for (const half of [entries.slice(0, midpoint), entries.slice(midpoint)]) queue.push({
      family: current.family,
      revision: current.revision,
      changes: half.filter((entry) => entry.kind === 'change').map((entry) => entry.value),
      removed: half.filter((entry) => entry.kind === 'removed').map((entry) => entry.value),
    })
  }
  return chunks
}

export function boundedTelemetryPayloads(host, status, liveTelemetry) {
  if (!liveTelemetry) return [telemetryPayload(host, status, null)]
  const { families = [], ...base } = liveTelemetry
  const first = telemetryPayload(host, status, { ...base, families: [] })
  if (!fitsLivePayload(first)) return [{ mode: 'resync-required', host, status, reason: 'payload-too-large' }]
  const metadata = {
    version: base.version,
    sequence: base.sequence,
    receivedAt: base.receivedAt,
    collectedAt: base.collectedAt,
    agentVersion: base.agentVersion,
  }
  const payloads = [first]
  for (const family of families) {
    const chunks = splitTelemetryFamily(host, status, metadata, family)
    if (!chunks) return [{ mode: 'resync-required', host, status, reason: 'payload-too-large' }]
    payloads.push(...chunks)
  }
  return payloads
}

export { MAX_EVENT_PAYLOAD_BYTES }
