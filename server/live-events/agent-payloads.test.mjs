import { describe, expect, it } from 'vitest'
import { boundedTelemetryPayloads, MAX_EVENT_PAYLOAD_BYTES } from './agent-payloads.mjs'

const host = { hostType: 'server', hostId: 7 }
const status = { state: 'online', connected: true, ageMs: 0 }
const base = {
  version: 1,
  sequence: 10,
  receivedAt: '2026-08-18T14:00:00.000Z',
  collectedAt: '2026-08-18T13:59:59.000Z',
  agentVersion: '0.3.3',
  metricBucket: { at: '2026-08-18T14:00:00.000Z', received: true, metrics: { cpu: { percent: 10 } } },
  runtime: { uptimeSeconds: 100, loadAverage: [0.1, 0.2, 0.3], memory: { totalBytes: 1000 } },
}

describe('Agent live-event payloads', () => {
  it('splits production-shaped entity updates without requesting a full resync', () => {
    const changes = Array.from({ length: 400 }, (_, index) => ({
      key: `systemd\0service-${index}`,
      set: { cpuPercent: index / 10, memoryCurrentBytes: index * 1024 },
      unset: [],
    }))
    const payloads = boundedTelemetryPayloads(host, status, {
      ...base,
      families: [{ family: 'services', revision: 10, changes, removed: [] }],
    })
    expect(payloads.length).toBeGreaterThan(2)
    expect(payloads.every((payload) => payload.mode === 'delta')).toBe(true)
    expect(payloads.every((payload) => Buffer.byteLength(JSON.stringify(payload)) <= MAX_EVENT_PAYLOAD_BYTES)).toBe(true)
    expect(payloads.slice(1).flatMap((payload) => payload.telemetry.families[0].changes)).toHaveLength(400)
  })

  it('uses a compact recovery marker when one entity cannot fit safely', () => {
    const payloads = boundedTelemetryPayloads(host, status, {
      ...base,
      families: [{ family: 'containers', revision: 10, changes: [{ key: 'docker\0large', set: { detail: 'x'.repeat(20_000) }, unset: [] }], removed: [] }],
    })
    expect(payloads).toEqual([{ mode: 'resync-required', host, status, reason: 'payload-too-large' }])
  })
})
