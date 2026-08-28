import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function inventoryTables(overrides = {}) {
  return {
    servers: [],
    pcBuilds: [],
    cpus: [],
    ram: [],
    storage: [],
    networkCards: [],
    gpus: [],
    motherboards: [],
    cpuCoolers: [],
    cases: [],
    powerSupplies: [],
    soundCards: [],
    wirelessCards: [],
    powerAdapters: [],
    nas: [],
    switches: [],
    patchPanels: [],
    monitors: [],
    upsSystems: [],
    powerStrips: [],
    ...overrides,
  }
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
    schemaVersion: 7,
    appLastOpenedWith: '0.1.10',
    updatedAt: '2026-07-09T00:00:00.000Z',
  })
  await writeJson(path.join(sourceDir, 'stores', 'inventory.json'), {
    ...inventoryTables(),
    servers: [{
      id: 1,
      name: 'Private Server',
      type: 'server',
      hardwareClass: 'desktop',
      usageRole: 'server',
      properties: { lanIp: '10.0.0.2' },
    }],
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
  const manager = new DemoSessionManager({
    ...options,
    storeFactory: async (session) => {
      const store = new HomelabInventoryStore({
        appVersion: options.appVersion,
        dataDir: session.dataDir,
        legacyProjectPath: path.join(session.dataDir, 'homelab-inventory-project.json'),
        saveDebounceMs: options.saveDebounceMs,
        seedEmptyData: false,
        seedDir: path.join(session.dataDir, 'missing-seed'),
      })
      await store.init()
      return { store, close: () => store.flush() }
    },
  })
  activeManagers.push(manager)

  return manager
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(activeManagers.splice(0).map((manager) => manager.closeAll().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('demo data sanitizer', () => {
  it('copies only public stores and removes private fields', async () => {
    const sourceDir = await makeTempDir()
    const targetDir = await makeTempDir()

    await writeJson(path.join(sourceDir, 'meta.json'), {
      schemaVersion: 7,
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
      ...inventoryTables(),
      servers: [
        {
          id: 1,
          name: 'SkyWatch',
          type: 'server',
          hardwareClass: 'desktop',
          usageRole: 'server',
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
          compatibility: {
            host: {
              storageSlots: [
                {
                  id: 'm2-1',
                  label: 'M.2 slot',
                  count: 1,
                  interfaces: ['NVMe'],
                  formFactors: ['2280'],
                },
              ],
            },
            extension: { retained: true },
          },
        },
      ],
      storage: [
        {
          id: 1,
          name: '1TB NVMe',
          type: 'storage',
          specs: { interface: 'NVMe', formFactor: '2280' },
        },
      ],
      powerStrips: [
        {
          id: 1,
          name: 'Office Kasa Strip',
          type: 'powerStrip',
          smart: {
            enabled: true,
            displayName: 'Rack Strip',
            managementIp: '192.0.2.99',
            macAddress: 'aa:bb:cc:dd:ee:ff',
            outlets: [{ portId: 1, slotNumber: 1, name: 'SkyWatch', customName: 'SkyWatch' }],
          },
          properties: {
            name: 'Office Kasa Strip',
          },
          ports: [{ id: 1, label: 'Jellyfin host', notes: 'rack A', ipAddress: '192.0.2.8' }],
        },
      ],
      monitors: [{ id: 1, type: 'monitor', name: 'Office Display' }],
      upsSystems: [{ id: 1, type: 'ups', name: 'Server Rack UPS' }],
    })
    await writeJson(path.join(sourceDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: {
        name: 'Private Homelab',
        notes: 'Basement rack at 192.0.2.2',
        version: 1,
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
      placements: [{ itemType: 'server', itemId: 1, x: 24, y: 48 }],
      assignments: [
        {
          id: 1,
          hostType: 'server',
          hostId: 1,
          itemType: 'storage',
          itemId: 1,
          type: 'storage',
          assignedAt: '2026-07-09T00:00:00.000Z',
          allocation: {
            resourceType: 'storage',
            groupId: 'm2-1',
            positions: [0],
          },
        },
      ],
      connections: [],
    })
    await writeJson(path.join(sourceDir, 'stores', 'agents.json'), {
      enrollments: { secret: { tokenHash: 'hash' } },
      devices: { secret: { tokenHash: 'hash' } },
    })
    await writeJson(path.join(sourceDir, 'stores', 'agent-status.json'), {
      hosts: {
        'server:1': {
          hostType: 'server',
          hostId: 1,
          hostname: 'skywatch',
          lastSeenAt: '2026-07-09T00:00:00.000Z',
        },
      },
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
    expect(inventory.servers[0].compatibility).toEqual({
      host: {
        storageSlots: [
          {
            id: 'm2-1',
            label: 'M.2 slot',
            count: 1,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
          },
        ],
      },
      extension: { retained: true },
    })
    expect(inventory.powerStrips[0]).toMatchObject({
      name: 'Demo Power Strip 1',
      smart: {
        enabled: true,
        outlets: [{ portId: 1, slotNumber: 1, name: 'Demo outlet 1' }],
      },
      properties: {
        name: 'Demo Power Strip 1',
      },
      ports: [{ id: 1, label: '', notes: '', ipAddress: '' }],
    })
    expect(inventory.monitors[0].name).toBe('Demo Monitor 1')
    expect(inventory.upsSystems[0].name).toBe('Demo UPS 1')
    expect(Object.keys(inventory).sort()).toEqual(Object.keys(inventoryTables()).sort())
    expect(project.assignments[0].allocation).toEqual({
      resourceType: 'storage',
      groupId: 'm2-1',
      positions: [0],
    })
    expect(project.metadata.name).toBe('Homelab Inventory Demo')
    expect(project.metadata.notes).toBe('')
    expect(meta.skippedUpdateVersion).toBeNull()
    expect(meta.lastUpdateCheck).toBeNull()
    expect(agents).toEqual({ enrollments: {}, devices: {}, hardwareSnapshots: {}, hardwareEvents: {} })
    expect(agentStatus).toEqual({ hosts: {} })
    await expect(fs.access(path.join(targetDir, 'backups'))).rejects.toThrow()
  })

  it('preserves bundled fictional compatibility profiles and successful allocations', async () => {
    const sourceDir = await makeTempDir()
    const targetDir = await makeTempDir()
    const sourceStore = new HomelabInventoryStore({
      appVersion: '0.1.26',
      dataDir: sourceDir,
      legacyProjectPath: path.join(sourceDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedDir: path.resolve('server/seed'),
    })

    await sourceStore.init()
    await sourceStore.flush()
    await sanitizeDemoStores({ sourceDir, targetDir, appVersion: '0.1.26' })

    const inventory = await readJson(path.join(targetDir, 'stores', 'inventory.json'))
    const project = await readJson(path.join(targetDir, 'stores', 'project.json'))

    expect(inventory.servers).toHaveLength(4)
    expect(inventory.servers[0].compatibility.host.storageSlots[0]).toMatchObject({
      id: 1,
      key: 'mini-m2',
      interfaces: ['NVMe'],
      formFactors: ['2280'],
    })
    expect(inventory.servers[2].compatibility.host.cpu).toEqual({
      sockets: ['FCLGA1200'],
      maxTdpWatts: 65,
    })
    expect(project.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 1,
        allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
      }),
      expect.objectContaining({ id: 2, itemType: 'cpu' }),
      expect.objectContaining({ id: 3, itemType: 'cpu' }),
      expect.objectContaining({
        id: 4,
        allocation: { resourceType: 'expansion', groupId: 1, positions: [0] },
      }),
    ]))
    expect(project.assignments.find((assignment) => assignment.id === 2).allocation).toBeUndefined()
    expect(project.assignments.find((assignment) => assignment.id === 3).allocation).toEqual({
      resourceType: 'cpu',
      positions: [0],
    })
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

    const server = app.listen(0, '127.0.0.1')
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
  it('bootstraps the verified catalog once and reuses the persisted snapshot after reopening', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const activatedAt = '2026-07-28T20:00:00.000Z'
    const catalogBootstrap = vi.fn(async (store) => {
      store.registryTransaction((draft) => {
        draft.sources.push({
          id: 1,
          kind: 'official-connected',
          displayName: 'Official Homelab Inventory Catalog',
          activeRevision: 3,
          lastCheckedAt: activatedAt,
          lastSuccessAt: activatedAt,
          lastErrorAt: null,
          lastError: null,
        })
        draft.snapshot = {
          sourceId: 1,
          revision: 3,
          generatedAt: activatedAt,
          expiresAt: null,
          activatedAt,
          digest: 'a'.repeat(64),
          templateCount: 1,
          keyId: 'registry-2026-01',
        }
      })
      await store.flush()
    })
    const manager = createManager({
      appVersion: '0.4.3',
      dataDir,
      sourceDir,
      catalogBootstrap,
      saveDebounceMs: 1,
    })

    await manager.init()
    const first = await manager.getOrCreateSessionStore(null)

    expect(catalogBootstrap).toHaveBeenCalledOnce()
    expect(first.store.getRegistryState().snapshot).toMatchObject({
      revision: 3,
      keyId: 'registry-2026-01',
    })

    manager.stores.delete(first.sessionId)
    const reopened = await manager.openStore(first.session)

    expect(reopened).not.toBe(first.store)
    expect(reopened.getRegistryState().snapshot).toMatchObject({ revision: 3 })
    expect(catalogBootstrap).toHaveBeenCalledOnce()
  })

  it('shares one catalog bootstrap across concurrent opens of the same session', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.4.3',
      dataDir,
      sourceDir,
      saveDebounceMs: 1,
    })

    await manager.init()
    const created = await manager.getOrCreateSessionStore(null)
    manager.stores.delete(created.sessionId)

    let finishBootstrap
    const bootstrapGate = new Promise((resolve) => {
      finishBootstrap = resolve
    })
    manager.catalogBootstrap = vi.fn(() => bootstrapGate)

    const firstOpen = manager.openStore(created.session)
    const secondOpen = manager.openStore(created.session)
    await vi.waitFor(() => expect(manager.catalogBootstrap).toHaveBeenCalledOnce())
    finishBootstrap()
    const [firstStore, secondStore] = await Promise.all([firstOpen, secondOpen])

    expect(firstStore).toBe(secondStore)
    expect(manager.catalogBootstrap).toHaveBeenCalledOnce()
  })

  it('keeps the demo usable when automatic catalog bootstrap fails', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const logger = { warn: vi.fn() }
    const catalogBootstrap = vi.fn(async () => {
      throw new Error('Registry unavailable at https://private.example.test')
    })
    const manager = createManager({
      appVersion: '0.4.3',
      dataDir,
      sourceDir,
      catalogBootstrap,
      logger,
      saveDebounceMs: 1,
    })

    await manager.init()
    const created = await manager.getOrCreateSessionStore(null)

    expect(catalogBootstrap).toHaveBeenCalledOnce()
    expect(created.store.getRegistryState()).toMatchObject({
      settings: { mode: 'connected', automaticContributions: false },
      snapshot: null,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Automatic demo catalog refresh failed; manual refresh remains available.',
    )
  })

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
    expect(first.store.getRegistryState().settings).toMatchObject({
      mode: 'connected',
      automaticContributions: false,
    })

    first.store.setProject({
      ...firstProject,
      metadata: { ...firstProject.metadata, name: 'Changed Demo' },
    })
    await first.store.flush()

    const second = await manager.getOrCreateSessionStore(first.sessionId)

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.store.getProject().metadata.name).toBe('Changed Demo')
    expect(second.store.getRegistryState().settings).toMatchObject({
      mode: 'connected',
      automaticContributions: false,
    })

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

  it('never trusts persisted session IDs or data paths during cleanup', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const outsideDir = await makeTempDir()
    const markerPath = path.join(outsideDir, 'keep.txt')
    const validId = 'A'.repeat(32)
    const sessionsDir = path.join(dataDir, 'demo-sessions')
    await fs.writeFile(markerPath, 'keep')
    await writeJson(path.join(sessionsDir, 'index.json'), {
      [validId]: {
        id: validId,
        createdAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2026-07-01T00:01:00.000Z',
        lastSeenAt: '2026-07-01T00:00:00.000Z',
        dataDir: outsideDir,
      },
      '../outside': {
        id: '../outside',
        createdAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2099-07-01T00:01:00.000Z',
        dataDir: outsideDir,
      },
    })
    const manager = createManager({ appVersion: '0.1.11', dataDir, sourceDir, saveDebounceMs: 1 })

    await manager.init()

    expect(await fs.readFile(markerPath, 'utf8')).toBe('keep')
    expect(Object.keys(manager.sessions)).toEqual([])
    expect(await readJson(manager.indexPath)).toEqual({})
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

  it('serializes concurrent creation so the active session cap cannot be exceeded', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      maxSessions: 1,
      saveDebounceMs: 1,
    })

    await manager.init()
    const results = await Promise.allSettled([
      manager.getOrCreateSessionStore(null, { clientKey: '198.51.100.1' }),
      manager.getOrCreateSessionStore(null, { clientKey: '198.51.100.2' }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(Object.keys(manager.sessions)).toHaveLength(1)
    expect(Object.keys(await readJson(manager.indexPath))).toHaveLength(1)
  })

  it('rate limits new sandboxes per client without blocking a valid existing session', async () => {
    const sourceDir = await createSourceData()
    const dataDir = await makeTempDir()
    const manager = createManager({
      appVersion: '0.1.11',
      dataDir,
      sourceDir,
      maxSessionCreationsPerClient: 1,
      maxSessionCreationsGlobally: 10,
      saveDebounceMs: 1,
    })

    await manager.init()
    const created = await manager.getOrCreateSessionStore(null, { clientKey: '198.51.100.8' })

    await expect(
      manager.getOrCreateSessionStore(null, { clientKey: '198.51.100.8' }),
    ).rejects.toMatchObject({ status: 429 })

    const reused = await manager.getOrCreateSessionStore(created.sessionId, { clientKey: '198.51.100.8' })
    expect(reused.sessionId).toBe(created.sessionId)
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
    vi.stubEnv('NODE_ENV', 'production')
    expect(manager.cookieOptions().secure).toBe(true)
    vi.stubEnv('DEMO_COOKIE_SECURE', 'false')
    expect(manager.cookieOptions().secure).toBe(false)
    await expect(manager.init()).rejects.toThrow('Demo source data is missing required file:')
  })

  it('rejects invalid source store shapes', async () => {
    const sourceDir = await makeTempDir()
    const dataDir = await makeTempDir()

    await writeJson(path.join(sourceDir, 'meta.json'), {
      schemaVersion: 7,
      appLastOpenedWith: '0.1.10',
      updatedAt: '2026-07-09T00:00:00.000Z',
    })
    await writeJson(path.join(sourceDir, 'stores', 'inventory.json'), {
      servers: [{
        id: 1,
        name: 'Server',
        type: 'server',
        hardwareClass: 'desktop',
        usageRole: 'server',
      }],
      pcBuilds: [],
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

  it('rebuilds a stale existing session that is missing current inventory tables', async () => {
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
    await manager.flushAll()
    manager.stores.delete(first.sessionId)

    const inventoryPath = path.join(first.session.dataDir, 'stores', 'inventory.json')
    const inventory = await readJson(inventoryPath)
    delete inventory.pcBuilds
    await writeJson(inventoryPath, inventory)

    const rebuilt = await manager.getOrCreateSessionStore(first.sessionId)

    expect(rebuilt.sessionId).not.toBe(first.sessionId)
    expect((await readJson(path.join(rebuilt.session.dataDir, 'stores', 'inventory.json'))).pcBuilds).toEqual([])
  })
})
