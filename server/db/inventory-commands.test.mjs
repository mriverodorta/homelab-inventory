import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalPowerPorts } from '../../shared/power-ports.mjs'
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

    expect(project.metadata.schemaVersion).toBe(12)
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

  it('supports lifecycle commands for schema-11 PC equipment and components', async () => {
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

  it('materializes canonical power ports when creating power equipment', async () => {
    const { store } = await createStore()

    store.createInventoryItems({
      type: 'powerAdapter',
      name: 'Dell 130W',
      manufacturer: 'Dell',
      specs: { wattageWatts: 130, connector: 'Slim tip' },
    }, 2)

    expect(store.databases.inventory.data.powerAdapters).toEqual([
      {
        id: 1,
        name: 'Dell 130W',
        manufacturer: 'Dell',
        specs: { wattageWatts: 130, connector: 'Slim tip' },
        ports: canonicalPowerPorts({ type: 'powerAdapter' }),
      },
      {
        id: 2,
        name: 'Dell 130W',
        manufacturer: 'Dell',
        specs: { wattageWatts: 130, connector: 'Slim tip' },
        ports: canonicalPowerPorts({ type: 'powerAdapter' }),
      },
    ])
  })

  it('normalizes smart power-strip identity and numeric outlet references', async () => {
    const { store } = await createStore()

    const project = store.createInventoryItems({
      type: 'powerStrip',
      name: 'Kasa HS300',
      specs: { outlets: 2, surgeProtected: true },
      smart: {
        enabled: true,
        displayName: '  Rack power  ',
        managementIp: ' 192.168.1.50 ',
        macAddress: ' 00:11:22:33:44:55 ',
        outlets: [{ portId: 2, name: ' Router ' }],
      },
    })

    expect(project.items['powerStrip:1'].smart).toEqual({
      enabled: true,
      displayName: 'Rack power',
      managementIp: '192.168.1.50',
      macAddress: '00:11:22:33:44:55',
      outlets: [{ portId: 2, name: 'Router' }],
    })
    expect(() => store.createInventoryItems({
      type: 'powerStrip',
      name: 'Invalid strip',
      specs: { outlets: 1 },
      smart: { enabled: true, outlets: [{ portId: 99, name: 'Missing' }] },
    })).toThrow('must reference an existing AC outlet port')
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
        storageSlots: [{ id: 1, key: 'source-slot', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
      },
      extension: { retained: true },
    }

    store.createInventoryItems({ type: 'server', name: 'Node', compatibility }, 2)

    const [first, second] = store.databases.inventory.data.servers
    expect(first.compatibility).toEqual({
      host: {
        storageSlots: [{ id: 1, key: 'source-slot', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
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
          storageSlots: [{ id: 1, key: 'm2-original', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
          expansionSlots: [{
            id: 1, key: 'pcie-original', label: 'PCIe', count: 1, interfaceFamily: 'pcie',
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
        storageSlots: [{ id: 1, key: 'm2-original', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
        expansionSlots: [{
          id: 1, key: 'pcie-original', label: 'PCIe', count: 1, interfaceFamily: 'pcie',
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
    }, 2)
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

  it('updates UPS and power-strip layout properties without changing connected power ports', async () => {
    const { store } = await createStore()
    const upsSpecs = {
      outlets: 2,
      batteryBackupOutlets: 1,
      surgeProtectedOutlets: 1,
    }
    const powerStripSpecs = { outlets: 2, surgeProtected: true }

    store.databases.inventory.data.upsSystems.push({
      id: 1,
      name: 'Rack UPS',
      specs: upsSpecs,
      ports: canonicalPowerPorts({ type: 'ups', specs: upsSpecs }),
    })
    store.databases.inventory.data.powerStrips.push({
      id: 1,
      name: 'Rack power strip',
      specs: powerStripSpecs,
      ports: canonicalPowerPorts({ type: 'powerStrip', specs: powerStripSpecs }),
    })
    store.databases.project.data.connections.push({
      id: 1,
      from: { itemType: 'ups', itemId: 1, portId: 1 },
      to: { itemType: 'powerStrip', itemId: 1, portId: 1 },
      type: 'power',
      createdAt: '2026-07-21T00:00:00.000Z',
    })
    const portsBefore = structuredClone({
      ups: store.getProject().items['ups:1'].ports,
      powerStrip: store.getProject().items['powerStrip:1'].ports,
    })
    const connectionsBefore = structuredClone(store.getProject().connections)

    store.updateInventoryItemProperties(
      { type: 'ups', id: 1 },
      { canvasOrientation: 'vertical', upsOutletGroupOrder: 'surge-battery' },
    )
    const project = store.updateInventoryItemProperties(
      { type: 'powerStrip', id: 1 },
      { canvasOrientation: 'vertical' },
    )

    expect(project.items['ups:1'].properties).toEqual({
      canvasOrientation: 'vertical',
      upsOutletGroupOrder: 'surge-battery',
    })
    expect(project.items['powerStrip:1'].properties).toEqual({
      canvasOrientation: 'vertical',
    })
    expect(project.items['ups:1'].ports).toEqual(portsBefore.ups)
    expect(project.items['powerStrip:1'].ports).toEqual(portsBefore.powerStrip)
    expect(project.connections).toEqual(connectionsBefore)
  })

  it('routes NAS power mode changes through one confirmed atomic command', async () => {
    const { store } = await createStore()
    store.createInventoryItems({
      type: 'nas',
      name: 'External NAS',
      specs: { powerConfiguration: 'external-adapter' },
    })
    store.createInventoryItems({ type: 'powerAdapter', name: 'OEM adapter' })
    store.createInventoryItems({
      type: 'ups',
      name: 'UPS',
      specs: { outlets: 1, batteryBackupOutlets: 1, surgeProtectedOutlets: 0 },
    })
    store.databases.project.data.assignments.push({
      id: 1,
      hostType: 'nas',
      hostId: 1,
      itemType: 'powerAdapter',
      itemId: 1,
      type: 'powerAdapter',
      assignedAt: '2026-07-22T00:00:00.000Z',
    })
    store.databases.project.data.connections.push({
      id: 1,
      from: { itemType: 'ups', itemId: 1, portId: 1 },
      to: {
        itemType: 'nas',
        itemId: 1,
        hostedItemType: 'powerAdapter',
        hostedItemId: 1,
        portId: 1,
      },
      type: 'power',
      label: 'NAS power',
      createdAt: '2026-07-22T00:00:00.000Z',
    })

    expect(() => store.updateInventoryItem({ type: 'nas', id: 1 }, {
      type: 'nas',
      name: 'External NAS',
      specs: { powerConfiguration: 'internal-psu' },
    })).toThrow('NAS power configuration command')

    const preview = store.changeNasPowerConfiguration(
      { type: 'nas', id: 1 },
      'internal-psu',
    )
    expect(preview).toEqual({
      status: 'confirmation-required',
      impact: {
        from: 'external-adapter',
        to: 'internal-psu',
        connections: [{ id: 1, label: 'NAS power' }],
        releasedAdapter: { type: 'powerAdapter', id: 1, name: 'OEM adapter' },
      },
    })
    expect(store.databases.project.data.assignments).toHaveLength(1)
    expect(store.databases.project.data.connections).toHaveLength(1)

    const applied = store.changeNasPowerConfiguration(
      { type: 'nas', id: 1 },
      'internal-psu',
      true,
    )
    expect(applied.status).toBe('applied')
    expect(applied.project.items['nas:1']).toMatchObject({
      specs: { powerConfiguration: 'internal-psu' },
      ports: [expect.objectContaining({ key: 'ac-input', type: 'ac-input' })],
    })
    expect(applied.project.assignments).toEqual([])
    expect(applied.project.connections).toEqual([])
    expect(applied.project.items['powerAdapter:1']).toBeDefined()
  })

  it('persists lifecycle state across a flush and restart', async () => {
    const { store, dataDir } = await createStore()
    store.createInventoryItems({ type: 'cpu', name: 'CPU' })
    store.archiveInventoryItems([{ type: 'cpu', id: 1 }])
    await store.flush()

    const { store: restarted } = await createStore(dataDir)
    expect(restarted.databases.meta.data.schemaVersion).toBe(12)
    expect(restarted.getProject().items['cpu:1'].archivedAt).toBeTruthy()
  })
})
