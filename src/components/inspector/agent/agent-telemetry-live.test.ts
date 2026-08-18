import { describe, expect, it } from 'vitest'
import type { AgentTelemetryRange } from '@/types/agent'
import type { ApplicationLiveEvent } from '@/live-events/model'
import { mergeAgentTelemetryEvent } from './agent-telemetry-live'

const current: AgentTelemetryRange = {
  host: { hostType: 'server', hostId: 7 },
  serverTime: '2026-08-18T14:00:00.000Z',
  status: { state: 'online', connected: true, ageMs: 20_000 },
  timing: { heartbeatIntervalMs: 60_000, onlineMaxAgeMs: 90_000, staleMaxAgeMs: 300_000 },
  from: '2026-08-18T13:59:00.000Z',
  to: '2026-08-18T14:00:00.000Z',
  heartbeatBuckets: [{ at: '2026-08-18T13:59:00.000Z', received: true }],
  metricBuckets: [{ at: '2026-08-18T13:59:00.000Z', received: true, metrics: { cpu: { percent: 10 }, memory: { usedPercent: 20 } } }],
  latest: {
    source: 'reconstructed-latest-state',
    observedAt: '2026-08-18T13:59:05.000Z',
    agentVersion: '0.3.3',
    sequence: 9,
    metrics: { cpu: { percent: 10 }, memory: { usedPercent: 20 } },
    services: [{ manager: 'systemd', name: 'docker', activeState: 'active', description: 'Docker' }],
    containers: [],
    storageHealth: [],
  },
}

function event(payload: Record<string, unknown>): ApplicationLiveEvent {
  return {
    version: 1,
    generationId: 'generation',
    sequence: 11,
    topic: 'agent-telemetry:server:7',
    topics: ['agent-telemetry:server:7'],
    kind: 'agent.heartbeat',
    occurredAt: '2026-08-18T14:01:05.000Z',
    payload,
  }
}

describe('Agent telemetry live cache merge', () => {
  it('appends one metric bucket and patches changed entities', () => {
    const merged = mergeAgentTelemetryEvent(current, event({
      mode: 'delta',
      status: { state: 'online', connected: true, ageMs: 0 },
      telemetry: {
        version: 1,
        sequence: 10,
        receivedAt: '2026-08-18T14:01:05.000Z',
        collectedAt: '2026-08-18T14:01:04.000Z',
        agentVersion: '0.3.3',
        metricBucket: { at: '2026-08-18T14:01:00.000Z', received: true, metrics: { cpu: { percent: 30 }, memory: { usedPercent: 40 } } },
        runtime: { uptimeSeconds: 600, loadAverage: [0.1, 0.2, 0.3], memory: { totalBytes: 1000 } },
        families: [{
          family: 'services', revision: 10,
          changes: [{ key: 'systemd\0docker', set: { activeState: 'failed' }, unset: ['description'] }],
          removed: [],
        }],
      },
    }))

    expect(merged?.metricBuckets.at(-1)).toMatchObject({ at: '2026-08-18T14:01:00.000Z', received: true, metrics: { cpu: { percent: 30 } } })
    expect(merged?.latest?.services).toEqual([{ manager: 'systemd', name: 'docker', activeState: 'failed' }])
    expect(merged?.latest?.metrics).toMatchObject({ uptimeSeconds: 600, memory: { totalBytes: 1000, usedPercent: 40 } })
  })

  it('fills a missed minute locally and reserves REST for explicit recovery', () => {
    const merged = mergeAgentTelemetryEvent(current, event({
      mode: 'delta',
      telemetry: {
        version: 1,
        sequence: 11,
        receivedAt: '2026-08-18T14:01:05.000Z',
        collectedAt: '2026-08-18T14:01:04.000Z',
        agentVersion: '0.3.3',
        metricBucket: { at: '2026-08-18T14:01:00.000Z', received: true, metrics: { cpu: { percent: 30 } } },
        runtime: {},
        families: [],
      },
    }))
    expect(merged?.metricBuckets.map((bucket) => [bucket.at, bucket.received])).toEqual([
      ['2026-08-18T13:59:00.000Z', true],
      ['2026-08-18T14:00:00.000Z', false],
      ['2026-08-18T14:01:00.000Z', true],
    ])
    expect(mergeAgentTelemetryEvent(current, event({ mode: 'resync-required' }))).toBeNull()
  })
})
