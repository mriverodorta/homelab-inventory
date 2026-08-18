import { describe, expect, it } from 'vitest'
import { normalizeTelemetryEnvelope } from './telemetry-envelope.mjs'

const identity = { agentId: 4, hostItemId: 7, receivedAt: '2026-08-16T16:00:30.000Z' }

function heartbeat(overrides = {}) {
  return {
    protocolMajor: 1,
    sequence: 9,
    agentVersion: '0.1.5',
    collectedAt: '2026-08-16T16:00:20.000Z',
    host: { type: 'server', id: 7 },
    capabilities: { 'host.cpu': { state: 'available' } },
    metrics: {
      cpu: { percent: 12.5, idlePercent: 87.5, model: 'static', cores: [{ percent: 12 }] },
      memory: { usedBytes: 25, totalBytes: 100 },
      diskIo: [{ name: 'sda', readBytes: 5 }],
      network: [{ name: 'eth0', receiveBytes: 5 }],
    },
    ...overrides,
  }
}

describe('compact telemetry envelope', () => {
  it('projects legacy heartbeats without historical inventory, disk, or network data', () => {
    const result = normalizeTelemetryEnvelope(heartbeat(), identity)
    expect(result.mode).toBe('legacy-full')
    expect(result.metricSample.cpu).toMatchObject({ percent: 12.5, idlePercent: 87.5 })
    expect(result.metricSample.cpu).not.toHaveProperty('model')
    expect(result.metricSample.cpu).not.toHaveProperty('cores')
    expect(result.metricSample.memory).toEqual({ usedBytes: 25, usedPercent: 25 })
    expect(result.latest).not.toHaveProperty('diskIo')
    expect(result.latest).not.toHaveProperty('network')
  })

  it('preserves compact family deltas', () => {
    const state = {
      containers: {
        revision: 4,
        full: false,
        changed: [{ runtime: 'docker', runtimeId: 'abc', name: 'web', image: 'web:1', state: 'running' }],
        removed: ['docker\0old'],
      },
    }
    const result = normalizeTelemetryEnvelope(heartbeat({ capabilities: undefined, capabilitiesHash: 'a'.repeat(64), state }), identity)
    expect(result.mode).toBe('delta')
    expect(result.deltas.containers).toEqual(state.containers)
    expect(result.capabilities).toBeUndefined()
  })

  it('preserves optional Linux and FreeBSD memory pressure counters in latest state', () => {
    const latestMemory = {
      totalBytes: 1_000, availableBytes: 720,
      freeBytes: 230, buffersBytes: 40, cachedBytes: 450, reclaimableBytes: 20, sharedBytes: 5,
      pageSizeBytes: 4_096, pageCount: 1_000, activePages: 100, inactivePages: 400,
      cachePages: 0, laundryPages: 10, wiredPages: 300, freePages: 100, zfsArcBytes: 200,
    }
    const memory = { ...latestMemory, usedBytes: 280, usedPercent: 28 }
    const result = normalizeTelemetryEnvelope(heartbeat({ metrics: { ...heartbeat().metrics, memory } }), identity)

    expect(result.latest.runtime.memory).toEqual(expect.objectContaining(latestMemory))
  })

  it('requires canonical identities', () => {
    expect(() => normalizeTelemetryEnvelope(heartbeat(), { ...identity, hostItemId: null })).toThrow('canonical agent and host ids')
  })
})
