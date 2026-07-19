import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateProjectCompatibility } from '../../shared/compatibility/index.mjs'
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

function compatibilityItems() {
  return {
    'server:1': {
      id: 1,
      key: 'server:1',
      type: 'server',
      name: 'Storage Host',
      compatibility: {
        host: {
          storageSlots: [{
            id: 'm2-1',
            label: 'M.2 slots',
            count: 1,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
          }],
        },
      },
      ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G' }],
    },
    'storage:1': {
      id: 1,
      key: 'storage:1',
      type: 'storage',
      name: 'Compatible NVMe',
      specs: { capacityGb: 1000, interface: 'NVMe', formFactor: '2280' },
    },
    'storage:2': {
      id: 2,
      key: 'storage:2',
      type: 'storage',
      name: 'Incompatible SATA',
      specs: { capacityGb: 1000, interface: 'SATA', formFactor: '2.5' },
    },
    'storage:3': {
      id: 3,
      key: 'storage:3',
      type: 'storage',
      name: 'Unknown storage',
      specs: { capacityGb: 1000 },
    },
    'switch:1': {
      id: 1,
      key: 'switch:1',
      type: 'switch',
      name: 'Switch',
      ports: [{ id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '1G' }],
    },
  }
}

function compatibilityProject(assignments = []) {
  return {
    id: 'default',
    metadata: {
      name: 'Compatibility Test',
      version: 1,
      updatedAt: '2026-07-19T00:00:00.000Z',
    },
    items: compatibilityItems(),
    placements: [{ serverId: 'server:1', x: 10, y: 20 }],
    assignments,
    connections: [{
      id: 1,
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 1 },
      type: 'network',
      createdAt: '2026-07-19T00:00:00.000Z',
      negotiatedSpeedMbps: 1000,
    }],
  }
}

async function writeCompatibilityStores(
  dataDir,
  { schemaVersion = 7, assignments = [], compatibilityPolicy } = {},
) {
  const project = compatibilityProject(assignments)
  const inventory = {
    servers: [structuredClone(project.items['server:1'])],
    cpus: [],
    ram: [],
    storage: [
      structuredClone(project.items['storage:1']),
      structuredClone(project.items['storage:2']),
      structuredClone(project.items['storage:3']),
    ],
    networkCards: [],
    gpus: [],
    nas: [],
    switches: [structuredClone(project.items['switch:1'])],
    patchPanels: [],
  }
  for (const records of Object.values(inventory)) {
    for (const item of records) {
      delete item.key
      delete item.type
    }
  }
  const persistedProject = {
    ...project,
    placements: [{ itemType: 'server', itemId: 1, x: 10, y: 20 }],
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      hostType: 'server',
      hostId: 1,
      itemType: 'storage',
      itemId: Number(String(assignment.itemId).split(':').pop()),
      type: 'storage',
      assignedAt: assignment.assignedAt,
      ...(assignment.allocation ? { allocation: structuredClone(assignment.allocation) } : {}),
    })),
    connections: [{
      ...project.connections[0],
      from: { itemType: 'server', itemId: 1, portId: 1 },
      to: { itemType: 'switch', itemId: 1, portId: 1 },
    }],
    ...(compatibilityPolicy ? { compatibilityPolicy } : {}),
  }
  delete persistedProject.items

  await writeJson(path.join(dataDir, 'meta.json'), {
    schemaVersion,
    appLastOpenedWith: '0.1.20',
    updatedAt: '2026-07-19T00:00:00.000Z',
  })
  await writeJson(path.join(dataDir, 'stores', 'inventory.json'), inventory)
  await writeJson(path.join(dataDir, 'stores', 'project.json'), persistedProject)
}

