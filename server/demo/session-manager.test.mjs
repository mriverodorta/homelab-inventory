import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from '../db/store.mjs'
import { DemoSessionManager, DEMO_COOKIE_NAME } from './session-manager.mjs'
import { sanitizeDemoStores } from './sanitizer.mjs'

const tempDirs = []
const activeManagers = []

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-demo-'))
  tempDirs.push(dir)

  return dir
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function demoCookieFrom(response) {
  const cookie = response.headers.get('set-cookie') ?? ''

  return cookie.split(';')[0]
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function createSourceData() {
  const sourceDir = await makeTempDir()

  await writeJson(path.join(sourceDir, 'meta.json'), {
    schemaVersion: 6,
    appLastOpenedWith: '0.1.10',
    updatedAt: '2026-07-09T00:00:00.000Z',
  })
  await writeJson(path.join(sourceDir, 'stores', 'inventory.json'), {
    servers: [{ id: 1, name: 'Private Server', type: 'server', properties: { lanIp: '10.0.0.2' } }],
    cpus: [],
    ram: [],
    storage: [],
    networkCards: [],
    gpus: [],
    nas: [],
    switches: [],
    patchPanels: [],
  })
  await writeJson(path.join(sourceDir, 'stores', 'project.json'), {
    id: 'default',
    metadata: { name: 'Private', version: 1, updatedAt: '2026-07-09T00:00:00.000Z' },
    placements: [{ itemType: 'server', itemId: 1, x: 24, y: 48 }],
    assignments: [],
    connections: [],
  })

  return sourceDir
}

function createManager(options) {
  const manager = new DemoSessionManager(options)
  activeManagers.push(manager)

  return manager
}

afterEach(async () => {
  await Promise.all(activeManagers.splice(0).map((manager) => manager.flushAll().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('demo data sanitizer', () => {
  it('copies only public stores and removes private fields', async () => {
    const sourceDir = await makeTempDir()
    const targetDir = await makeTempDir()

    await writeJson(path.join(sourceDir, 'meta.json'), {
      schemaVersion: 6,
      appLastOpenedWith: '0.1.10',
      lastSeenReleaseNotesVersion: '0.1.10',
      skippedUpdateVersion: '0.1.16',
      lastUpdateCheck: {
        state: 'available',
        channel: 'stable',
        availableVersion: '0.1.16',
        checkedAt: '2026-07-12T12:00:00.000Z',
      },
      updatedAt: '2026-07-09T00:00:00.000Z',
    })
    await writeJson(path.join(sourceDir, 'stores', 'inventory.json'), {
      servers: [
        {
          id: 1,
          name: 'SkyWatch',
          type: 'server',
          specs: {
            manufacturer: 'Dell',
            model: 'OptiPlex Micro 7090',
            serialNumber: 'SECRET-SERIAL',
          },
          properties: {
            name: 'skywatch.local',
            lanIp: '10.10.10.5',
            tailscaleIp: '100.76.116.58',
            notes: 'token=abc123',
          },
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
    await writeJson(path.join(sourceDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: {
        name: 'Private Homelab',
        version: 1,
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
      placements: [{ itemType: 'server', itemId: 1, x: 24, y: 48 }],
      assignments: [],
      connections: [],
    })
    await writeJson(path.join(sourceDir, 'stores', 'agents.json'), {
      enrollments: { secret: { tokenHash: 'hash' } },
      devices: { secret: { tokenHash: 'hash' } },
    })
    await writeJson(path.join(sourceDir, 'stores', 'agent-status.json'), {
      servers: { 1: { hostname: 'skywatch' } },
    })
    await writeJson(path.join(sourceDir, 'backups', 'backup.json'), { private: true })

    await sanitizeDemoStores({ sourceDir, targetDir, appVersion: '0.1.11' })

    const inventory = await readJson(path.join(targetDir, 'stores', 'inventory.json'))
    const project = await readJson(path.join(targetDir, 'stores', 'project.json'))
    const meta = await readJson(path.join(targetDir, 'meta.json'))
    const agents = await readJson(path.join(targetDir, 'stores', 'agents.json'))
    const agentStatus = await readJson(path.join(targetDir, 'stores', 'agent-status.json'))

    expect(inventory.servers[0].name).toBe('Demo Server 1')
    expect(inventory.servers[0].specs.serialNumber).toBeUndefined()
    expect(inventory.servers[0].properties.lanIp).toBe('')
    expect(inventory.servers[0].properties.tailscaleIp).toBe('')
    expect(inventory.servers[0].properties.notes).toBe('')
    expect(project.metadata.name).toBe('Homelab Inventory Demo')
    expect(meta.skippedUpdateVersion).toBeNull()
    expect(meta.lastUpdateCheck).toBeNull()
    expect(agents).toEqual({ enrollments: {}, devices: {} })
    expect(agentStatus).toEqual({ servers: {} })
    await expect(fs.access(path.join(targetDir, 'backups'))).rejects.toThrow()
  })
})

describe('demo API routing contract', () => {
  it('routes project reads and writes to the same cookie session', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
      maxSessions: 100,
      saveDebounceMs: 1,
    })
    await manager.init()

    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use(async (request, response, next) => {
      const cookieHeader = request.get('cookie') ?? ''
      const sessionCookie = cookieHeader
        .split(';')
        .map((value) => value.trim())
        .find((value) => value.startsWith(`${DEMO_COOKIE_NAME}=`))
        ?.split('=')
        .at(1)
      const demo = await manager.getOrCreateSessionStore(sessionCookie)

      response.cookie(DEMO_COOKIE_NAME, demo.sessionId, manager.cookieOptions())
      request.demoStore = demo.store
      request.demoSession = demo.session
      next()
    })
    app.get('/api/project', (request, response) => response.json(request.demoStore.getProject()))
    app.put('/api/project', (request, response) => response.json(request.demoStore.setProject(request.body)))

    const server = app.listen(0)
    const url = await new Promise((resolve) => {
      server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`))
    })

    try {
      const firstResponse = await fetch(`${url}/api/project`)
      const cookie = demoCookieFrom(firstResponse)
      const firstProject = await firstResponse.json()

      expect(cookie).toContain(`${DEMO_COOKIE_NAME}=`)

      const saveResponse = await fetch(`${url}/api/project`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          ...firstProject,
          metadata: { ...firstProject.metadata, name: 'Visitor Demo' },
        }),
      })

      expect(saveResponse.status).toBe(200)

      const secondResponse = await fetch(`${url}/api/project`, {
        headers: { Cookie: cookie },
      })
      const secondProject = await secondResponse.json()

      expect(secondProject.metadata.name).toBe('Visitor Demo')
    } finally {
      await closeServer(server)
    }
  })
})

describe('DemoSessionManager', () => {
  it('creates and reuses a cookie-backed sandbox without mutating source data', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
      maxSessions: 100,
      saveDebounceMs: 1,
    })

    await manager.init()

    const first = await manager.getOrCreateSessionStore(null)
    const firstProject = first.store.getProject()

    expect(first.sessionId).toBeTruthy()
    expect(first.session.dataDir).toBe(path.join(dataDir, 'demo-sessions', first.sessionId))
    expect(first.store).toBeInstanceOf(HomelabInventoryStore)
    expect(firstProject.items['server:1'].name).toBe('Demo Server 1')

    first.store.setProject({
      ...firstProject,
      metadata: { ...firstProject.metadata, name: 'Changed Demo' },
    })
    await first.store.flush()

    const second = await manager.getOrCreateSessionStore(first.sessionId)

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.store.getProject().metadata.name).toBe('Changed Demo')

    const sourceProject = await readJson(path.join(sourceDir, 'stores', 'project.json'))
    expect(sourceProject.metadata.name).toBe('Private')
  })

  it('extends and expires sessions', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
      maxSessions: 100,
      saveDebounceMs: 1,
    })

    await manager.init()
    const created = await manager.getOrCreateSessionStore(null)
    const before = Date.parse(created.session.expiresAt)
    const extended = await manager.extendSession(created.sessionId)

    expect(extended.mode).toBe('demo')
    expect(extended.remainingSeconds).toBeGreaterThan(0)
    expect(Date.parse(extended.expiresAt)).toBeGreaterThan(before)

    await manager.expireSession(created.sessionId)

    expect(await manager.getSession(created.sessionId)).toBeNull()
    await expect(fs.access(created.session.dataDir)).rejects.toThrow()
  })

  it('allows extension during the grace prompt without allowing normal expired access', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
      maxSessions: 100,
      saveDebounceMs: 1,
    })

    await manager.init()
    const created = await manager.getOrCreateSessionStore(null)

    manager.sessions[created.sessionId].expiresAt = new Date(Date.now() - 1000).toISOString()

    expect(await manager.getSession(created.sessionId)).toBeNull()

    const extended = await manager.extendSession(created.sessionId)

    expect(extended.remainingSeconds).toBeGreaterThan(0)

    manager.sessions[created.sessionId].expiresAt = new Date(Date.now() - 31_000).toISOString()

    await expect(manager.extendSession(created.sessionId)).rejects.toThrow('Demo session is expired.')
  })

  it('ignores prototype-like cookie values when looking up sessions', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
      maxSessions: 100,
      saveDebounceMs: 1,
    })

    await manager.init()

    expect(await manager.getSession('__proto__')).toBeNull()
    await expect(manager.extendSession('__proto__')).rejects.toThrow('Demo session is expired.')

    const created = await manager.getOrCreateSessionStore('__proto__')

    expect(created.sessionId).not.toBe('__proto__')
    expect(Object.hasOwn(manager.sessions, created.sessionId)).toBe(true)
  })

  it('enforces the active session cap after expired cleanup', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
      maxSessions: 1,
      saveDebounceMs: 1,
    })

    await manager.init()
    await manager.getOrCreateSessionStore(null)

    await expect(manager.getOrCreateSessionStore(null)).rejects.toThrow('The public demo is temporarily busy.')
  })

  it('validates source data and exposes cookie options', async () => {
    const sourceDir = await makeTempDir()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
      maxSessions: 100,
      saveDebounceMs: 1,
    })

    expect(DEMO_COOKIE_NAME).toBe('homelab_inventory_demo_session')
    expect(manager.cookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    })
    await expect(manager.init()).rejects.toThrow('Demo source data is missing required file:')
  })

  it('rejects invalid source store shapes', async () => {
    const sourceDir = await makeTempDir()
    const dataDir = await makeTempDir()

    await writeJson(path.join(sourceDir, 'meta.json'), {
      schemaVersion: 6,
      appLastOpenedWith: '0.1.10',
      updatedAt: '2026-07-09T00:00:00.000Z',
    })
    await writeJson(path.join(sourceDir, 'stores', 'inventory.json'), {
      servers: [{ id: 1, name: 'Server', type: 'server' }],
    })
    await writeJson(path.join(sourceDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: { name: 'Private', version: 1, updatedAt: '2026-07-09T00:00:00.000Z' },
      placements: [],
      assignments: [],
      connections: [],
    })

    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
      maxSessions: 100,
      saveDebounceMs: 1,
    })

    await expect(manager.init()).rejects.toThrow('Inventory store is missing a cpus array.')
  })
})
