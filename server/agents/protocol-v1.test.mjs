import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { normalizeV1Activation, normalizeV1Heartbeat } from './protocol-v1.mjs'

function publicKey() {
  return generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
}

function heartbeat(overrides = {}) {
  return {
    protocolMajor: 1,
    sequence: 1,
    agentVersion: '0.1.0-dev',
    collectedAt: '2026-08-05T20:00:00.000Z',
    host: { type: 'server', id: 1 },
    capabilities: { 'host.cpu': { state: 'available' } },
    metrics: { loadAverage: [0.1, 0.2, 0.3], cpu: { percent: 10 } },
    ...overrides,
  }
}

describe('agent protocol v1 normalization', () => {
  it('accepts valid activation and heartbeat payloads', () => {
    expect(normalizeV1Activation({
      protocolMajor: 1,
      agentVersion: '0.1.0-dev',
      publicKey: publicKey(),
      capabilities: { 'host.cpu': { state: 'available' } },
    })).toMatchObject({ protocolMajor: 1, agentVersion: '0.1.0-dev' })
    expect(normalizeV1Heartbeat(heartbeat(), { hostType: 'server', hostId: 1 })).toMatchObject({
      sequence: 1,
      host: { type: 'server', id: 1 },
    })
  })

  it('rejects unsupported protocols, cross-host payloads, and nonfinite metrics', () => {
    expect(() => normalizeV1Heartbeat(heartbeat({ protocolMajor: 2 }))).toThrow('Unsupported agent protocol')
    expect(() => normalizeV1Heartbeat(heartbeat(), { hostType: 'nas', hostId: 1 })).toThrow('does not match')
    expect(() => normalizeV1Heartbeat(heartbeat({ metrics: { cpu: { percent: Infinity } } }))).toThrow('finite')
  })

  it('rejects forbidden container fields before persistence', () => {
    expect(() => normalizeV1Heartbeat(heartbeat({
      containers: [{
        runtime: 'docker',
        runtimeId: 'abc',
        name: 'web',
        image: 'example/web:1',
        state: 'running',
        environment: ['TOKEN=secret'],
      }],
    }))).toThrow('forbidden field environment')
  })

  it('uses explicit unavailable capability states instead of coercing them to zero', () => {
    expect(normalizeV1Heartbeat(heartbeat({
      capabilities: { 'host.gpu': { state: 'permission-blocked', detail: 'Device access denied' } },
      metrics: {},
    }))).toMatchObject({
      capabilities: { 'host.gpu': { state: 'permission-blocked' } },
      metrics: {},
    })
  })
})
