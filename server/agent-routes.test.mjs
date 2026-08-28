import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeAgentEndpoint, normalizeHeartbeat, publicAgentStatus, registerAgentRoutes } from './agent-routes.mjs'
import { HomelabInventoryStore } from './db/store.mjs'

const tempDirs = []
const activeStores = []

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssi-agent-api-'))
  tempDirs.push(dir)

  return dir
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

async function createTestStore() {
  const dataDir = await makeTempDir()
  const seedDir = path.join(dataDir, 'seed')

  await writeJson(path.join(seedDir, 'meta.json'), {
    schemaVersion: 7,
    appLastOpenedWith: 'test',
    updatedAt: '2026-06-27T00:00:00.000Z',
  })
  await writeJson(path.join(seedDir, 'inventory.json'), {
    servers: [
      {
        id: 1,
        name: 'Server',
      },
      {
        id: 2,
        name: 'Other Server',
      },
    ],
    cpus: [],
    ram: [],
    storage: [],
    networkCards: [],
    gpus: [],
    nas: [],
    switches: [],
    patchPanels: [],
  })
  await writeJson(path.join(seedDir, 'project.json'), {
    id: 'default',
    metadata: {
      name: 'Test',
      version: 1,
      updatedAt: '2026-06-27T00:00:00.000Z',
    },
    placements: [],
    assignments: [],
    connections: [],
  })

  const store = new HomelabInventoryStore({
    appVersion: '1.0.0',
    dataDir,
    legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
    saveDebounceMs: 1,
    seedDir,
  })

  await store.init()
  activeStores.push(store)

  return store
}

function createApp(store, options) {
  const app = express()

  app.use('/api/agent/servers/:serverId/heartbeat', express.json({ limit: '256kb' }))
  app.use(express.json({ limit: '10mb' }))
  registerAgentRoutes(app, store, options)

  return app
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address()

      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections?.()
  })
}

