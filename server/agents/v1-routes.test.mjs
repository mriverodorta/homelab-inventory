import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateKeyPairSync, sign } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from '../db/store.mjs'
import { createAgentV1BodyMiddleware, registerAgentV1Routes } from './v1-routes.mjs'
import { AGENT_SIGNATURE_HEADERS, canonicalAgentRequest, sha256Hex } from './signature-auth.mjs'

const tempDirs = []
const activeStores = []

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function createStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-agent-v1-'))
  tempDirs.push(dataDir)
  const seedDir = path.join(dataDir, 'seed')
  await writeJson(path.join(seedDir, 'meta.json'), { schemaVersion: 7, appLastOpenedWith: 'test' })
  await writeJson(path.join(seedDir, 'inventory.json'), {
    servers: [{ id: 1, name: 'Server' }],
    nas: [{ id: 1, name: 'NAS' }],
    pcBuilds: [{ id: 1, name: 'PC' }],
    cpus: [], ram: [], storage: [], networkCards: [], gpus: [], switches: [], patchPanels: [],
  })
  await writeJson(path.join(seedDir, 'project.json'), {
    id: 'default',
    revision: 1,
    metadata: { name: 'Agent test', version: 1, updatedAt: '2026-08-05T00:00:00Z' },
    placements: [], assignments: [], connections: [],
  })
  const store = new HomelabInventoryStore({
    appVersion: 'test', dataDir, seedDir, saveDebounceMs: 1,
    legacyProjectPath: path.join(dataDir, 'legacy.json'),
  })
  await store.init()
  activeStores.push(store)
  return store
}

function createApp(store, options) {
  const app = express()
  app.use('/api/agent/hosts/:hostType/:hostId/heartbeats', createAgentV1BodyMiddleware())
  app.use('/api/agent/hosts/:hostType/:hostId/hardware-snapshots', createAgentV1BodyMiddleware({ maxBytes: 2 << 20, label: 'Hardware snapshot' }))
  app.use(express.json({ limit: '1mb' }))
  registerAgentV1Routes(app, store, options)
  app.use((_error, _request, response, _next) => response.status(500).json({ message: 'Internal error.' }))
  return app
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }))
  })
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
  server.closeAllConnections?.()
}

function identity() {
  const pair = generateKeyPairSync('ed25519')
  return {
    pair,
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }
}

async function enrollAndActivate(url, hostType, hostId, agentIdentity = identity()) {
  const enrollmentResponse = await fetch(`${url}/api/agent/hosts/${hostType}/${hostId}/enrollments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: url }),
  })
  const enrollment = await enrollmentResponse.json()
  const activationResponse = await fetch(`${url}/api/agent/hosts/${hostType}/${hostId}/activate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${enrollment.activationToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      protocolMajor: 1,
      agentVersion: '0.1.0-dev',
      publicKey: agentIdentity.publicKey,
      capabilities: { 'host.cpu': { state: 'available' } },
    }),
  })
  return {
    agentIdentity,
    enrollmentResponse,
    enrollment,
    activationResponse,
    activation: await activationResponse.json(),
  }
}

function signedHeartbeat({ url, hostType, hostId, deviceId, pair, sequence = 1, payload = {}, compress = true }) {
  const pathname = `/api/agent/hosts/${hostType}/${hostId}/heartbeats`
  const timestamp = new Date().toISOString()
  const heartbeat = {
    protocolMajor: 1,
    sequence,
    agentVersion: '0.1.0-dev',
    collectedAt: timestamp,
    host: { type: hostType, id: hostId },
    capabilities: { 'host.cpu': { state: 'available' } },
    metrics: { loadAverage: [0.1, 0.2, 0.3], cpu: { percent: 12.5 } },
    ...payload,
  }
  const encoded = Buffer.from(JSON.stringify(heartbeat))
  const body = compress ? gzipSync(encoded) : encoded
  const bodyDigest = sha256Hex(body)
  const signature = sign(null, canonicalAgentRequest({
    method: 'POST', path: pathname, timestamp, sequence, bodyDigest,
  }), pair.privateKey).toString('base64')
  return fetch(`${url}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      [AGENT_SIGNATURE_HEADERS.deviceId]: String(deviceId),
      [AGENT_SIGNATURE_HEADERS.timestamp]: timestamp,
      [AGENT_SIGNATURE_HEADERS.sequence]: String(sequence),
      [AGENT_SIGNATURE_HEADERS.bodyDigest]: bodyDigest,
      [AGENT_SIGNATURE_HEADERS.signature]: signature,
    },
    body,
  })
}

function signedSnapshot({ url, hostType, hostId, deviceId, pair, sequence, components }) {
  const pathname = `/api/agent/hosts/${hostType}/${hostId}/hardware-snapshots`
  const timestamp = new Date().toISOString()
  const body = Buffer.from(JSON.stringify({
    protocolMajor: 1,
    host: { type: hostType, id: hostId },
    collectedAt: timestamp,
    components,
  }))
  const bodyDigest = sha256Hex(body)
  const signature = sign(null, canonicalAgentRequest({
    method: 'POST', path: pathname, timestamp, sequence, bodyDigest,
  }), pair.privateKey).toString('base64')
  return fetch(`${url}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [AGENT_SIGNATURE_HEADERS.deviceId]: String(deviceId),
      [AGENT_SIGNATURE_HEADERS.timestamp]: timestamp,
      [AGENT_SIGNATURE_HEADERS.sequence]: String(sequence),
      [AGENT_SIGNATURE_HEADERS.bodyDigest]: bodyDigest,
      [AGENT_SIGNATURE_HEADERS.signature]: signature,
    },
    body,
  })
}

