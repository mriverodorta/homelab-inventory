import type { AgentTelemetrySample } from '@/types/agent'

export const AGENT_HEARTBEAT_WINDOW_MINUTES = 30

const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000
const DEFAULT_ONLINE_MAX_AGE_MS = 90_000
const MAX_CADENCE_JITTER_RATIO = 0.4

export type HeartbeatBucket = {
  minute: number
  actualAt: number | null
  received: boolean
  label: string
}

type HeartbeatBucketOptions = {
  now?: number
  heartbeatIntervalMs?: number
  onlineMaxAgeMs?: number
}

type ParsedHeartbeat = {
  collectedAt: number
  receivedAt: number
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function buildHeartbeatBuckets(
  samples: AgentTelemetrySample[],
  options: HeartbeatBucketOptions = {},
): HeartbeatBucket[] {
  const now = Number.isFinite(options.now) ? options.now as number : Date.now()
  const heartbeatIntervalMs = positiveDuration(options.heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS)
  const onlineMaxAgeMs = positiveDuration(options.onlineMaxAgeMs, DEFAULT_ONLINE_MAX_AGE_MS)
  const parsed = samples.flatMap<ParsedHeartbeat>((sample) => {
    const collectedAt = Date.parse(sample.collectedAt)
    const receivedAt = Date.parse(sample.receivedAt)
    return Number.isFinite(collectedAt) && Number.isFinite(receivedAt)
      ? [{ collectedAt, receivedAt }]
      : []
  }).sort((first, second) => first.collectedAt - second.collectedAt)
  const latest = parsed.at(-1)
  const overdueSlots = latest && now - latest.receivedAt > onlineMaxAgeMs
    ? Math.ceil((now - latest.receivedAt - onlineMaxAgeMs) / heartbeatIntervalMs)
    : 0
  const anchor = latest?.collectedAt ?? now
  const jitterTolerance = heartbeatIntervalMs * MAX_CADENCE_JITTER_RATIO
  const samplesByOffset = new Map<number, ParsedHeartbeat>()

  for (const sample of parsed) {
    const offset = Math.round((sample.collectedAt - anchor) / heartbeatIntervalMs)
    const expectedAt = anchor + (offset * heartbeatIntervalMs)
    if (Math.abs(sample.collectedAt - expectedAt) <= jitterTolerance) {
      samplesByOffset.set(offset, sample)
    }
  }

  return Array.from({ length: AGENT_HEARTBEAT_WINDOW_MINUTES }, (_, index) => {
    const offset = overdueSlots - (AGENT_HEARTBEAT_WINDOW_MINUTES - 1 - index)
    const minute = anchor + (offset * heartbeatIntervalMs)
    const sample = samplesByOffset.get(offset)
    return {
      minute,
      actualAt: sample?.collectedAt ?? null,
      received: Boolean(sample),
      label: new Date(minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    }
  })
}