afterEach(async () => {
  await Promise.all(activeStores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('HomelabInventoryStore', () => {
  it('migrates schema 7 projects to schema 8 with an empty compatibility policy', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, { schemaVersion: 7 })

    const store = createStore({
      appVersion: '0.1.26',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    await store.flush()

    expect(store.databases.meta.data.schemaVersion).toBe(8)
    expect(store.getProject().compatibilityPolicy).toEqual({
      disabledHostIds: [],
      ignoredWarningIds: [],
    })
    expect(store.databases.project.data.compatibilityPolicy).toEqual({
      disabledHostIds: [],
      ignoredWarningIds: [],
    })
    const backupEntries = await fs.readdir(path.join(dataDir, 'backups'), { withFileTypes: true })
    expect(backupEntries.some(
      (entry) => entry.isDirectory() && entry.name.endsWith('-schema-7-to-8'),
    )).toBe(true)
  })

  it('persists normalized compatibility policies through compose and split cycles', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      schemaVersion: 8,
      compatibilityPolicy: {
        disabledHostIds: ['server:1'],
        ignoredWarningIds: ['compatibility:["server:1"]'],
      },
    })

    const store = createStore({
      appVersion: '0.1.26',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    const saved = store.setProject(store.getProject())
    await store.flush()

    expect(saved.compatibilityPolicy).toEqual({
      disabledHostIds: ['server:1'],
      ignoredWarningIds: ['compatibility:["server:1"]'],
    })
    expect(JSON.parse(
      await fs.readFile(path.join(dataDir, 'stores', 'project.json'), 'utf8'),
    ).compatibilityPolicy).toEqual(saved.compatibilityPolicy)
  })

  it('prunes stale and non-host disabled references but retains dormant warning IDs', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      schemaVersion: 8,
      compatibilityPolicy: {
        disabledHostIds: ['server:1', 'switch:1', 'server:999'],
        ignoredWarningIds: ['warning:no-longer-open'],
      },
    })

    const store = createStore({
      appVersion: '0.1.26',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    await store.flush()

    expect(store.getProject().compatibilityPolicy).toEqual({
      disabledHostIds: ['server:1'],
      ignoredWarningIds: ['warning:no-longer-open'],
    })
    expect(store.databases.project.data.compatibilityPolicy).toEqual(
      store.getProject().compatibilityPolicy,
    )
  })

  it('removes deleted hosts from compatibility opt-outs without pruning ignored warnings', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      schemaVersion: 8,
      compatibilityPolicy: {
        disabledHostIds: ['server:1'],
        ignoredWarningIds: ['compatibility:["server:1"]'],
      },
    })
    const store = createStore({
      appVersion: '0.1.26',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()
    const withoutPlacement = store.getProject()
    withoutPlacement.placements = []
    withoutPlacement.connections = []
    store.setProject(withoutPlacement)
    store.archiveInventoryItems([{ type: 'server', id: 1 }])
    const deleted = store.deleteInventoryItems([{ type: 'server', id: 1 }])

    expect(deleted.compatibilityPolicy).toEqual({
      disabledHostIds: [],
      ignoredWarningIds: ['compatibility:["server:1"]'],
    })
    expect(store.databases.project.data.compatibilityPolicy).toEqual(deleted.compatibilityPolicy)
  })

  it('seeds a new data directory from bundled store files', async () => {
    const dataDir = await makeTempDir()
    const seedDir = path.join(dataDir, 'seed')

    await writeJson(path.join(seedDir, 'meta.json'), {
      schemaVersion: 7,
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

  it('loads the bundled sample seed without private network topology', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '0.1.14',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedDir: path.resolve('server/seed'),
    })

    await store.init()

    expect(store.getProject().connections).toEqual([])
  })

  it('loads the bundled fictional compatibility scenarios with deterministic outcomes', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '0.1.26',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedDir: path.resolve('server/seed'),
    })

    await store.init()

    const project = store.getProject()
    const results = evaluateProjectCompatibility(project)
    const scenarioResult = (name) => {
      const host = Object.values(project.items).find((item) => item.name === name)
      expect(host, `Missing bundled scenario: ${name}`).toBeDefined()
      const result = results.find((entry) => entry.hostId === host.key)
      const assignment = project.assignments.find((entry) => entry.serverId === host.key)

      return { ...result, allocation: assignment?.allocation }
    }

    const compatible = scenarioResult('Compatible Mini Host')
    const incompatible = scenarioResult('Socket Mismatch Example')
    const unknown = scenarioResult('Incomplete Compatibility Example')
    const negotiated = scenarioResult('PCIe Negotiation Example')

    expect(compatible).toMatchObject({
      status: 'compatible',
      findings: [],
      allocation: { resourceType: 'storage', groupId: 'mini-m2', positions: [0] },
    })
    expect(incompatible).toMatchObject({ status: 'incompatible' })
    expect(incompatible.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'cpu.socket.mismatch', severity: 'error' }),
    ]))
    expect(incompatible.allocation).toBeUndefined()
    expect(unknown).toMatchObject({ status: 'unknown' })
    expect(unknown.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'compatibility.data.missing', severity: 'unknown' }),
    ]))
    expect(unknown.allocation).toBeUndefined()
    expect(negotiated).toMatchObject({
      status: 'compatible',
      allocation: { resourceType: 'expansion', groupId: 'pcie-slot', positions: [0] },
    })
    expect(negotiated.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'expansion.pcie-generation.negotiated', severity: 'warning' }),
    ]))
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

  it('rejects unsupported legacy inventory records before creating split stores', async () => {
    const dataDir = await makeTempDir()
    const legacyPath = path.join(dataDir, 'homelab-inventory-project.json')

    await writeJson(legacyPath, {
      id: 'default',
      metadata: {},
      items: {
        mystery: { id: 'mystery', type: 'router', name: 'Unsupported router' },
      },
      placements: [],
      assignments: [],
      connections: [],
    })

    const store = createStore({
      appVersion: '1.0.0',
      dataDir,
      legacyProjectPath: legacyPath,
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await expect(store.init()).rejects.toThrow(
      'Project items["mystery"].type has an unsupported value.',
    )
    await expect(fs.access(path.join(dataDir, 'meta.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(path.join(dataDir, 'stores', 'inventory.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects colliding normalized legacy inventory keys before creating split stores', async () => {
    const dataDir = await makeTempDir()
    const legacyPath = path.join(dataDir, 'homelab-inventory-project.json')

    await writeJson(legacyPath, {
      id: 'default',
      metadata: {},
      items: {
        first: { id: '1', type: 'cpu', name: 'First CPU' },
        'cpu:1': { id: 1, type: 'cpu', name: 'Second CPU' },
      },
      placements: [],
      assignments: [],
      connections: [],
    })

    const store = createStore({
      appVersion: '1.0.0',
      dataDir,
      legacyProjectPath: legacyPath,
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await expect(store.init()).rejects.toThrow(
      'Project items["cpu:1"] normalizes to duplicate inventory key cpu:1 from Project items["first"].',
    )
    await expect(fs.access(path.join(dataDir, 'meta.json'))).rejects.toMatchObject({ code: 'ENOENT' })
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
    expect(store.databases.meta.data.schemaVersion).toBe(8)
  })

  it('flushes project updates to split stores', async () => {
    const dataDir = await makeTempDir()
    const seedDir = path.join(dataDir, 'seed')

    await writeJson(path.join(seedDir, 'meta.json'), {
      schemaVersion: 7,
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
      schemaVersion: 7,
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
      schemaVersion: 7,
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
      schemaVersion: 7,
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

  it('migrates schema 6 to schema 8 and deterministically allocates only compatible assignments', async () => {
    const dataDir = await makeTempDir()
    const assignments = [
      {
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:1',
        type: 'storage',
        assignedAt: '2026-07-19T00:00:00.000Z',
      },
      {
        id: 2,
        serverId: 'server:1',
        itemId: 'storage:2',
        type: 'storage',
        assignedAt: '2026-07-19T00:00:01.000Z',
      },
    ]
    await writeCompatibilityStores(dataDir, { schemaVersion: 6, assignments })
    const beforeInventory = JSON.parse(
      await fs.readFile(path.join(dataDir, 'stores', 'inventory.json'), 'utf8'),
    )
    const beforeProject = JSON.parse(
      await fs.readFile(path.join(dataDir, 'stores', 'project.json'), 'utf8'),
    )

    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    await store.flush()

    expect(store.databases.meta.data.schemaVersion).toBe(8)
    expect(store.getProject().assignments).toEqual([
      expect.objectContaining({
        id: 1,
        allocation: { resourceType: 'storage', groupId: 'm2-1', positions: [0] },
      }),
      expect.not.objectContaining({ allocation: expect.anything() }),
    ])
    expect(store.databases.inventory.data).toEqual(beforeInventory)
    expect(store.databases.project.data.placements).toEqual(beforeProject.placements)
    expect(store.databases.project.data.connections).toEqual(beforeProject.connections)
    const backupEntries = await fs.readdir(path.join(dataDir, 'backups'), { withFileTypes: true })
    expect(backupEntries.some(
      (entry) => entry.isDirectory() && entry.name.endsWith('-schema-6-to-8'),
    )).toBe(true)
  })

  it('enforces only new assignment transitions and keeps rejected saves byte-for-byte atomic', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir)
    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    const before = JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))
    const submitted = store.getProject()
    submitted.assignments.push({
      id: 1,
      serverId: 'server:1',
      itemId: 'storage:2',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:00.000Z',
    })

    expect(() => store.setProject(submitted)).toThrow(/storage\.interface\.mismatch.*No storage slot accepts/u)
    expect(JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))).toBe(before)
  })

  it('bypasses compatibility enforcement only while a host is disabled', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      compatibilityPolicy: {
        disabledHostIds: ['server:1'],
        ignoredWarningIds: [],
      },
    })
    const store = createStore({
      appVersion: '0.1.26',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()

    const disabled = store.getProject()
    disabled.assignments.push({
      id: 1,
      serverId: 'server:1',
      itemId: 'storage:2',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:00.000Z',
    })
    expect(store.setProject(disabled).assignments).toHaveLength(1)

    const enabled = store.getProject()
    enabled.compatibilityPolicy.disabledHostIds = []
    const reenabled = store.setProject(enabled)
    expect(reenabled.assignments).toHaveLength(1)

    const removed = store.getProject()
    removed.assignments = []
    store.setProject(removed)
    const enforced = store.getProject()
    enforced.assignments.push({
      id: 2,
      serverId: 'server:1',
      itemId: 'storage:2',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:01.000Z',
    })
    expect(() => store.setProject(enforced)).toThrow(/storage\.interface\.mismatch/u)
  })

  it('rejects storage resource exhaustion after incompatible drives consume disabled-host positions', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      compatibilityPolicy: {
        disabledHostIds: ['server:1'],
        ignoredWarningIds: [],
      },
    })
    const store = createStore({
      appVersion: '0.1.26',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    const withSecondDrive = store.createInventoryItems({
      type: 'storage',
      name: 'Second Incompatible SATA',
      specs: { capacityGb: 1000, interface: 'SATA', formFactor: '2.5' },
    })
    const secondDrive = Object.values(withSecondDrive.items).find(
      (item) => item.name === 'Second Incompatible SATA',
    )
    const first = store.getProject()
    first.assignments.push({
      id: 1,
      serverId: 'server:1',
      itemId: 'storage:2',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:00.000Z',
    })
    expect(store.setProject(first).assignments).toEqual([
      expect.objectContaining({
        itemId: 'storage:2',
        allocation: { resourceType: 'storage', groupId: 'm2-1', positions: [0] },
      }),
    ])

    const exhausted = store.getProject()
    exhausted.assignments.push({
      id: 2,
      serverId: 'server:1',
      itemId: secondDrive.key,
      type: 'storage',
      assignedAt: '2026-07-19T00:00:01.000Z',
    })

    let rejection
    try {
      store.setProject(exhausted)
    } catch (error) {
      rejection = error
    }

    expect(rejection).toBeInstanceOf(Error)
    expect(rejection.message).toMatch(
      /compatibility\.resource\.exhausted.*No available storage positions/u,
    )
    expect(rejection.message).not.toMatch(/storage\.interface\.mismatch/u)
    expect(store.getProject().assignments).toHaveLength(1)
  })

  it('rejects resource exhaustion after unknown drives consume disabled-host positions', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      compatibilityPolicy: {
        disabledHostIds: ['server:1'],
        ignoredWarningIds: [],
      },
    })
    const store = createStore({
      appVersion: '0.1.26',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    const withSecondDrive = store.createInventoryItems({
      type: 'storage',
      name: 'Second Unknown Drive',
      specs: { capacityGb: 1000 },
    })
    const secondDrive = Object.values(withSecondDrive.items).find(
      (item) => item.name === 'Second Unknown Drive',
    )
    const first = store.getProject()
    first.assignments.push({
      id: 1,
      serverId: 'server:1',
      itemId: 'storage:3',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:00.000Z',
    })
    expect(store.setProject(first).assignments).toEqual([
      expect.objectContaining({
        itemId: 'storage:3',
        allocation: { resourceType: 'storage', groupId: 'm2-1', positions: [0] },
      }),
    ])

    const exhausted = store.getProject()
    exhausted.assignments.push({
      id: 2,
      serverId: 'server:1',
      itemId: secondDrive.key,
      type: 'storage',
      assignedAt: '2026-07-19T00:00:01.000Z',
    })

    let rejection
    try {
      store.setProject(exhausted)
    } catch (error) {
      rejection = error
    }

    expect(rejection).toBeInstanceOf(Error)
    expect(rejection.message).toMatch(
      /compatibility\.resource\.exhausted.*No available storage positions/u,
    )
    expect(rejection.message).not.toMatch(/compatibility\.data\.missing/u)
    expect(store.getProject().assignments).toHaveLength(1)
  })

  it('rejects canonical assignment ID collisions before transition planning and remains atomic', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir)
    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    const before = JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))
    const submitted = store.getProject()
    submitted.assignments = [
      { id: 1, serverId: 'server:1', itemId: 'storage:1', type: 'storage' },
      { id: '1', serverId: 'server:1', itemId: 'storage:2', type: 'storage' },
    ]

    expect(() => store.setProject(submitted)).toThrow(
      'Project assignments[1].id duplicates canonical id 1 from Project assignments[0].id.',
    )
    expect(JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))).toBe(before)
  })

  it('rejects canonical connection ID collisions before transition planning and remains atomic', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir)
    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    const before = JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))
    const submitted = store.getProject()
    submitted.connections.push({ ...structuredClone(submitted.connections[0]), id: '1' })

    expect(() => store.setProject(submitted)).toThrow(
      'Project connections[1].id duplicates canonical id 1 from Project connections[0].id.',
    )
    expect(JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))).toBe(before)
  })

  it('rejects duplicate component assignments and conflicting allocations atomically', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir)
    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    const before = JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))
    const duplicate = store.getProject()
    duplicate.assignments = [
      { id: 1, serverId: 'server:1', itemId: 'storage:1', type: 'storage' },
      { id: 2, serverId: 'server:1', itemId: 'storage:1', type: 'storage' },
    ]

    expect(() => store.setProject(duplicate)).toThrow(
      'Project assignments[1].itemId duplicates component storage:1 from Project assignments[0].itemId.',
    )
    expect(JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))).toBe(before)

    const overlapping = store.getProject()
    overlapping.assignments = [
      {
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:1',
        type: 'storage',
        allocation: { resourceType: 'storage', groupId: 'm2-1', positions: [0] },
      },
      {
        id: 2,
        serverId: 'server:1',
        itemId: 'storage:2',
        type: 'storage',
        allocation: { resourceType: 'storage', groupId: 'm2-1', positions: [0] },
      },
    ]

    expect(() => store.setProject(overlapping)).toThrow(
      'Project assignments[1].allocation.positions[0] conflicts with Project assignments[0].allocation.positions[0].',
    )
    expect(JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))).toBe(before)
  })

  it('rejects assignment type-only changes and remains byte-for-byte atomic', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:1',
        type: 'storage',
        assignedAt: '2026-07-19T00:00:00.000Z',
      }],
    })
    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    const before = JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))
    const submitted = store.getProject()
    submitted.assignments[0].type = 'gpu'

    expect(() => store.setProject(submitted)).toThrow(
      'Project assignments[0].type gpu does not match referenced inventory item storage:1 type storage.',
    )
    expect(JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))).toBe(before)
  })

  it('rejects a changed assignment that replaces a compatible item with an incompatible item', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:1',
        type: 'storage',
        assignedAt: '2026-07-19T00:00:00.000Z',
      }],
    })
    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    const before = JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))
    const submitted = store.getProject()
    submitted.assignments[0].itemId = 'storage:2'

    expect(() => store.setProject(submitted)).toThrow(/storage\.interface\.mismatch/u)
    expect(JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))).toBe(before)
  })

  it('evaluates both submitted hosts atomically when swapping assigned CPUs', async () => {
    const dataDir = await makeTempDir()
    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()
    store.createInventoryItems({
      type: 'server',
      name: 'LGA1200 Host',
      compatibility: {
        host: { cpu: { sockets: ['LGA1200'], generations: ['10'], maxTdpWatts: 65 } },
      },
    })
    store.createInventoryItems({
      type: 'server',
      name: 'LGA1151 Host',
      compatibility: {
        host: { cpu: { sockets: ['LGA1151'], generations: ['8'], maxTdpWatts: 65 } },
      },
    })
    store.createInventoryItems({
      type: 'cpu',
      name: '10th Gen CPU',
      compatibility: {
        requirements: { cpu: { socket: 'LGA1200', generation: '10', tdpWatts: 35 } },
      },
    })
    store.createInventoryItems({
      type: 'cpu',
      name: '8th Gen CPU',
      compatibility: {
        requirements: { cpu: { socket: 'LGA1151', generation: '8', tdpWatts: 35 } },
      },
    })
    const initial = store.getProject()
    initial.assignments = [
      {
        id: 1,
        serverId: 'server:1',
        itemId: 'cpu:1',
        type: 'cpu',
        assignedAt: '2026-07-19T00:00:00.000Z',
      },
      {
        id: 2,
        serverId: 'server:2',
        itemId: 'cpu:2',
        type: 'cpu',
        assignedAt: '2026-07-19T00:00:01.000Z',
      },
    ]
    store.setProject(initial)

    const before = JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))
    const swapped = store.getProject()
    swapped.assignments[0].itemId = 'cpu:2'
    swapped.assignments[1].itemId = 'cpu:1'

    expect(() => store.setProject(swapped)).toThrow(/cpu\.(socket\.mismatch|generation\.unsupported)/u)
    expect(JSON.stringify(Object.fromEntries(
      Object.entries(store.databases).map(([name, database]) => [name, database.data]),
    ))).toBe(before)
  })

  it('preserves deterministic compatible allocations across a flush and restart', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:1',
        type: 'storage',
        assignedAt: '2026-07-19T00:00:00.000Z',
      }],
    })
    const options = {
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    }
    const store = createStore(options)
    await store.init()
    await store.flush()
    const beforeRestart = store.getProject().assignments

    const restarted = createStore(options)
    await restarted.init()

    expect(beforeRestart).toEqual([
      expect.objectContaining({
        id: 1,
        allocation: { resourceType: 'storage', groupId: 'm2-1', positions: [0] },
      }),
    ])
    expect(restarted.getProject().assignments).toEqual(beforeRestart)
  })

  it('accepts unknown transitions without fabricating allocations and permits legacy removals', async () => {
    const dataDir = await makeTempDir()
    await writeCompatibilityStores(dataDir, {
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:2',
        type: 'storage',
        assignedAt: '2026-07-19T00:00:00.000Z',
      }],
    })
    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })
    await store.init()

    const unrelated = store.getProject()
    unrelated.metadata.name = 'Unrelated save'
    unrelated.placements[0].x = 44
    expect(() => store.setProject(unrelated)).not.toThrow()
    expect(store.getProject().assignments[0].allocation).toBeUndefined()

    const withUnknown = store.getProject()
    withUnknown.assignments.push({
      id: 2,
      serverId: 'server:1',
      itemId: 'storage:3',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:01.000Z',
    })
    expect(store.setProject(withUnknown).assignments[1].allocation).toBeUndefined()

    const removed = store.getProject()
    removed.assignments = []
    expect(store.setProject(removed).assignments).toEqual([])
  })

  it('migrates schema 5 inventory records to schema 8 without rewriting them', async () => {
    const dataDir = await makeTempDir()
    const inventory = {
      servers: [],
      cpus: [{ id: 1, name: 'Preserved CPU', specs: { cores: 8 } }],
      ram: [],
      storage: [],
      networkCards: [],
      gpus: [],
      nas: [],
      switches: [],
      patchPanels: [],
    }

    await writeJson(path.join(dataDir, 'meta.json'), {
      schemaVersion: 5,
      appLastOpenedWith: '0.1.20',
      updatedAt: '2026-07-19T00:00:00.000Z',
    })
    await writeJson(path.join(dataDir, 'stores', 'inventory.json'), inventory)
    await writeJson(path.join(dataDir, 'stores', 'project.json'), {
      id: 'default',
      metadata: { name: 'Migration Test', version: 1, updatedAt: '2026-07-19T00:00:00.000Z' },
      placements: [],
      assignments: [],
      connections: [],
    })

    const store = createStore({
      appVersion: '0.1.21',
      dataDir,
      legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(dataDir, 'missing-seed'),
    })

    await store.init()

    expect(store.databases.meta.data.schemaVersion).toBe(8)
    expect(store.databases.inventory.data).toEqual(inventory)
    const backupEntries = await fs.readdir(path.join(dataDir, 'backups'), { withFileTypes: true })
    expect(backupEntries.some(
      (entry) => entry.isDirectory() && entry.name.endsWith('-schema-5-to-8'),
    )).toBe(true)
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

    expect(store.databases.meta.data.schemaVersion).toBe(8)
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
      (entry) => entry.isDirectory() && entry.name.endsWith('-schema-4-to-8'),
    )

    expect(migrationBackup).toBeDefined()

    const backupMeta = JSON.parse(
      await fs.readFile(path.join(dataDir, 'backups', migrationBackup.name, 'meta.json'), 'utf8'),
    )

    expect(backupMeta.schemaVersion).toBe(4)
  })
})