afterEach(async () => {
  await Promise.all(activeStores.splice(0).map((store) => store.flush()))
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('agent routes', () => {
  it('projects a compact public status without duplicating telemetry-heavy server data', () => {
    const status = {
      hostType: 'server', hostId: 7, state: 'online', connected: true, ageMs: 1000,
      lastSeenAt: '2026-08-14T20:00:00.000Z', agentVersion: '0.2.0', hostname: 'lab-node',
      metrics: { system: { operatingSystem: 'Alpine Linux' }, cpu: { percent: 10 }, filesystems: [{ path: '/' }], network: [{ name: 'eth0' }] },
      containers: [{ name: 'app', image: 'example:latest' }],
      services: [{ unit: 'docker.service' }], disks: [{ name: 'nvme0n1' }],
      network: [{ name: 'eth0' }], storageHealth: [{ name: 'nvme0n1' }], motherboard: { model: 'Board' },
    }
    const payload = publicAgentStatus({
      getAgentStatusSummary: () => ({
        hosts: { 'server:7': status }, servers: { 7: status },
        registeredHosts: [{ hostType: 'server', hostId: 7 }], registeredServerIds: [7],
      }),
    })

    expect(payload.servers).toBeUndefined()
    expect(payload.registeredServerIds).toBeUndefined()
    expect(payload.hosts['server:7']).toMatchObject({
      hostType: 'server', hostId: 7, state: 'online', hostname: 'lab-node',
      commandPlatform: 'alpine',
      details: { metrics: true, services: true, containers: true, storage: true, network: true, hardware: true },
    })
    for (const field of ['metrics', 'containers', 'services', 'disks', 'network', 'storageHealth', 'motherboard']) {
      expect(payload.hosts['server:7']).not.toHaveProperty(field)
    }
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(2048)
  })

  it('keeps a multi-host fleet summary compact when internal telemetry arrays are large', () => {
    const services = Array.from({ length: 512 }, (_, index) => ({ unit: `service-${index}.service`, state: 'active' }))
    const containers = Array.from({ length: 512 }, (_, index) => ({ name: `container-${index}`, image: `example/image:${index}` }))
    const hosts = Object.fromEntries(Array.from({ length: 24 }, (_, index) => {
      const hostId = index + 1
      return [`server:${hostId}`, {
        hostType: 'server', hostId, state: 'online', connected: true, ageMs: 1_000,
        lastSeenAt: '2026-08-14T20:00:00.000Z', agentVersion: '0.2.0', hostname: `host-${hostId}`,
        metrics: { cpu: { percent: 10 }, memory: { percent: 20 } }, services, containers,
        storageHealth: Array.from({ length: 32 }, (_, disk) => ({ name: `disk-${disk}` })),
      }]
    }))
    const payload = publicAgentStatus({
      getAgentStatusSummary: () => ({
        hosts,
        servers: Object.fromEntries(Object.entries(hosts).map(([key, value]) => [key.split(':')[1], value])),
        registeredHosts: Array.from({ length: 24 }, (_, index) => ({ hostType: 'server', hostId: index + 1 })),
        registeredServerIds: Array.from({ length: 24 }, (_, index) => index + 1),
      }),
    })

    expect(Object.keys(payload.hosts)).toHaveLength(24)
    expect(payload.servers).toBeUndefined()
    for (const status of Object.values(payload.hosts)) {
      expect(status).not.toHaveProperty('services')
      expect(status).not.toHaveProperty('containers')
      expect(status).not.toHaveProperty('metrics')
      expect(status).not.toHaveProperty('storageHealth')
    }
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(16 * 1024)
  })

  it('accepts only origin-only HTTP(S) agent endpoints', () => {
    expect(normalizeAgentEndpoint('https://inventory.example.test/')).toBe('https://inventory.example.test')
    expect(normalizeAgentEndpoint('http://192.0.2.10:8798')).toBe('http://192.0.2.10:8798')
    expect(() => normalizeAgentEndpoint('ftp://inventory.example.test')).toThrow('HTTP or HTTPS origin')
    expect(() => normalizeAgentEndpoint('https://user:pass@inventory.example.test')).toThrow('without credentials')
    expect(() => normalizeAgentEndpoint('https://inventory.example.test/api')).toThrow('without credentials')
    expect(() => normalizeAgentEndpoint('https://inventory.example.test?x=1')).toThrow('without credentials')
    expect(() => normalizeAgentEndpoint('https://inventory.example.test\nEVIL=1')).toThrow('valid HTTP or HTTPS')
  })

  it('bounds heartbeat telemetry before persistence', () => {
    expect(() => normalizeHeartbeat({ services: Array.from({ length: 513 }, () => ({})) }))
      .toThrow('services exceeds the 512 item limit')
    expect(() => normalizeHeartbeat({ hostname: 'x'.repeat(256) })).toThrow('hostname is too long')
    expect(() => normalizeHeartbeat({ cpu: { value: Number.POSITIVE_INFINITY } })).toThrow('must be finite')
    expect(() => normalizeHeartbeat({ cpu: [] })).toThrow('cpu must be an object')
    expect(() => normalizeHeartbeat({ cpu: { values: Array.from({ length: 1025 }, () => null) } }))
      .toThrow('arrays cannot exceed 1024 items')
    expect(normalizeHeartbeat({ loadAverage: [0.1, 0.2, 0.3] }).loadAverage).toEqual([0.1, 0.2, 0.3])
  })

  it('returns backend-generated upgrade commands for the enrolled host endpoint', async () => {
    const store = await createTestStore()
    const timestamp = new Date().toISOString()
    store.databases.agents.data.enrollments[1] = {
      id: 1,
      hostType: 'server',
      hostId: 1,
      endpoint: 'https://inventory.example.test',
      tokenHash: 'a'.repeat(64),
      protocolMajor: 1,
      createdAt: timestamp,
      expiresAt: '2099-01-01T00:00:00.000Z',
      usedAt: timestamp,
    }
    store.databases.agents.data.devices[1] = {
      id: 1,
      hostType: 'server',
      hostId: 1,
      protocolMajor: 1,
      tokenHash: 'b'.repeat(64),
      publicKey: 'test',
      createdAt: timestamp,
    }
    store.databases.agentStatus.data.hosts['server:1'] = {
      hostType: 'server',
      hostId: 1,
      lastSeenAt: timestamp,
      agentVersion: '0.0.9',
      capabilities: { 'agent.native-update': { state: 'available' } },
      metrics: { system: { operatingSystem: 'Alpine Linux' } },
    }
    const releaseService = {
      current: () => ({ version: '0.1.0', sourceRevision: 'a'.repeat(40) }),
      updateAvailable: () => true,
      upgradeCommands: (endpoint, { native }) => native
        ? { linux: 'sudo homelab-inventory-agent update', alpine: 'homelab-inventory-agent update', freebsd: 'sudo homelab-inventory-agent update' }
        : { linux: `linux:${endpoint}`, alpine: `alpine:${endpoint}`, freebsd: `freebsd:${endpoint}` },
    }
    const { server, url } = await listen(createApp(store, { releaseService }))
    try {
      const response = await fetch(`${url}/api/agent/status`)
      expect(response.status).toBe(200)
      expect((await response.json()).hosts['server:1'].upgradeCommands).toEqual({
        linux: 'sudo homelab-inventory-agent update',
        alpine: 'homelab-inventory-agent update',
        freebsd: 'sudo homelab-inventory-agent update',
      })
      expect((await (await fetch(`${url}/api/agent/status`)).json()).hosts['server:1'].commandPlatform).toBe('alpine')
    } finally {
      await closeServer(server)
    }
  })

  it('returns 403 for disabled enrollment and install script routes without touching the store', async () => {
    const disabledStore = new Proxy({}, {
      get() {
        throw new Error('Disabled agent routes must not touch the store.')
      },
    })
    const app = createApp(disabledStore, { disabled: true })
    const { server, url } = await listen(app)
    const disabledMessage = 'Agent features are disabled in public demo mode.'

    try {
      const enrollmentResponse = await fetch(`${url}/api/agent/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: 1 }),
      })
      const enrollmentBody = await enrollmentResponse.json()

      expect(enrollmentResponse.status).toBe(403)
      expect(enrollmentBody).toEqual({ message: disabledMessage })

      const installResponse = await fetch(`${url}/api/agent/install.sh`)
      const installBody = await installResponse.json()

      expect(installResponse.status).toBe(403)
      expect(installBody).toEqual({ message: disabledMessage })

      const registrationCleanup = await fetch(`${url}/api/agent/servers/1/registration`, { method: 'DELETE' })
      const statusCleanup = await fetch(`${url}/api/agent/servers/1/status`, { method: 'DELETE' })

      expect(registrationCleanup.status).toBe(403)
      expect(statusCleanup.status).toBe(403)
    } finally {
      await closeServer(server)
    }
  })

  it('enrolls, registers, and accepts heartbeat for only the scoped server', async () => {
    const store = await createTestStore()
    const app = createApp(store, { heartbeatRateLimit: 1 })
    const { server, url } = await listen(app)

    try {
      const enrollmentResponse = await fetch(`${url}/api/agent/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 1,
          endpoint: url,
        }),
      })
      const enrollment = await enrollmentResponse.json()
      const token = enrollment.installCommand.match(/--token '([^']+)'/)?.[1]

      expect(enrollmentResponse.status).toBe(200)
      expect(enrollmentResponse.headers.get('cache-control')).toBe('no-store')
      expect(token).toBeTruthy()

      const blockedRegister = await fetch(`${url}/api/agent/servers/2/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentVersion: '0.1.0' }),
      })

      expect(blockedRegister.status).toBe(403)

      const registerResponse = await fetch(`${url}/api/agent/servers/1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentVersion: '0.1.0' }),
      })
      const registration = await registerResponse.json()

      expect(registerResponse.status).toBe(200)
      expect(registerResponse.headers.get('cache-control')).toBe('no-store')
      expect(registration.deviceToken).toBeTruthy()

      const heartbeatResponse = await fetch(`${url}/api/agent/servers/1/heartbeat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${registration.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentVersion: '0.2.0',
          hostname: 'lab-node',
          collectedAt: '2026-06-27T04:00:00Z',
          loadAverage: [0.1, 0.2, 0.3],
          network: [{ name: 'eno1', addresses: ['192.168.1.50'] }],
          memory: { totalBytes: 1024, usedBytes: 512 },
          containers: [
            {
              runtime: 'docker',
              name: 'uptime-kuma',
              image: 'louislam/uptime-kuma:1',
              status: 'Up 2 hours',
              ports: '0.0.0.0:3001->3001/tcp',
            },
          ],
          kubernetes: {
            role: 'worker',
            active: true,
            agentServiceActive: true,
          },
          services: [
            {
              unit: 'docker.service',
              description: 'Docker Application Container Engine',
            },
          ],
          listeningPorts: [
            {
              protocol: 'tcp',
              address: '0.0.0.0',
              port: 3001,
              process: 'users:(("node",pid=100,fd=22))',
            },
          ],
        }),
      })

      expect(heartbeatResponse.status).toBe(200)
      expect(store.getAgentStatusSummary().servers['1'].hostname).toBe('lab-node')
      expect(store.getAgentStatusSummary().servers['1'].state).toBe('online')
      expect(store.getAgentStatusSummary().servers['1'].containers).toHaveLength(1)
      expect(store.getAgentStatusSummary().servers['1'].kubernetes.role).toBe('worker')
      expect(store.getAgentStatusSummary().servers['1'].services[0].unit).toBe('docker.service')
      expect(store.getAgentStatusSummary().servers['1'].listeningPorts[0].port).toBe(3001)

      const rateLimitedHeartbeat = await fetch(`${url}/api/agent/servers/1/heartbeat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${registration.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentVersion: '0.2.0' }),
      })
      expect(rateLimitedHeartbeat.status).toBe(429)
    } finally {
      await closeServer(server)
    }
  })

  it('keeps only the newest enrollment and registered device active for each server', async () => {
    const store = await createTestStore()
    const app = createApp(store)
    const { server, url } = await listen(app)

    const enroll = async () => {
      const response = await fetch(`${url}/api/agent/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: 1, endpoint: url }),
      })
      const body = await response.json()
      return body.installCommand.match(/--token '([^']+)'/)?.[1]
    }
    const register = (token, agentVersion = '0.2.0') => fetch(`${url}/api/agent/servers/1/register`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agentVersion }),
    })

    try {
      const staleEnrollmentToken = await enroll()
      const currentEnrollmentToken = await enroll()

      expect((await register(staleEnrollmentToken)).status).toBe(403)

      const firstRegistration = await register(currentEnrollmentToken)
      const firstDevice = await firstRegistration.json()
      expect(firstRegistration.status).toBe(200)

      const nextEnrollmentToken = await enroll()
      const secondRegistration = await register(nextEnrollmentToken)
      const secondDevice = await secondRegistration.json()
      expect(secondRegistration.status).toBe(200)

      const staleHeartbeat = await fetch(`${url}/api/agent/servers/1/heartbeat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firstDevice.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentVersion: '0.2.0' }),
      })
      const currentHeartbeat = await fetch(`${url}/api/agent/servers/1/heartbeat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secondDevice.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentVersion: '0.2.0' }),
      })

      expect(staleHeartbeat.status).toBe(403)
      expect(currentHeartbeat.status).toBe(200)
      expect(Object.values(store.databases.agents.data.devices).filter((device) => !device.revokedAt)).toHaveLength(1)
    } finally {
      await closeServer(server)
    }
  })

  it('rejects malformed bearer credentials and oversized agent versions', async () => {
    const store = await createTestStore()
    const app = createApp(store)
    const { server, url } = await listen(app)

    try {
      const malformed = await fetch(`${url}/api/agent/servers/1/register`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer short extra',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentVersion: '0.2.0' }),
      })
      expect(malformed.status).toBe(401)

      const enrollmentResponse = await fetch(`${url}/api/agent/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: 1, endpoint: url }),
      })
      const enrollment = await enrollmentResponse.json()
      const token = enrollment.installCommand.match(/--token '([^']+)'/)?.[1]
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

      const oversized = await fetch(`${url}/api/agent/servers/1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentVersion: 'x'.repeat(65) }),
      })
      expect(oversized.status).toBe(400)
    } finally {
      await closeServer(server)
    }
  })

  it('rejects unsafe enrollment endpoints and ignores untrusted forwarded origins', async () => {
    const store = await createTestStore()
    const app = createApp(store)
    const { server, url } = await listen(app)

    try {
      const unsafe = await fetch(`${url}/api/agent/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: 1, endpoint: 'https://inventory.example.test/path?x=1' }),
      })
      expect(unsafe.status).toBe(400)
      expect(Object.keys(store.databases.agents.data.enrollments)).toHaveLength(0)

      const fallback = await fetch(`${url}/api/agent/enrollments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'attacker.example.test',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ serverId: 1 }),
      })
      const enrollment = await fallback.json()

      expect(fallback.status).toBe(200)
      expect(enrollment.endpoint).toBe(url)
      expect(enrollment.installCommand).not.toContain('attacker.example.test')
    } finally {
      await closeServer(server)
    }
  })

  it('rejects oversized heartbeat request bodies before route processing', async () => {
    const store = await createTestStore()
    const app = createApp(store)
    const { server, url } = await listen(app)

    try {
      const response = await fetch(`${url}/api/agent/servers/1/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(300 * 1024) }),
      })

      expect(response.status).toBe(413)
    } finally {
      await closeServer(server)
    }
  })

  it('serves an install script with pass 2 telemetry collectors', async () => {
    const store = await createTestStore()
    const app = createApp(store)
    const { server, url } = await listen(app)

    try {
      const response = await fetch(`${url}/api/agent/install.sh`)
      const script = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(script).toContain('AGENT_VERSION="0.2.0"')
      expect(script).toContain('docker", "ps"')
      expect(script).toContain('podman", "ps"')
      expect(script).toContain('k3s-agent')
      expect(script).toContain('systemctl", "list-units"')
      expect(script).toContain('ss", "-tulpenH"')
      expect(script).not.toContain('source "$CONFIG_FILE"')
      expect(script).toContain("while IFS='=' read -r key value")
      expect(script).toContain('NoNewPrivileges=true')
      expect(script).toContain('ProtectSystem=strict')
      expect(script).toContain('RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6')
    } finally {
      await closeServer(server)
    }
  })

  it('requires explicit registration revocation before clearing runtime status', async () => {
    const store = await createTestStore()
    store.databases.agents.data.devices['1'] = {
      id: 1,
      hostType: 'server',
      hostId: 1,
      tokenHash: 'private-device-token-hash',
      registeredAt: '2026-07-19T00:00:00.000Z',
    }
    store.databases.agentStatus.data.hosts['server:1'] = {
      hostType: 'server',
      hostId: 1,
      hostname: 'lab-node',
      lastSeenAt: '2026-07-19T00:00:00.000Z',
    }
    const app = createApp(store)
    const { server, url } = await listen(app)

    try {
      const blocked = await fetch(`${url}/api/agent/servers/1/status`, { method: 'DELETE' })
      expect(blocked.status).toBe(409)

      const before = store.getInventoryDependencies({ type: 'server', id: 1 })
      expect(before.reasons.map((entry) => entry.kind)).toEqual(['agent-registration', 'agent-status'])
      expect(JSON.stringify(before)).not.toContain('private-device-token-hash')

      const revoked = await fetch(`${url}/api/agent/servers/1/registration`, { method: 'DELETE' })
      const revokedBody = await revoked.json()
      expect(revoked.status).toBe(200)
      expect(revokedBody.revoked).toBe(1)

      const afterRevoke = store.getInventoryDependencies({ type: 'server', id: 1 })
      expect(afterRevoke.reasons.map((entry) => entry.kind)).toEqual(['agent-status'])

      const cleared = await fetch(`${url}/api/agent/servers/1/status`, { method: 'DELETE' })
      expect(cleared.status).toBe(200)
      expect(store.databases.agentStatus.data.hosts['server:1']).toBeUndefined()
      expect(store.getInventoryDependencies({ type: 'server', id: 1 }).blocked).toBe(false)
    } finally {
      await closeServer(server)
    }
  })
})
