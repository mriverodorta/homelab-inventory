import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from './store.mjs'

const tempDirs = []
const stores = []

async function createStore(dataDir = null) {
  const directory = dataDir ?? await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-crud-'))
  if (!dataDir) tempDirs.push(directory)
  const store = new HomelabInventoryStore({
    appVersion: '1.0.0',
    dataDir: directory,
    legacyProjectPath: path.join(directory, 'legacy.json'),
    saveDebounceMs: 1,
    seedEmptyData: false,
    seedDir: path.join(directory, 'missing-seed'),
  })
  await store.init()
  stores.push(store)
  return { store, dataDir: directory }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('atomic inventory commands', () => {
  it('creates sequential quantities and preserves equipment/component naming rules', async () => {
    const { store } = await createStore()
    let project = store.createInventoryItems({ type: 'switch', name: 'Edge Switch' }, 2)
    project = store.createInventoryItems({ type: 'ram', name: '32GB DDR4', specs: { capacityGB: 32 } }, 3)

    expect(project.metadata.schemaVersion).toBe(9)
    expect(store.databases.inventory.data.switches.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 1, name: 'Edge Switch #1' },
      { id: 2, name: 'Edge Switch #2' },
    ])
    expect(store.databases.inventory.data.ram.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 1, name: '32GB DDR4' },
      { id: 2, name: '32GB DDR4' },
      { id: 3, name: '32GB DDR4' },
    ])
    expect(store.databases.inventory.data.ram[0].specs).toEqual({ capacityGB: 32 })
  })

  it('supports lifecycle commands for schema-9 PC equipment and components', async () => {
    const { store } = await createStore()
    store.createInventoryItems({ type: 'pcBuild', name: 'Gaming PC' })
    store.createInventoryItems({ type: 'motherboard', name: 'Mini ITX Board' })
    store.createInventoryItems({ type: 'ups', name: 'Rack UPS' })

    expect(store.getProject().items['pcBuild:1'].name).toBe('Gaming PC')
    expect(store.getProject().items['motherboard:1'].name).toBe('Mini ITX Board')
    expect(store.getProject().items['ups:1'].name).toBe('Rack UPS')

    expect(() => store.deleteInventoryItems([{ type: 'motherboard', id: 1 }]))
      .toThrow('Archive inventory items before deleting them.')
    store.archiveInventoryItems([{ type: 'motherboard', id: 1 }])
    const deleted = store.deleteInventoryItems([{ type: 'motherboard', id: 1 }])
    expect(deleted.items['motherboard:1']).toBeUndefined()
  })

  it('blocks PC build and UPS lifecycle commands while dependencies remain', async () => {
    const { store } = await createStore()
    store.createInventoryItems({ type: 'pcBuild', name: 'Gaming PC' })
    store.createInventoryItems({ type: 'motherboard', name: 'Mini ITX Board' })
    store.createInventoryItems({ type: 'ups', name: 'Rack UPS' })
    store.databases.project.data.placements.push(
      { itemType: 'pcBuild', itemId: 1, x: 0, y: 0 },
      { itemType: 'ups', itemId: 1, x: 400, y: 0 },
    )
    store.databases.project.data.assignments.push({
      id: 1,
      hostType: 'pcBuild',
      hostId: 1,
      itemType: 'motherboard',
      itemId: 1,
      type: 'motherboard',
      assignedAt: '2026-07-20T00:00:00.000Z',
    })
    store.databases.project.data.connections.push({
      id: 1,
      from: { itemType: 'ups', itemId: 1, portId: 1 },
      to: { itemType: 'powerStrip', itemId: 99, portId: 1 },
      type: 'power',
      createdAt: '2026-07-20T00:00:00.000Z',
    })

    expect(() => store.archiveInventoryItems([{ type: 'pcBuild', id: 1 }]))
      .toThrow('dependencies')
    expect(() => store.archiveInventoryItems([{ type: 'ups', id: 1 }]))
      .toThrow('dependencies')
    expect(store.getProject().items['pcBuild:1'].archivedAt).toBeUndefined()
    expect(store.getProject().items['ups:1'].archivedAt).toBeUndefined()
  })

  it('preserves independent compatibility profiles for quantity creation', async () => {
    const { store } = await createStore()
    const compatibility = {
      host: {
        storageSlots: [{ id: 'source-slot', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
      },
      extension: { retained: true },
    }

    store.createInventoryItems({ type: 'server', name: 'Node', compatibility }, 2)

    const [first, second] = store.databases.inventory.data.servers
    expect(first.compatibility).toEqual({
      host: {
        storageSlots: [{ id: 'source-slot', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
      },
      extension: { retained: true },
    })
    expect(second.compatibility).toEqual(first.compatibility)
    expect(second.compatibility).not.toBe(first.compatibility)
  })

  it('rejects invalid quantities without changing inventory', async () => {
    const { store } = await createStore()

    for (const quantity of [0, 101, 1.5, '2']) {
      expect(() => store.createInventoryItems({ type: 'cpu', name: 'CPU' }, quantity)).toThrow('Quantity')
    }
    expect(store.databases.inventory.data.cpus).toEqual([])
  })

  it('duplicates clean hardware records with fresh ids and no instance data', async () => {
    const { store } = await createStore()
    store.createInventoryItems({
      type: 'server',
      name: 'Node',
      manufacturer: 'Example',
      notes: 'rack note',
      properties: { name: 'runtime-name' },
      ports: [{
        id: 9,
        kind: 'server-port',
        type: 'rj45',
        slotNumber: 1,
        speed: '1G',
        label: 'LAN',
        notes: 'patched',
      }],
      compatibility: {
        host: {
          storageSlots: [{ id: 'm2-original', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
          expansionSlots: [{
            id: 'pcie-original', label: 'PCIe', count: 1, interfaceFamily: 'pcie',
          }],
        },
      },
    })

    const project = store.duplicateInventoryItem({ type: 'server', id: 1 }, 2)

    expect(project.items['server:2']).toMatchObject({ id: 2, name: 'Node #2', manufacturer: 'Example' })
    expect(project.items['server:3'].name).toBe('Node #3')
    expect(project.items['server:2'].notes).toBeUndefined()
    expect(project.items['server:2'].properties).toBeUndefined()
    expect(project.items['server:2'].ports).toEqual([{
      id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G',
    }])
    expect(project.items['server:2'].compatibility).toEqual({
      host: {
        storageSlots: [{ id: 'storage-1', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
        expansionSlots: [{
          id: 'expansion-1', label: 'PCIe', count: 1, interfaceFamily: 'pcie',
        }],
      },
    })
  })

  it('preserves compatibility profiles while archiving and restoring', async () => {
    const { store } = await createStore()
    const compatibility = { requirements: { cpu: { socket: 'LGA1200', generation: '10' } } }
    store.createInventoryItems({ type: 'cpu', name: 'CPU', compatibility })

    store.archiveInventoryItems([{ type: 'cpu', id: 1 }])
    expect(store.getProject().items['cpu:1'].compatibility).toEqual(compatibility)
    store.restoreInventoryItems([{ type: 'cpu', id: 1 }])
    expect(store.getProject().items['cpu:1'].compatibility).toEqual(compatibility)
  })

  it('archives, restores, and deletes dependency-free records', async () => {
    const { store } = await createStore()
    store.createInventoryItems({ type: 'cpu', name: 'CPU' }, 2)

    let project = store.archiveInventoryItems([{ type: 'cpu', id: 1 }])
    expect(Date.parse(project.items['cpu:1'].archivedAt)).not.toBeNaN()
    project = store.restoreInventoryItems([{ type: 'cpu', id: 1 }])
    expect(project.items['cpu:1'].archivedAt).toBeUndefined()
    expect(() => store.deleteInventoryItems([{ type: 'cpu', id: 1 }])).toThrow(
      'Archive inventory items before deleting them.',
    )
    project = store.archiveInventoryItems([{ type: 'cpu', id: 1 }])
    project = store.deleteInventoryItems([{ type: 'cpu', id: 1 }])
    expect(project.items['cpu:1']).toBeUndefined()
    expect(project.items['cpu:2']).toBeDefined()
  })

  it('keeps mixed batches atomic when any selected item has a dependency', async () => {
    const { store } = await createStore()
    store.createInventoryItems({ type: 'cpu', name: 'CPU' }, 2)
    store.databases.project.data.assignments.push({
      id: 1,
      hostType: 'server',
      hostId: 99,
      itemType: 'cpu',
      itemId: 2,
      type: 'cpu',
      assignedAt: '2026-07-19T00:00:00.000Z',
    })

    expect(() => store.archiveInventoryItems([
      { type: 'cpu', id: 1 },
      { type: 'cpu', id: 2 },
    ])).toThrow('dependencies')
    expect(store.databases.inventory.data.cpus.every((item) => item.archivedAt === undefined)).toBe(true)
  })

  it('allows safe edits but blocks material changes to connected ports', async () => {
    const { store } = await createStore()
    store.createInventoryItems({
      type: 'switch',
      name: 'Switch',
      ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1, speed: '10G' }],
    })
    store.databases.project.data.connections.push({
      id: 1,
      from: { itemType: 'switch', itemId: 1, portId: 1 },
      to: { itemType: 'switch', itemId: 2, portId: 1 },
      type: 'network',
      createdAt: '2026-07-19T00:00:00.000Z',
    })

    expect(store.updateInventoryItem({ type: 'switch', id: 1 }, {
      type: 'switch',
      name: 'Renamed Switch',
      ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1, speed: '10G' }],
    }).items['switch:1'].name).toBe('Renamed Switch')

    expect(() => store.updateInventoryItem({ type: 'switch', id: 1 }, {
      type: 'switch',
      name: 'Invalid Change',
      ports: [{ id: 1, kind: 'switch-port', type: 'sfp-plus', slotNumber: 1, speed: '5G' }],
    })).toThrow('cannot be removed or materially changed')
    expect(store.getProject().items['switch:1'].name).toBe('Renamed Switch')
  })

  it('persists lifecycle state across a flush and restart', async () => {
    const { store, dataDir } = await createStore()
    store.createInventoryItems({ type: 'cpu', name: 'CPU' })
    store.archiveInventoryItems([{ type: 'cpu', id: 1 }])
    await store.flush()

    const { store: restarted } = await createStore(dataDir)
    expect(restarted.databases.meta.data.schemaVersion).toBe(9)
    expect(restarted.getProject().items['cpu:1'].archivedAt).toBeTruthy()
  })
})
