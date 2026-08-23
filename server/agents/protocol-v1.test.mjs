import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { normalizeV1Activation, normalizeV1HardwareSnapshot, normalizeV1Heartbeat } from './protocol-v1.mjs'

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
    metrics: {
      loadAverage: [0.1, 0.2, 0.3],
      system: { operatingSystem: 'linux', architecture: 'amd64' },
      cpu: { percent: 10 },
    },
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
      monitoringRevision: 0,
    })
    expect(normalizeV1Heartbeat(heartbeat({ monitoringRevision: 7 }), { hostType: 'server', hostId: 1 })).toMatchObject({ monitoringRevision: 7 })
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

  it('accepts optional enriched service and container summaries', () => {
    expect(normalizeV1Heartbeat(heartbeat({
      services: [{ name: 'docker', activeState: 'active', classification: 'user-installed' }],
      containers: [{
        runtime: 'docker', runtimeId: 'abc', name: 'homarr', image: 'ghcr.io/homarr-labs/homarr:latest', state: 'running',
        status: 'Up 2 hours (healthy)', uptime: '2 hours', composeService: 'homarr', networkMode: 'custom',
        networkNames: ['internal_net'], ports: [{ hostPort: 7575, containerPort: 7575, protocol: 'tcp' }],
      }],
    }))).toMatchObject({
      services: [{ classification: 'user-installed' }],
      containers: [{ uptime: '2 hours', composeService: 'homarr', networkNames: ['internal_net'], ports: [{ hostPort: 7575 }] }],
    })
  })

  it('accepts OpenRC services without fabricating systemd resource counters', () => {
    const normalized = normalizeV1Heartbeat(heartbeat({
      services: [{
        manager: 'openrc', name: 'docker', description: 'Docker daemon', activeState: 'active',
        subState: 'started', enabled: true, classification: 'user-installed',
      }],
    }))
    expect(normalized.services).toEqual([{
      manager: 'openrc', name: 'docker', description: 'Docker daemon', activeState: 'active',
      subState: 'started', enabled: true, classification: 'user-installed',
    }])
    expect(normalized.services[0]).not.toHaveProperty('cpuPercent')
    expect(normalized.services[0]).not.toHaveProperty('memoryCurrentBytes')
    expect(normalized.services[0]).not.toHaveProperty('restartCount')
  })

  it('rejects malformed enriched service and container summaries', () => {
    expect(() => normalizeV1Heartbeat(heartbeat({
      services: [{ name: 'docker', activeState: 'active', classification: 'third-party' }],
    }))).toThrow('classification is invalid')
    expect(() => normalizeV1Heartbeat(heartbeat({
      services: [{ manager: 'runit', name: 'docker', activeState: 'active' }],
    }))).toThrow('manager is invalid')
    expect(() => normalizeV1Heartbeat(heartbeat({
      containers: [{
        runtime: 'docker', runtimeId: 'abc', name: 'web', image: 'example/web:1', state: 'running',
        networkMode: 'internal',
      }],
    }))).toThrow('networkMode is invalid')
    expect(() => normalizeV1Heartbeat(heartbeat({
      containers: [{
        runtime: 'docker', runtimeId: 'abc', name: 'web', image: 'example/web:1', state: 'running',
        ports: [{ hostPort: 0, containerPort: 8080, protocol: 'tcp' }],
      }],
    }))).toThrow('ports[0] is invalid')
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

  it('accepts compact delta heartbeats with a capability digest', () => {
    expect(normalizeV1Heartbeat(heartbeat({
      capabilities: undefined,
      capabilitiesHash: 'a'.repeat(64),
      metrics: { cpu: { percent: 10 }, memory: { usedBytes: 20, totalBytes: 100 } },
      state: {
        containers: {
          revision: 4,
          full: false,
          changed: [{ runtime: 'docker', runtimeId: 'abc', name: 'web', image: 'web:1', state: 'running' }],
          removed: ['docker\0old'],
        },
      },
    }))).toMatchObject({
      capabilitiesHash: 'a'.repeat(64),
      state: { containers: { revision: 4, full: false, removed: ['docker\0old'] } },
    })
  })
})

describe('hardware snapshot normalization', () => {
  it('accepts a bounded typed snapshot for the authenticated host', () => {
    expect(normalizeV1HardwareSnapshot({
      protocolMajor: 1,
      host: { type: 'server', id: 1 },
      collectedAt: '2026-08-05T12:00:00Z',
      components: [{ kind: 'memory', locator: 'DIMM_A1', values: { serialNumber: 'PRIVATE', sizeBytes: 8589934592 } }],
    }, { hostType: 'server', hostId: 1 })).toMatchObject({
      protocolMajor: 1,
      components: [{ kind: 'memory', locator: 'DIMM_A1' }],
    })
  })

  it('rejects cross-host, empty, and unsafe component payloads', () => {
    const base = {
      protocolMajor: 1,
      host: { type: 'server', id: 1 },
      collectedAt: '2026-08-05T12:00:00Z',
      components: [{ kind: 'memory', locator: 'DIMM_A1', values: { sizeBytes: 8589934592 } }],
    }
    expect(() => normalizeV1HardwareSnapshot(base, { hostType: 'server', hostId: 2 })).toThrow('does not match')
    expect(() => normalizeV1HardwareSnapshot({ ...base, components: [] })).toThrow('1 to 1024')
    expect(() => normalizeV1HardwareSnapshot({ ...base, components: [{ kind: '../memory', locator: 'x', values: { size: 1 } }] })).toThrow('kind is invalid')
  })
})
