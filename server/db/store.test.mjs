import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from './store.mjs'
import { assertInventoryStoreShape, assertProjectStoreShape } from './validation.mjs'

const tempDirs = []
const activeStores = []

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssi-lowdb-'))
  tempDirs.push(dir)

  return dir
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

function createStore(options) {
  const store = new HomelabInventoryStore(options)
  activeStores.push(store)

  return store
}

function negotiationItems() {
  return {
    'server:1': {
      id: 1,
      key: 'server:1',
      name: 'One Gig Server',
      type: 'server',
      ports: [
        { id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G' },
      ],
    },
    'switch:1': {
      id: 1,
      key: 'switch:1',
      name: 'Multi Gig Switch',
      type: 'switch',
      ports: [
        { id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '2.5G' },
      ],
    },
    'patchPanel:1': {
      id: 1,
      key: 'patchPanel:1',
      name: 'Patch Panel',
      type: 'patchPanel',
      ports: [
        {
          id: 1,
          kind: 'keystone',
          type: 'rj45',
          slotNumber: 1,
          endpoints: [
            { id: 1, side: 'front' },
            { id: 2, side: 'back' },
          ],
        },
      ],
    },
  }
}

function negotiationConnections({ persisted = false } = {}) {
  const endpoint = (itemType, itemId, portId, endpointId) => persisted
    ? {
        itemType,
        itemId,
        portId,
        ...(endpointId === undefined ? {} : { endpointId }),
      }
    : {
        itemId: `${itemType}:${itemId}`,
        portId,
        ...(endpointId === undefined ? {} : { endpointId }),
      }

  return [
    {
      id: 1,
      from: endpoint('switch', 1, 1),
      to: endpoint('patchPanel', 1, 1, 1),
      type: 'network',
      label: 'Core uplink',
      route: {
        sourceSide: 'bottom',
        targetSide: 'top',
        bendPoints: [{ x: 120, y: 240 }],
      },
      createdAt: '2026-07-10T00:00:00.000Z',
    },
    {
      id: 2,
      from: endpoint('patchPanel', 1, 1, 2),
      to: endpoint('server', 1, 1),
      type: 'network',
      label: 'Server drop',
      route: {
        sourceSide: 'bottom',
        targetSide: 'top',
        bendPoints: [{ x: 320, y: 480 }],
      },
      createdAt: '2026-07-10T00:00:01.000Z',
    },
  ]
}

function negotiationInventoryStore() {
  const items = negotiationItems()
  const forStore = ({ key: _key, type: _type, ...item }) => item

  return {
    servers: [forStore(items['server:1'])],
    cpus: [],
    ram: [],
    storage: [],
    networkCards: [],
    gpus: [],
    nas: [],
    switches: [forStore(items['switch:1'])],
    patchPanels: [forStore(items['patchPanel:1'])],
  }
}

afterEach(async () => {
  await Promise.all(activeStores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('HomelabInventoryStore', () => {
  it('seeds a new data directory from bundled store files', async () => {
    const dataDir = await makeTempDir()
    const seedDir = path.join(dataDir, 'seed')

    await writeJson(path.join(seedDir, 'meta.json'), {
      schemaVersion: 5,
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

    const store = createStore({
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
    expect(store.getUpdateMetadata()).toEqual({
      skippedUpdateVersion: null,
      lastUpdateCheck: null,
    })
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

    const store = createStore({
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
    expect(store.getUpdateMetadata()).toEqual({
      skippedUpdateVersion: null,
      lastUpdateCheck: null,
    })
  })

  it('persists update state and skips only the selected version', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '0.1.15',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    const result = {
      state: 'available',
      channel: 'stable',
      runningVersion: '0.1.15',
      runningRevision: 'running',
      availableVersion: '0.1.16',
      availableRevision: 'published',
      updateAvailable: true,
      checkedAt: '2026-07-12T12:00:00.000Z',
      errorCode: null,
    }

    await store.init()
    await store.saveUpdateCheck(result)
    await store.skipUpdateVersion('0.1.16')

    expect(store.getUpdateMetadata()).toEqual({
      skippedUpdateVersion: '0.1.16',
      lastUpdateCheck: result,
    })
    expect(store.isUpdateVersionSkipped('0.1.16')).toBe(true)
    expect(store.isUpdateVersionSkipped('0.1.17')).toBe(false)

    result.availableVersion = 'modified-after-save'
    expect(store.getUpdateMetadata().lastUpdateCheck.availableVersion).toBe('0.1.16')

    const meta = JSON.parse(await fs.readFile(path.join(dataDir, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({
      skippedUpdateVersion: '0.1.16',
      lastUpdateCheck: { availableVersion: '0.1.16' },
    })

    await store.clearSkippedUpdateVersion()

    expect(store.isUpdateVersionSkipped('0.1.16')).toBe(false)
    expect(store.getUpdateMetadata().skippedUpdateVersion).toBeNull()
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'meta.json'), 'utf8')).skippedUpdateVersion).toBeNull()
  })

  it('loads the bundled sample seed with persisted negotiated cable speeds', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '0.1.14',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedDir: path.resolve('server/seed'),
    })

    await store.init()

    const networkConnections = store
      .getProject()
      .connections
      .filter((connection) => connection.type === 'network')

    expect(networkConnections).toHaveLength(4)
    expect(networkConnections.map((connection) => connection.negotiatedSpeedMbps)).toEqual([
      1000,
      1000,
      2500,
      2500,
    ])
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

    const store = createStore({
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

  it('normalizes switch speeds and legacy uplinks while importing a single-file project', async () => {
    const dataDir = await makeTempDir()
    const legacyPath = path.join(dataDir, 'homelab-inventory-project.json')

    await writeJson(legacyPath, {
      id: 'default',
      metadata: {
        name: 'Legacy Uplinks',
        version: 1,
        updatedAt: '2026-07-10T00:00:00.000Z',
      },
      items: {
        'switch-a': {
          id: 'switch-a',
          name: 'Legacy Switch A',
          type: 'switch',
          ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1 }],
        },
        'switch-b': {
          id: 'switch-b',
          name: 'Legacy Switch B',
          type: 'switch',
          ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1 }],
        },
      },
      placements: [],
      assignments: [],
      connections: [{
        id: 'legacy-uplink',
        from: { itemId: 'switch-a', portId: 1 },
        to: { itemId: 'switch-b', portId: 1 },
        type: 'other',
        label: 'Preserved uplink',
        route: {
          sourceSide: 'right',
          targetSide: 'left',
          bendPoints: [{ x: 200, y: 300 }],
        },
        createdAt: '2026-07-10T00:00:00.000Z',
      }],
    })

    const store = createStore({
      appVersion: '0.1.14',
      dataDir,
      legacyProjectPath: legacyPath,
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()

    const imported = store.getProject()
    expect(Object.values(imported.items).map((item) => item.ports?.[0]?.speed)).toEqual([
      '10G',
      '10G',
    ])
    expect(imported.connections[0]).toMatchObject({
      type: 'network',
      label: 'Preserved uplink',
      route: {
        sourceSide: 'right',
        targetSide: 'left',
        bendPoints: [{ x: 200, y: 300 }],
      },
      negotiatedSpeedMbps: 10000,
    })
    expect(store.databases.meta.data.schemaVersion).toBe(5)
  })

  it('flushes project updates to split stores', async () => {
    const dataDir = await makeTempDir()
    const seedDir = path.join(dataDir, 'seed')

    await writeJson(path.join(seedDir, 'meta.json'), {
      schemaVersion: 5,
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

    const store = createStore({
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

    const store = createStore({
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
      schemaVersion: 5,
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

    const store = createStore({
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
    expect(status.entries.map((entry) => entry.version)).toEqual(['0.1.10', '0.1.9'])
  })

  it('falls back to the current version when existing data has no previous app version', async () => {
    const dataDir = await makeTempDir()

    await writeJson(path.join(dataDir, 'meta.json'), {
      schemaVersion: 5,
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

    const store = createStore({
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
      schemaVersion: 5,
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

    const store = createStore({
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

  it('normalizes negotiated speeds before persisting project updates', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '1.0.0',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    const savedProject = store.setProject({
      ...store.getProject(),
      items: negotiationItems(),
      connections: negotiationConnections(),
    })
    await store.flush()

    expect(savedProject.connections.map((connection) => connection.negotiatedSpeedMbps)).toEqual([1000, 1000])

    const persistedProject = JSON.parse(
      await fs.readFile(path.join(dataDir, 'stores', 'project.json'), 'utf8'),
    )

    expect(persistedProject.connections.map((connection) => connection.negotiatedSpeedMbps)).toEqual([1000, 1000])
  })

  it('validates persisted negotiated connection speeds', () => {
    const connection = {
      id: 1,
      from: { itemType: 'server', itemId: 1, portId: 1 },
      to: { itemType: 'switch', itemId: 1, portId: 1 },
      type: 'network',
      createdAt: '2026-07-10T00:00:00.000Z',
    }
    const projectStore = {
      id: 'default',
      placements: [],
      assignments: [],
      connections: [connection],
    }

    for (const negotiatedSpeedMbps of [1000, 2500, 5000, 10000]) {
      expect(() => assertProjectStoreShape({
        ...projectStore,
        connections: [{ ...connection, negotiatedSpeedMbps }],
      })).not.toThrow()
    }

    for (const negotiatedSpeedMbps of [-1, 0, 7500, Number.NaN, Number.POSITIVE_INFINITY, '1000']) {
      expect(() => assertProjectStoreShape({
        ...projectStore,
        connections: [{ ...connection, negotiatedSpeedMbps }],
      })).toThrow('Connection negotiated speed must be 1000, 2500, 5000, or 10000 Mbps.')
    }
  })

  it('requires supported advertised speeds on persisted switch network ports', () => {
    const inventory = negotiationInventoryStore()
    const switchRecord = inventory.switches[0]

    for (const type of ['rj45', 'sfp', 'sfp-plus']) {
      for (const speed of ['1G', '2.5G', '5G', '10G']) {
        expect(() => assertInventoryStoreShape({
          ...inventory,
          switches: [{
            ...switchRecord,
            ports: [{ ...switchRecord.ports[0], type, speed }],
          }],
        })).not.toThrow()
      }

      for (const speed of [undefined, '', '1000M', '25G']) {
        expect(() => assertInventoryStoreShape({
          ...inventory,
          switches: [{
            ...switchRecord,
            ports: [{ ...switchRecord.ports[0], type, speed }],
          }],
        })).toThrow(`Switch network port 1 must advertise 1G, 2.5G, 5G, or 10G.`)
      }
    }

    expect(() => assertInventoryStoreShape({
      ...inventory,
      switches: [{
        ...switchRecord,
        ports: [{ ...switchRecord.ports[0], type: 'displayport', speed: undefined }],
      }],
    })).not.toThrow()
  })

  it('does not retain or persist a rejected switch inventory item', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '1.0.0',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    store.addInventoryItem({
      type: 'switch',
      name: 'Valid Switch',
      ports: [{ id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '1G' }],
    })

    expect(() => store.addInventoryItem({
      type: 'switch',
      name: 'Rejected Switch',
      ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1 }],
    })).toThrow('Switch network port 1 must advertise 1G, 2.5G, 5G, or 10G.')

    await store.flush()

    expect(store.databases.inventory.data.switches.map((item) => item.name)).toEqual([
      'Valid Switch',
    ])
    const persistedInventory = JSON.parse(
      await fs.readFile(path.join(dataDir, 'stores', 'inventory.json'), 'utf8'),
    )
    expect(persistedInventory.switches.map((item) => item.name)).toEqual(['Valid Switch'])
  })

  it('rejects project writes with missing or unsupported switch network port speeds', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '1.0.0',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()

    for (const speed of [undefined, '25G']) {
      expect(() => store.setProject({
        ...store.getProject(),
        items: {
          'switch:1': {
            id: 1,
            key: 'switch:1',
            name: 'Malformed Switch',
            type: 'switch',
            ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1, speed }],
          },
        },
      })).toThrow('Switch network port 1 must advertise 1G, 2.5G, 5G, or 10G.')
    }
  })

  it('repairs legacy network connections before persisting project updates', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '1.0.0',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()

    const items = {
      ...negotiationItems(),
      'network:1': {
        id: 1,
        key: 'network:1',
        name: 'Hosted NIC',
        type: 'network',
        ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '5G' }],
      },
      'server:2': {
        id: 2,
        key: 'server:2',
        name: 'NIC Host',
        type: 'server',
      },
      'switch:2': {
        id: 2,
        key: 'switch:2',
        name: 'Ten Gig Switch',
        type: 'switch',
        ports: [
          { id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1, speed: '10G' },
          { id: 2, kind: 'switch-port', type: 'rj45', slotNumber: 2, speed: '2.5G' },
        ],
      },
      'switch:3': {
        id: 3,
        key: 'switch:3',
        name: 'Other Ten Gig Switch',
        type: 'switch',
        ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1, speed: '10G' }],
      },
    }
    const preservedConnection = {
      id: 41,
      from: { itemId: 'switch:2', portId: 1 },
      to: { itemId: 'switch:3', portId: 1 },
      type: 'other',
      label: 'Legacy core',
      route: {
        sourceSide: 'right',
        targetSide: 'left',
        bendPoints: [{ x: 144, y: 288 }],
      },
      createdAt: '2026-07-10T01:02:03.000Z',
    }
    const savedProject = store.setProject({
      ...store.getProject(),
      items,
      assignments: [{
        id: 1,
        serverId: 'server:2',
        itemId: 'network:1',
        type: 'network',
        assignedAt: '2026-07-10T01:00:00.000Z',
      }],
      connections: [
        preservedConnection,
        {
          id: 42,
          from: { itemId: 'switch:1', portId: 1 },
          to: { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
          type: 'other',
          createdAt: '2026-07-10T01:02:04.000Z',
        },
        {
          id: 43,
          from: { itemId: 'server:2', hostedItemId: 'network:1', portId: 1 },
          to: { itemId: 'switch:2', portId: 2 },
          type: 'other',
          createdAt: '2026-07-10T01:02:05.000Z',
        },
      ],
    })
    await store.flush()

    expect(savedProject.connections.map(({ type, negotiatedSpeedMbps }) => ({
      type,
      negotiatedSpeedMbps,
    }))).toEqual([
      { type: 'network', negotiatedSpeedMbps: 10000 },
      { type: 'network', negotiatedSpeedMbps: 2500 },
      { type: 'network', negotiatedSpeedMbps: 2500 },
    ])

    const persistedProject = JSON.parse(
      await fs.readFile(path.join(dataDir, 'stores', 'project.json'), 'utf8'),
    )

    expect(persistedProject.connections[0]).toEqual({
      ...preservedConnection,
      from: { itemType: 'switch', itemId: 2, portId: 1 },
      to: { itemType: 'switch', itemId: 3, portId: 1 },
      type: 'network',
      negotiatedSpeedMbps: 10000,
    })
    expect(persistedProject.connections.slice(1).map((connection) => connection.type)).toEqual([
      'network',
      'network',
    ])
  })

  it('migrates schema 4 switch ports and legacy links after creating a backup', async () => {
    const dataDir = await makeTempDir()

    await writeJson(path.join(dataDir, 'meta.json'), {
      schemaVersion: 4,
      appLastOpenedWith: '0.1.14',
      updatedAt: '2026-07-10T00:00:00.000Z',
    })
    const inventory = negotiationInventoryStore()
    inventory.switches = [
      {
        id: 1,
        name: 'First Switch',
        ports: [
          { id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1 },
          { id: 2, kind: 'switch-port', type: 'sfp', slotNumber: 2 },
          { id: 3, kind: 'switch-port', type: 'sfp-plus', slotNumber: 3 },
          { id: 4, kind: 'switch-port', type: 'sfp-plus', slotNumber: 4, speed: '5G' },
        ],
      },
      {
        id: 2,
        name: 'Second Switch',
        ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1 }],
      },
    ]
    await writeJson(path.join(dataDir, 'stores', 'inventory.json'), inventory)
    await writeJson(path.join(dataDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: {
        name: 'Negotiated Migration',
        version: 1,
        updatedAt: '2026-07-10T00:00:00.000Z',
      },
      placements: [],
      assignments: [],
      connections: [{
        id: 41,
        from: { itemType: 'switch', itemId: 1, portId: 3 },
        to: { itemType: 'switch', itemId: 2, portId: 1 },
        type: 'other',
        label: 'Legacy core',
        route: {
          sourceSide: 'right',
          targetSide: 'left',
          bendPoints: [{ x: 144, y: 288 }],
        },
        createdAt: '2026-07-10T01:02:03.000Z',
      }],
    })

    const store = createStore({
      appVersion: '0.1.15',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()

    expect(store.databases.meta.data.schemaVersion).toBe(5)
    expect(store.getProject().items['switch:1'].ports.map((port) => port.speed)).toEqual([
      '1G',
      '1G',
      '10G',
      '5G',
    ])
    expect(store.getProject().connections).toEqual([{
      id: 41,
      from: { itemId: 'switch:1', portId: 3 },
      to: { itemId: 'switch:2', portId: 1 },
      type: 'network',
      label: 'Legacy core',
      route: {
        sourceSide: 'right',
        targetSide: 'left',
        bendPoints: [{ x: 144, y: 288 }],
      },
      createdAt: '2026-07-10T01:02:03.000Z',
      negotiatedSpeedMbps: 10000,
    }])

    const persistedProject = JSON.parse(
      await fs.readFile(path.join(dataDir, 'stores', 'project.json'), 'utf8'),
    )

    expect(persistedProject.connections[0]).toMatchObject({
      id: 41,
      type: 'network',
      label: 'Legacy core',
      createdAt: '2026-07-10T01:02:03.000Z',
      route: {
        sourceSide: 'right',
        targetSide: 'left',
        bendPoints: [{ x: 144, y: 288 }],
      },
      negotiatedSpeedMbps: 10000,
    })

    const persistedInventory = JSON.parse(
      await fs.readFile(path.join(dataDir, 'stores', 'inventory.json'), 'utf8'),
    )

    expect(persistedInventory.switches.map((item) => item.ports.map((port) => port.speed))).toEqual([
      ['1G', '1G', '10G', '5G'],
      ['10G'],
    ])

    const backupEntries = await fs.readdir(path.join(dataDir, 'backups'), { withFileTypes: true })
    const migrationBackup = backupEntries.find(
      (entry) => entry.isDirectory() && entry.name.endsWith('-schema-4-to-5'),
    )

    expect(migrationBackup).toBeDefined()

    const backupMeta = JSON.parse(
      await fs.readFile(path.join(dataDir, 'backups', migrationBackup.name, 'meta.json'), 'utf8'),
    )

    expect(backupMeta.schemaVersion).toBe(4)
  })
})
