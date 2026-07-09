import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from './store.mjs'

const tempDirs = []

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssi-lowdb-'))
  tempDirs.push(dir)

  return dir
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('HomelabInventoryStore', () => {
  it('seeds a new data directory from bundled store files', async () => {
    const dataDir = await makeTempDir()
    const seedDir = path.join(dataDir, 'seed')

    await writeJson(path.join(seedDir, 'meta.json'), {
      schemaVersion: 3,
      appLastOpenedWith: 'seed',
      updatedAt: '2026-06-26T00:00:00.000Z',
    })
    await writeJson(path.join(seedDir, 'inventory.json'), {
      servers: [
        {
          id: 1,
          name: 'Server',
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
        name: 'Seeded',
        version: 1,
        updatedAt: '2026-06-26T00:00:00.000Z',
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
    await store.flush()

    expect(store.getProject().items['server:1'].name).toBe('Server')
    expect(store.databases.meta.data.lastSeenReleaseNotesVersion).toBe('1.0.0')
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'stores', 'inventory.json'), 'utf8'))).toEqual({
      servers: [
        {
          id: 1,
          name: 'Server',
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
  })

  it('creates empty stores when seed data is disabled', async () => {
    const dataDir = await makeTempDir()

    const store = new HomelabInventoryStore({
      appVersion: '1.0.0',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    await store.flush()

    expect(store.getProject().items).toEqual({})
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'stores', 'inventory.json'), 'utf8'))).toEqual({
      servers: [],
      cpus: [],
      ram: [],
      storage: [],
      networkCards: [],
      gpus: [],
      nas: [],
      switches: [],
      patchPanels: [],
    })
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'stores', 'project.json'), 'utf8'))).toMatchObject({
      id: 'default',
      metadata: {
        name: 'Homelab Inventory',
        version: 1,
      },
      placements: [],
      assignments: [],
      connections: [],
    })
  })

  it('splits an old single-file project into lowdb stores', async () => {
    const dataDir = await makeTempDir()
    const seedDir = path.join(dataDir, 'seed')
    const legacyPath = path.join(dataDir, 'homelab-inventory-project.json')

    await fs.mkdir(seedDir, { recursive: true })
    await writeJson(legacyPath, {
      id: 'default',
      metadata: {
        name: 'Legacy',
        version: 1,
        updatedAt: '2026-06-26T00:00:00.000Z',
      },
      items: {
        switch: {
          id: 'switch',
          name: 'Switch',
          type: 'switch',
        },
      },
      placements: [{ serverId: 'switch', x: 24, y: 48 }],
      assignments: [],
      connections: [],
    })

    const store = new HomelabInventoryStore({
      appVersion: '1.0.0',
      dataDir,
      legacyProjectPath: legacyPath,
      saveDebounceMs: 1,
      seedDir,
    })

    await store.init()
    await store.flush()

    expect(store.getProject().items['switch:1'].type).toBe('switch')
    expect(store.getProject().placements).toEqual([{ serverId: 'switch:1', x: 24, y: 48 }])
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'stores', 'project.json'), 'utf8')).items).toBeUndefined()
  })

  it('flushes project updates to split stores', async () => {
    const dataDir = await makeTempDir()
    const seedDir = path.join(dataDir, 'seed')

    await writeJson(path.join(seedDir, 'meta.json'), {
      schemaVersion: 3,
      appLastOpenedWith: 'seed',
      updatedAt: '2026-06-26T00:00:00.000Z',
    })
    await writeJson(path.join(seedDir, 'inventory.json'), {
      servers: [],
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
        name: 'Project',
        version: 1,
        updatedAt: '2026-06-26T00:00:00.000Z',
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
    store.setProject({
      ...store.getProject(),
      items: {
        'server:1': {
          id: 1,
          key: 'server:1',
          name: 'Updated Server',
          type: 'server',
        },
      },
      placements: [{ serverId: 'server:1', x: 72, y: 96 }],
    })
    await store.flush()

    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'stores', 'inventory.json'), 'utf8')).servers[0].name).toBe('Updated Server')
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'stores', 'project.json'), 'utf8')).placements).toEqual([
      { itemType: 'server', itemId: 1, x: 72, y: 96 },
    ])
  })

  it('initializes release-note acknowledgement to the current version on fresh empty data', async () => {
    const dataDir = await makeTempDir()

    const store = new HomelabInventoryStore({
      appVersion: '0.1.10',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    await store.flush()

    expect(store.databases.meta.data.lastSeenReleaseNotesVersion).toBe('0.1.10')
    expect(store.getReleaseNotesStatus([
      {
        version: '0.1.10',
        date: '2026-07-09',
        channel: 'stable',
        title: 'Current',
        highlights: ['Current note'],
        fixes: [],
      },
    ])).toMatchObject({
      currentVersion: '0.1.10',
      lastSeenVersion: '0.1.10',
      hasUnseen: false,
      entries: [],
    })
  })

  it('uses the previous app version when existing data has no release-note acknowledgement', async () => {
    const dataDir = await makeTempDir()

    await writeJson(path.join(dataDir, 'meta.json'), {
      schemaVersion: 3,
      appLastOpenedWith: '0.1.8',
      updatedAt: '2026-07-08T00:00:00.000Z',
    })
    await writeJson(path.join(dataDir, 'stores', 'inventory.json'), {
      servers: [],
      cpus: [],
      ram: [],
      storage: [],
      networkCards: [],
      gpus: [],
      nas: [],
      switches: [],
      patchPanels: [],
    })
    await writeJson(path.join(dataDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: {
        name: 'Project',
        version: 1,
        updatedAt: '2026-07-08T00:00:00.000Z',
      },
      placements: [],
      assignments: [],
      connections: [],
    })

    const store = new HomelabInventoryStore({
      appVersion: '0.1.10',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()

    const status = store.getReleaseNotesStatus([
      {
        version: '0.1.10',
        date: '2026-07-09',
        channel: 'stable',
        title: 'Current',
        highlights: ['Current note'],
        fixes: [],
      },
      {
        version: '0.1.9',
        date: '2026-07-08',
        channel: 'stable',
        title: 'Previous',
        highlights: ['Previous note'],
        fixes: [],
      },
    ])

    expect(store.databases.meta.data.lastSeenReleaseNotesVersion).toBe('0.1.8')
    expect(status).toMatchObject({
      currentVersion: '0.1.10',
      lastSeenVersion: '0.1.8',
      hasUnseen: true,
    })
    expect(status.entries.map((entry) => entry.version)).toEqual(['0.1.9', '0.1.10'])
  })

  it('falls back to the current version when existing data has no previous app version', async () => {
    const dataDir = await makeTempDir()

    await writeJson(path.join(dataDir, 'meta.json'), {
      schemaVersion: 3,
      updatedAt: '2026-07-08T00:00:00.000Z',
    })
    await writeJson(path.join(dataDir, 'stores', 'inventory.json'), {
      servers: [],
      cpus: [],
      ram: [],
      storage: [],
      networkCards: [],
      gpus: [],
      nas: [],
      switches: [],
      patchPanels: [],
    })
    await writeJson(path.join(dataDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: {
        name: 'Project',
        version: 1,
        updatedAt: '2026-07-08T00:00:00.000Z',
      },
      placements: [],
      assignments: [],
      connections: [],
    })

    const store = new HomelabInventoryStore({
      appVersion: '0.1.10',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()

    expect(store.databases.meta.data.lastSeenReleaseNotesVersion).toBe('0.1.10')
    expect(store.getReleaseNotesStatus([
      {
        version: '0.1.10',
        date: '2026-07-09',
        channel: 'stable',
        title: 'Current',
        highlights: ['Current note'],
        fixes: [],
      },
    ]).hasUnseen).toBe(false)
  })

  it('flushes acknowledged release-note metadata to disk', async () => {
    const dataDir = await makeTempDir()

    await writeJson(path.join(dataDir, 'meta.json'), {
      schemaVersion: 3,
      appLastOpenedWith: '0.1.9',
      lastSeenReleaseNotesVersion: '0.1.9',
      updatedAt: '2026-07-08T00:00:00.000Z',
    })
    await writeJson(path.join(dataDir, 'stores', 'inventory.json'), {
      servers: [],
      cpus: [],
      ram: [],
      storage: [],
      networkCards: [],
      gpus: [],
      nas: [],
      switches: [],
      patchPanels: [],
    })
    await writeJson(path.join(dataDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: {
        name: 'Project',
        version: 1,
        updatedAt: '2026-07-08T00:00:00.000Z',
      },
      placements: [],
      assignments: [],
      connections: [],
    })

    const store = new HomelabInventoryStore({
      appVersion: '0.1.10',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    const status = await store.acknowledgeReleaseNotes()

    const meta = JSON.parse(await fs.readFile(path.join(dataDir, 'meta.json'), 'utf8'))

    expect(meta.lastSeenReleaseNotesVersion).toBe('0.1.10')
    expect(meta.updatedAt).not.toBe('2026-07-08T00:00:00.000Z')
    expect(status).toEqual({
      currentVersion: '0.1.10',
      lastSeenVersion: '0.1.10',
      hasUnseen: false,
      entries: [],
    })
    expect(store.getReleaseNotesStatus([
      {
        version: '0.1.10',
        date: '2026-07-09',
        channel: 'stable',
        title: 'Current',
        highlights: ['Current note'],
        fixes: [],
      },
    ]).hasUnseen).toBe(false)
  })
})
