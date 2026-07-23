import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalPowerPorts } from '../shared/power-ports.mjs'
import { HomelabInventoryStore } from './db/store.mjs'
import { registerInventoryRoutes } from './inventory-routes.mjs'

const tempDirs = []
const stores = []

async function createTestContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-api-'))
  tempDirs.push(dataDir)
  const store = new HomelabInventoryStore({
    appVersion: '1.0.0',
    dataDir,
    legacyProjectPath: path.join(dataDir, 'legacy.json'),
    saveDebounceMs: 1,
    seedEmptyData: false,
    seedDir: path.join(dataDir, 'missing-seed'),
  })
  await store.init()
  stores.push(store)

  const app = express()
  app.use(express.json())
  const withStore = async (_request, response, handler, options = {}) => {
    try {
      await handler(store)
    } catch (error) {
      response.status(options.status ?? 500).json({
        message: error instanceof Error ? error.message : options.message,
      })
    }
  }
  registerInventoryRoutes(app, { withStore })

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })
  const address = server.address()

  return { store, server, url: `http://127.0.0.1:${address.port}` }
}

async function jsonRequest(url, pathName, options = {}) {
  const response = await fetch(`${url}${pathName}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  return { response, body: await response.json() }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('inventory lifecycle routes', () => {
  it('creates quantities and retains backward-compatible single-item payloads', async () => {
    const { store, server, url } = await createTestContext()

    try {
      const quantity = await jsonRequest(url, '/api/inventory/items', {
        method: 'POST',
        body: JSON.stringify({ item: { type: 'cpu', name: 'CPU' }, quantity: 2 }),
      })
      const legacy = await jsonRequest(url, '/api/inventory/items', {
        method: 'POST',
        body: JSON.stringify({ type: 'ram', name: 'RAM' }),
      })

      expect(quantity.response.status).toBe(201)
      expect(quantity.body.items['cpu:2'].name).toBe('CPU')
      expect(legacy.response.status).toBe(201)
      expect(legacy.body.items['ram:1'].name).toBe('RAM')
      expect(store.databases.inventory.data.cpus).toHaveLength(2)
    } finally {
      server.close()
    }
  })

  it('preserves compatibility profiles for quantities and regenerates nested resource IDs for duplicates', async () => {
    const { store, server, url } = await createTestContext()
    const compatibility = {
      host: {
        storageSlots: [{ id: 1, key: 'storage-custom', label: 'M.2', count: 1 }],
        expansionSlots: [{
          id: 1,
          key: 'expansion-custom',
          label: 'PCIe',
          count: 1,
          interfaceFamily: 'pcie',
        }],
      },
      extension: { retained: true },
    }

    try {
      const quantity = await jsonRequest(url, '/api/inventory/items', {
        method: 'POST',
        body: JSON.stringify({ item: { type: 'server', name: 'Node', compatibility }, quantity: 2 }),
      })
      const duplicated = await jsonRequest(url, '/api/inventory/items/server/1/duplicate', {
        method: 'POST',
        body: JSON.stringify({ quantity: 1 }),
      })

      expect(quantity.response.status).toBe(201)
      expect(quantity.body.items['server:1'].compatibility).toEqual(compatibility)
      expect(quantity.body.items['server:2'].compatibility).toEqual(compatibility)
      expect(quantity.body.items['server:2'].compatibility).not.toBe(
        quantity.body.items['server:1'].compatibility,
      )
      expect(duplicated.response.status).toBe(201)
      expect(duplicated.body.items['server:3'].compatibility).toEqual({
        host: {
          storageSlots: [{ id: 1, key: 'storage-custom', label: 'M.2', count: 1 }],
          expansionSlots: [{
            id: 1,
            key: 'expansion-custom',
            label: 'PCIe',
            count: 1,
            interfaceFamily: 'pcie',
          }],
        },
        extension: { retained: true },
      })
      expect(store.getProject().items['server:1'].compatibility).toEqual(compatibility)
    } finally {
      server.close()
    }
  })

  it('returns exact nested validation paths for invalid compatibility profiles', async () => {
    const { server, url } = await createTestContext()

    try {
      const invalid = await jsonRequest(url, '/api/inventory/items', {
        method: 'POST',
        body: JSON.stringify({
          item: {
            type: 'server',
            name: 'Node',
            compatibility: {
              host: { storageSlots: [{ id: 1, key: 'storage-1', label: 'M.2', count: 0 }] },
            },
          },
          quantity: 1,
        }),
      })

      expect(invalid.response.status).toBe(400)
      expect(invalid.body.message).toContain(
        'Inventory item server:1 compatibility.host.storageSlots[0].count must be a positive integer.',
      )
    } finally {
      server.close()
    }
  })

  it('returns 400 for invalid input and 404 for missing records', async () => {
    const { server, url } = await createTestContext()

    try {
      const invalid = await jsonRequest(url, '/api/inventory/items', {
        method: 'POST',
        body: JSON.stringify({ item: { type: 'cpu', name: '' }, quantity: 1 }),
      })
      const missing = await jsonRequest(url, '/api/inventory/items/cpu/42/dependencies')

      expect(invalid.response.status).toBe(400)
      expect(invalid.body.code).toBe('invalid-inventory-item')
      expect(missing.response.status).toBe(404)
      expect(missing.body.code).toBe('inventory-item-not-found')
    } finally {
      server.close()
    }
  })

  it('updates, duplicates, previews, archives, and restores through dedicated routes', async () => {
    const { store, server, url } = await createTestContext()
    store.createInventoryItems({ type: 'server', name: 'Node', manufacturer: 'Example' })

    try {
      const updated = await jsonRequest(url, '/api/inventory/items/server/1', {
        method: 'PUT',
        body: JSON.stringify({
          item: {
            name: 'Renamed Node',
            manufacturer: 'Example',
            specs: { formFactor: 'Mini' },
          },
        }),
      })
      const duplicated = await jsonRequest(url, '/api/inventory/items/server/1/duplicate', {
        method: 'POST',
        body: JSON.stringify({ quantity: 2 }),
      })
      const dependencies = await jsonRequest(url, '/api/inventory/dependencies', {
        method: 'POST',
        body: JSON.stringify({ items: [{ type: 'server', id: 2 }, { type: 'server', id: 3 }] }),
      })
      const archived = await jsonRequest(url, '/api/inventory/batch/archive', {
        method: 'POST',
        body: JSON.stringify({ items: [{ type: 'server', id: 2 }, { type: 'server', id: 3 }] }),
      })
      const restored = await jsonRequest(url, '/api/inventory/batch/restore', {
        method: 'POST',
        body: JSON.stringify({ items: [{ type: 'server', id: 2 }, { type: 'server', id: 3 }] }),
      })

      expect(updated.response.status).toBe(200)
      expect(updated.body.items['server:1']).toMatchObject({
        id: 1,
        name: 'Renamed Node',
        specs: { formFactor: 'Mini' },
      })
      expect(duplicated.response.status).toBe(201)
      expect(duplicated.body.items['server:2'].name).toBe('Renamed Node #2')
      expect(duplicated.body.items['server:3'].name).toBe('Renamed Node #3')
      expect(dependencies.response.status).toBe(200)
      expect(dependencies.body.reports.map((report) => report.blocked)).toEqual([false, false])
      expect(archived.response.status).toBe(200)
      expect(archived.body.items['server:2'].archivedAt).toBeTruthy()
      expect(archived.body.items['server:2'].archivedAt).toBe(archived.body.items['server:3'].archivedAt)
      expect(restored.response.status).toBe(200)
      expect(restored.body.items['server:2'].archivedAt).toBeUndefined()
      expect(restored.body.items['server:3'].archivedAt).toBeUndefined()
    } finally {
      server.close()
    }
  })

  it('patches layout properties without changing connected power endpoints', async () => {
    const { store, server, url } = await createTestContext()
    const upsSpecs = { outlets: 1, batteryBackupOutlets: 1, surgeProtectedOutlets: 0 }
    const stripSpecs = { outlets: 1, surgeProtected: true }
    store.databases.inventory.data.upsSystems.push({
      id: 1,
      name: 'UPS',
      specs: upsSpecs,
      ports: canonicalPowerPorts({ type: 'ups', specs: upsSpecs }),
    })
    store.databases.inventory.data.powerStrips.push({
      id: 1,
      name: 'Power strip',
      specs: stripSpecs,
      ports: canonicalPowerPorts({ type: 'powerStrip', specs: stripSpecs }),
    })
    store.databases.project.data.connections.push({
      id: 1,
      from: { itemType: 'ups', itemId: 1, portId: 1 },
      to: { itemType: 'powerStrip', itemId: 1, portId: 1 },
      type: 'power',
      createdAt: '2026-07-21T00:00:00.000Z',
    })
    const portsBefore = structuredClone(store.getProject().items['ups:1'].ports)

    try {
      const updated = await jsonRequest(url, '/api/inventory/items/ups/1/properties', {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            canvasOrientation: 'vertical',
            upsOutletGroupOrder: 'surge-battery',
          },
        }),
      })

      expect(updated.response.status).toBe(200)
      expect(updated.body.items['ups:1'].properties).toEqual({
        canvasOrientation: 'vertical',
        upsOutletGroupOrder: 'surge-battery',
      })
      expect(updated.body.items['ups:1'].ports).toEqual(portsBefore)
      expect(updated.body.connections).toEqual(store.getProject().connections)
    } finally {
      server.close()
    }
  })

  it('returns structured dependency reports and 409 for blocked mutations', async () => {
    const { store, server, url } = await createTestContext()
    store.createInventoryItems({ type: 'server', name: 'Server' })
    store.databases.project.data.placements.push({ itemType: 'server', itemId: 1, x: 10, y: 20 })

    try {
      const dependencies = await jsonRequest(url, '/api/inventory/items/server/1/dependencies')
      const archive = await jsonRequest(url, '/api/inventory/items/server/1/archive', { method: 'POST' })

      expect(dependencies.response.status).toBe(200)
      expect(dependencies.body.reasons[0].kind).toBe('canvas-placement')
      expect(archive.response.status).toBe(409)
      expect(archive.body.code).toBe('inventory-dependencies')
      expect(archive.body.details.reports[0].reasons[0].kind).toBe('canvas-placement')
      expect(store.getProject().items['server:1'].archivedAt).toBeUndefined()
    } finally {
      server.close()
    }
  })

  it('keeps blocked batch deletion atomic and supports archive/restore/delete routes', async () => {
    const { store, server, url } = await createTestContext()
    store.createInventoryItems({ type: 'server', name: 'Server' })
    store.createInventoryItems({ type: 'cpu', name: 'CPU' }, 3)
    store.databases.project.data.assignments.push({
      id: 1,
      hostType: 'server',
      hostId: 1,
      itemType: 'cpu',
      itemId: 2,
      type: 'cpu',
      assignedAt: '2026-07-19T00:00:00.000Z',
    })

    try {
      const blocked = await jsonRequest(url, '/api/inventory/batch/delete', {
        method: 'POST',
        body: JSON.stringify({ items: [{ type: 'cpu', id: 1 }, { type: 'cpu', id: 2 }] }),
      })
      expect(blocked.response.status).toBe(409)
      expect(store.databases.inventory.data.cpus).toHaveLength(3)

      const activeDelete = await jsonRequest(url, '/api/inventory/items/cpu/3', { method: 'DELETE' })
      expect(activeDelete.response.status).toBe(409)
      expect(activeDelete.body.code).toBe('inventory-item-not-archived')

      expect((await jsonRequest(url, '/api/inventory/items/cpu/3/archive', { method: 'POST' })).response.status).toBe(200)
      expect((await jsonRequest(url, '/api/inventory/items/cpu/3/restore', { method: 'POST' })).response.status).toBe(200)
      expect((await jsonRequest(url, '/api/inventory/items/cpu/3/archive', { method: 'POST' })).response.status).toBe(200)
      expect((await jsonRequest(url, '/api/inventory/items/cpu/3', { method: 'DELETE' })).response.status).toBe(200)
      expect(store.getProject().items['cpu:3']).toBeUndefined()
    } finally {
      server.close()
    }
  })

  it('previews and confirms NAS power configuration changes through the dedicated route', async () => {
    const { store, server, url } = await createTestContext()
    store.createInventoryItems({
      type: 'nas',
      name: 'External NAS',
      specs: { powerConfiguration: 'external-adapter' },
    })
    store.createInventoryItems({ type: 'powerAdapter', name: 'OEM adapter' })
    store.databases.project.data.assignments.push({
      id: 1,
      hostType: 'nas',
      hostId: 1,
      itemType: 'powerAdapter',
      itemId: 1,
      type: 'powerAdapter',
      assignedAt: '2026-07-22T00:00:00.000Z',
    })

    try {
      const blockedGenericEdit = await jsonRequest(url, '/api/inventory/items/nas/1', {
        method: 'PUT',
        body: JSON.stringify({
          type: 'nas',
          name: 'External NAS',
          specs: { powerConfiguration: 'internal-psu' },
        }),
      })
      expect(blockedGenericEdit.response.status).toBe(409)
      expect(blockedGenericEdit.body.code).toBe('nas-power-configuration-command-required')

      const preview = await jsonRequest(url, '/api/inventory/items/nas/1/power-configuration', {
        method: 'POST',
        body: JSON.stringify({ powerConfiguration: 'internal-psu' }),
      })
      expect(preview.response.status).toBe(200)
      expect(preview.body.status).toBe('confirmation-required')
      expect(preview.body.impact.releasedAdapter).toMatchObject({ id: 1, name: 'OEM adapter' })

      const applied = await jsonRequest(url, '/api/inventory/items/nas/1/power-configuration', {
        method: 'POST',
        body: JSON.stringify({ powerConfiguration: 'internal-psu', confirmed: true }),
      })
      expect(applied.response.status).toBe(200)
      expect(applied.body.status).toBe('applied')
      expect(applied.body.project.items['nas:1'].specs.powerConfiguration).toBe('internal-psu')
      expect(applied.body.project.assignments).toEqual([])
    } finally {
      server.close()
    }
  })
})
