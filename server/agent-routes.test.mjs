import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAgentRoutes } from './agent-routes.mjs'
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
    schemaVersion: 3,
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

  app.use(express.json({ limit: '10mb' }))
  registerAgentRoutes(app, store, options)

  return app
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address()

      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

afterEach(async () => {
  await Promise.all(activeStores.splice(0).map((store) => store.flush()))
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('agent routes', () => {
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
    } finally {
      server.close()
    }
  })

  it('enrolls, registers, and accepts heartbeat for only the scoped server', async () => {
    const store = await createTestStore()
    const app = createApp(store)
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
    } finally {
      server.close()
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
      expect(script).toContain('AGENT_VERSION="0.2.0"')
      expect(script).toContain('docker", "ps"')
      expect(script).toContain('podman", "ps"')
      expect(script).toContain('k3s-agent')
      expect(script).toContain('systemctl", "list-units"')
      expect(script).toContain('ss", "-tulpenH"')
    } finally {
      server.close()
    }
  })
})
