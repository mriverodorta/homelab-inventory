import { describe, expect, it } from 'vitest'
import type { AgentTelemetrySample } from '@/types/agent'
import { buildHeartbeatBuckets } from './agent-heartbeat-model'

const MINUTE_MS = 60_000

function sample(sequence: number, collectedAt: number, receivedAt = collectedAt): AgentTelemetrySample {
  return {
    id: sequence,
    deviceId: 1,
    hostType: 'server',
    hostId: 1,
    sequence,
    collectedAt: new Date(collectedAt).toISOString(),
    receivedAt: new Date(receivedAt).toISOString(),
    agentVersion: '0.1.6',
    payload: {
      sequence,
      collectedAt: new Date(collectedAt).toISOString(),
      agentVersion: '0.1.6',
      capabilities: {},
      metrics: {},
    },
  }
}

function options(now: number) {
  return { now, heartbeatIntervalMs: MINUTE_MS, onlineMaxAgeMs: 90_000 }
}

describe('agent heartbeat cadence model', () => {
  it('keeps the latest heartbeat on the right across a wall-clock minute boundary', () => {
    const latest = Date.parse('2026-08-08T21:14:55.000Z')
    const samples = Array.from({ length: 30 }, (_, index) => sample(
      index + 1,
      latest - ((29 - index) * MINUTE_MS),
    ))

    const buckets = buildHeartbeatBuckets(samples, options(Date.parse('2026-08-08T21:15:16.000Z')))

    expect(buckets).toHaveLength(30)
    expect(buckets.every((bucket) => bucket.received)).toBe(true)
    expect(buckets.at(-1)?.actualAt).toBe(latest)
  })

  it('matches normal collection jitter to the expected cadence', () => {
    const latest = Date.parse('2026-08-08T21:14:55.000Z')
    const samples = Array.from({ length: 30 }, (_, index) => sample(
      index + 1,
      latest - ((29 - index) * MINUTE_MS) + (index % 2 === 0 ? 8_000 : -7_000),
    ))

    expect(buildHeartbeatBuckets(samples, options(latest + 16_000)).every((bucket) => bucket.received)).toBe(true)
  })

  it('shows a real missing cadence slot without treating shared sequence gaps as misses', () => {
    const latest = Date.parse('2026-08-08T21:14:55.000Z')
    const complete = Array.from({ length: 30 }, (_, index) => sample(
      index < 20 ? index + 1 : index + 2,
      latest - ((29 - index) * MINUTE_MS),
    ))
    expect(buildHeartbeatBuckets(complete, options(latest + 10_000)).every((bucket) => bucket.received)).toBe(true)

    const missing = complete.filter((_, index) => index !== 14)
    const buckets = buildHeartbeatBuckets(missing, options(latest + 10_000))
    expect(buckets.filter((bucket) => !bucket.received)).toHaveLength(1)
  })

  it('appends a missed slot only after the online grace window expires', () => {
    const latest = Date.parse('2026-08-08T21:14:55.000Z')
    const samples = Array.from({ length: 30 }, (_, index) => sample(
      index + 1,
      latest - ((29 - index) * MINUTE_MS),
    ))

    const online = buildHeartbeatBuckets(samples, options(latest + 89_000))
    expect(online.at(-1)?.received).toBe(true)

    const overdue = buildHeartbeatBuckets(samples, options(latest + 91_000))
    expect(overdue.at(-1)?.received).toBe(false)
    expect(overdue.at(-2)?.received).toBe(true)
  })
})