afterEach(async () => {
  await Promise.all(activeStores.splice(0).map((store) => store.flush()))
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('agent protocol v1 routes', () => {
  it.each(['server', 'nas', 'pcBuild'])('enrolls, activates, and ingests a signed %s heartbeat', async (hostType) => {
    const store = await createStore()
    const { server, url } = await listen(createApp(store))
    try {
      const enrolled = await enrollAndActivate(url, hostType, 1)
      expect(enrolled.enrollmentResponse.status).toBe(200)
      expect(enrolled.activationResponse.status).toBe(200)
      expect(enrolled.activation).toMatchObject({ deviceId: expect.any(Number), protocolMajor: 1 })

      const heartbeat = await signedHeartbeat({
        url,
        hostType,
        hostId: 1,
        deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair,
      })
      expect(heartbeat.status).toBe(200)
      expect(await heartbeat.json()).toMatchObject({ ok: true, sequence: 1 })
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId]).toMatchObject({
        hostType,
        hostId: 1,
        lastSequence: 1,
      })
      expect(store.databases.agentStatus.data.hosts[`${hostType}:1`]).toMatchObject({
        hostType,
        hostId: 1,
        metrics: { cpu: { percent: 12.5 } },
      })
    } finally {
      await close(server)
    }
  })

  it('rejects cross-host signatures, replay, unsafe containers, and invalid compression without advancing state', async () => {
    const store = await createStore()
    const { server, url } = await listen(createApp(store, { heartbeatRateLimit: 20 }))
    try {
      const enrolled = await enrollAndActivate(url, 'server', 1)
      const first = await signedHeartbeat({ url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId, pair: enrolled.agentIdentity.pair })
      expect(first.status).toBe(200)

      const replay = await signedHeartbeat({ url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId, pair: enrolled.agentIdentity.pair })
      expect(replay.status).toBe(409)

      const unsafe = await signedHeartbeat({
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 2,
        payload: { containers: [{ runtime: 'docker', runtimeId: 'a', name: 'web', image: 'web:1', state: 'running', environment: ['SECRET=x'] }] },
      })
      expect(unsafe.status).toBe(400)
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId].lastSequence).toBe(1)

      const invalidCompression = await signedHeartbeat({
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 2, compress: false,
      })
      expect(invalidCompression.status).toBe(400)
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId].lastSequence).toBe(1)

      const crossHost = await signedHeartbeat({ url, hostType: 'nas', hostId: 1, deviceId: enrolled.activation.deviceId, pair: enrolled.agentIdentity.pair, sequence: 2 })
      expect(crossHost.status).toBe(401)
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId].lastSequence).toBe(1)
    } finally {
      await close(server)
    }
  })

  it('retains only the latest signed hardware snapshot and exposes host-scoped suggestions', async () => {
    const store = await createStore()
    store.databases.inventory.data.ram = [
      { id: 1, name: 'Memory 1' },
      { id: 2, name: 'Memory 2' },
    ]
    store.databases.project.data.assignments = [
      { id: 1, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 1, allocation: { resourceType: 'memory', positions: [0] } },
      { id: 2, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 2, allocation: { resourceType: 'memory', positions: [1] } },
    ]
    const { server, url } = await listen(createApp(store))
    try {
      const enrolled = await enrollAndActivate(url, 'server', 1)
      const first = await signedSnapshot({
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 1,
        components: [
          { kind: 'memory', locator: 'DIMM_A1', values: { manufacturer: 'Micron', serialNumber: 'PRIVATE-1', opaqueFingerprint: 'opaque-1' } },
          { kind: 'memory', locator: 'DIMM_B1', values: { manufacturer: 'Samsung', serialNumber: 'PRIVATE-2', opaqueFingerprint: 'opaque-2' } },
        ],
      })
      expect(first.status).toBe(201)
      const projectRevision = store.databases.project.data.revision
      const result = await fetch(`${url}/api/agent/hosts/server/1/hardware-snapshot`).then((response) => response.json())
      expect(result.snapshot.components).toHaveLength(2)
      expect(result.suggestions.map((suggestion) => suggestion.detectedValue)).toEqual(['Micron', 'Samsung'])
      expect(store.databases.project.data.revision).toBe(projectRevision)

      const second = await signedSnapshot({
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 2,
        components: [{ kind: 'memory', locator: 'DIMM_A1', values: { manufacturer: 'Micron', serialNumber: 'NEW-PRIVATE', opaqueFingerprint: 'opaque-1' } }],
      })
      expect(second.status).toBe(201)
      expect(Object.values(store.databases.agents.data.hardwareSnapshots)).toHaveLength(1)
      expect(Object.values(store.databases.agents.data.hardwareSnapshots)[0].components[0].values.serialNumber).toBe('NEW-PRIVATE')
      expect(JSON.stringify(store.databases.agents.data.hardwareSnapshots)).not.toContain('PRIVATE-2')
      expect(Object.values(store.databases.agents.data.hardwareEvents)).toEqual([
        expect.objectContaining({ componentCountBefore: 2, componentCountAfter: 1, changedKinds: ['memory'] }),
      ])
    } finally {
      await close(server)
    }
  })

  it('rejects replayed and cross-host hardware snapshots without replacing current evidence', async () => {
    const store = await createStore()
    const { server, url } = await listen(createApp(store))
    try {
      const enrolled = await enrollAndActivate(url, 'server', 1)
      const request = {
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 1,
        components: [{ kind: 'motherboard', locator: 'board-1', values: { serialNumber: 'PRIVATE' } }],
      }
      expect((await signedSnapshot(request)).status).toBe(201)
      expect((await signedSnapshot(request)).status).toBe(409)
      expect((await signedSnapshot({ ...request, hostType: 'nas', sequence: 2 })).status).toBe(401)
      expect(Object.values(store.databases.agents.data.hardwareSnapshots)).toHaveLength(1)
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId].lastSequence).toBe(1)
    } finally {
      await close(server)
    }
  })

  it('rolls back snapshot and sequence state when durable persistence fails', async () => {
    const store = await createStore()
    const originalFlush = store.flush.bind(store)
    let failNextAgentFlush = false
    store.flush = async (names) => {
      if (failNextAgentFlush && names?.includes('agents')) {
        failNextAgentFlush = false
        throw new Error('agents persistence unavailable')
      }
      return originalFlush(names)
    }
    const { server, url } = await listen(createApp(store))
    try {
      const enrolled = await enrollAndActivate(url, 'server', 1)
      failNextAgentFlush = true
      const request = {
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 1,
        components: [{ kind: 'motherboard', locator: 'board-1', values: { serialNumber: 'PRIVATE' } }],
      }
      expect((await signedSnapshot(request)).status).toBe(500)
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId].lastSequence).toBe(0)
      expect(store.databases.agents.data.hardwareSnapshots).toEqual({})
      expect(store.databases.agents.data.hardwareEvents).toEqual({})

      expect((await signedSnapshot(request)).status).toBe(201)
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId].lastSequence).toBe(1)
      expect(Object.values(store.databases.agents.data.hardwareSnapshots)).toHaveLength(1)
    } finally {
      await close(server)
      store.flush = originalFlush
    }
  })

  it('returns a bounded host telemetry range without exposing another host', async () => {
    const store = await createStore()
    const listSamples = vi.fn().mockReturnValue([{ id: 1, sequence: 7 }])
    const { server, url } = await listen(createApp(store, { telemetryRepository: { listSamples } }))
    try {
      const response = await fetch(`${url}/api/agent/hosts/server/1/telemetry?from=1000&to=2000&limit=30`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        host: { hostType: 'server', hostId: 1 },
        samples: [{ id: 1, sequence: 7 }],
      })
      expect(listSamples).toHaveBeenCalledWith('server', 1, { from: 1000, to: 2000, limit: 30 })
      expect((await fetch(`${url}/api/agent/hosts/server/1/telemetry?limit=9999`)).status).toBe(400)
      expect((await fetch(`${url}/api/agent/hosts/server/99/telemetry`)).status).toBe(404)
    } finally {
      await close(server)
    }
  })

  it('rate limits signed heartbeats per activated device', async () => {
    const store = await createStore()
    const { server, url } = await listen(createApp(store, { heartbeatRateLimit: 1 }))
    try {
      const enrolled = await enrollAndActivate(url, 'server', 1)
      expect((await signedHeartbeat({
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 1,
      })).status).toBe(200)
      expect((await signedHeartbeat({
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 2,
      })).status).toBe(429)
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId].lastSequence).toBe(1)
    } finally {
      await close(server)
    }
  })

  it('advances device state only after the telemetry sink commits', async () => {
    const store = await createStore()
    const received = []
    const { server, url } = await listen(createApp(store, {
      heartbeatRateLimit: 20,
      heartbeatSink: async (heartbeat) => {
        received.push(heartbeat)
        if (heartbeat.payload.sequence === 2) throw new Error('telemetry unavailable')
      },
    }))
    try {
      const enrolled = await enrollAndActivate(url, 'server', 1)
      const first = await signedHeartbeat({
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 1,
      })
      expect(first.status).toBe(200)
      expect(received[0]).toMatchObject({
        deviceId: enrolled.activation.deviceId,
        hostType: 'server',
        hostId: 1,
        payload: { sequence: 1 },
      })

      const rejected = await signedHeartbeat({
        url, hostType: 'server', hostId: 1, deviceId: enrolled.activation.deviceId,
        pair: enrolled.agentIdentity.pair, sequence: 2,
      })
      expect(rejected.status).toBe(500)
      expect(store.databases.agents.data.devices[enrolled.activation.deviceId].lastSequence).toBe(1)
      expect(store.databases.agentStatus.data.hosts['server:1'].sequence).toBeUndefined()
    } finally {
      await close(server)
    }
  })

  it('revokes the prior device only after a replacement activation validates', async () => {
    const store = await createStore()
    const { server, url } = await listen(createApp(store))
    try {
      const first = await enrollAndActivate(url, 'server', 1)
      const enrollment = await fetch(`${url}/api/agent/hosts/server/1/enrollments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: url }),
      }).then((response) => response.json())
      const rejected = await fetch(`${url}/api/agent/hosts/server/1/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${enrollment.activationToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolMajor: 1, agentVersion: 'bad', publicKey: 'invalid', capabilities: {} }),
      })
      expect(rejected.status).toBe(400)
      expect(store.databases.agents.data.devices[first.activation.deviceId].revokedAt).toBeUndefined()

      const replacement = identity()
      const accepted = await fetch(`${url}/api/agent/hosts/server/1/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${enrollment.activationToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolMajor: 1, agentVersion: '0.1.0-dev', publicKey: replacement.publicKey, capabilities: {} }),
      })
      expect(accepted.status).toBe(200)
      expect(store.databases.agents.data.devices[first.activation.deviceId].revokedAt).toBeTruthy()
    } finally {
      await close(server)
    }
  })

  it('denies every stateful route in demo mode without touching a store', async () => {
    const store = new Proxy({}, { get: () => { throw new Error('disabled routes touched the store') } })
    const { server, url } = await listen(createApp(store, { disabled: true }))
    try {
      for (const [method, pathname] of [
        ['POST', '/api/agent/hosts/server/1/enrollments'],
        ['POST', '/api/agent/hosts/server/1/activate'],
        ['POST', '/api/agent/hosts/server/1/heartbeats'],
        ['POST', '/api/agent/hosts/server/1/hardware-snapshots'],
        ['GET', '/api/agent/hosts/server/1/hardware-snapshot'],
        ['GET', '/api/agent/hosts/server/1/hardware-suggestions'],
        ['GET', '/api/agent/hosts/server/1/telemetry'],
        ['DELETE', '/api/agent/hosts/server/1/registration'],
        ['DELETE', '/api/agent/hosts/server/1/status'],
      ]) {
        const response = await fetch(`${url}${pathname}`, { method })
        expect(response.status).toBe(403)
      }
    } finally {
      await close(server)
    }
  })
})
