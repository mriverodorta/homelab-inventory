const DEFAULT_BATCH_SIZE = 5_000
const MAX_BATCH_SIZE = 25_000
const DEFAULT_RETENTION_DAYS = 7
const DEFAULT_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000
const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 365

function batchSize(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_BATCH_SIZE)
    : DEFAULT_BATCH_SIZE
}

export function pruneTelemetry(database, {
  samplesBefore,
  eventsBefore = samplesBefore,
  limit = DEFAULT_BATCH_SIZE,
} = {}) {
  const sampleCutoff = Date.parse(samplesBefore)
  const eventCutoff = Date.parse(eventsBefore)
  if (!Number.isSafeInteger(sampleCutoff) || !Number.isSafeInteger(eventCutoff)) {
    throw new Error('Telemetry retention cutoffs must be valid timestamps.')
  }
  const bounded = batchSize(limit)
  return database.transaction(() => {
    const samples = database.prepare(`
      DELETE FROM telemetry_samples WHERE id IN (
        SELECT id FROM telemetry_samples WHERE received_at_ms < ? ORDER BY id LIMIT ?
      )
    `).run(sampleCutoff, bounded).changes
    const events = database.prepare(`
      DELETE FROM component_events WHERE id IN (
        SELECT id FROM component_events WHERE observed_at_ms < ? ORDER BY id LIMIT ?
      )
    `).run(eventCutoff, bounded).changes
    return { samples, events }
  })()
}

export function maintainTelemetry(database) {
  database.exec('PRAGMA wal_checkpoint(PASSIVE);')
  database.exec('PRAGMA optimize;')
}

export function readTelemetryRetentionDays(value = process.env.AGENT_TELEMETRY_RETENTION_DAYS) {
  if (value === undefined || value === null || value === '') return DEFAULT_RETENTION_DAYS
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) {
    throw new Error(`AGENT_TELEMETRY_RETENTION_DAYS must be an integer from ${MIN_RETENTION_DAYS} to ${MAX_RETENTION_DAYS}.`)
  }
  return parsed
}

export function startTelemetryRetentionSchedule(database, {
  retentionDays = readTelemetryRetentionDays(),
  intervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = (error) => console.error('[telemetry] Retention maintenance failed.', error),
} = {}) {
  let stopped = false
  const run = () => {
    if (stopped) return
    try {
      const cutoff = new Date(now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
      pruneTelemetry(database, { samplesBefore: cutoff })
      maintainTelemetry(database)
    } catch (error) {
      onError(error)
    }
  }
  const timer = setIntervalFn(run, intervalMs)
  timer?.unref?.()
  return {
    run,
    stop() {
      stopped = true
      clearIntervalFn(timer)
    },
  }
}
