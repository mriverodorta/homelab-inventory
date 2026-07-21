import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from './db/store.mjs'
import { registerProjectRoutes } from './project-routes.mjs'

const tempDirs = []
const stores = []
const servers = []

async function createContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-api-'))
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
  registerProjectRoutes(app, { withStore })
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })
  servers.push(server)
  const address = server.address()
  return { store, url: `http://127.0.0.1:${address.port}` }
}

async function requestJson(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { response, body: await response.json() }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('project routes', () => {
  it('round trips compatibility profiles and valid deterministic allocations through PUT and GET', async () => {
    const { store, url } = await createContext()
    store.createInventoryItems({
      type: 'server',
      name: 'Host',
      compatibility: {
        host: {
          storageSlots: [{
            id: 1,
            key: 'm2-1',
            label: 'M.2',
            count: 1,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
          }],
        },
      },
    })
    store.createInventoryItems({
      type: 'storage',
      name: 'Drive',
      specs: { interface: 'NVMe', formFactor: '2280' },
    })
    const submitted = store.getProject()
    submitted.assignments = [{
      id: 1,
      serverId: 'server:1',
      itemId: 'storage:1',
      type: 'storage',
      assignedAt: '2026-07-19T00:00:00.000Z',
    }]

    const saved = await requestJson(`${url}/api/project`, 'PUT', submitted)
    const loaded = await requestJson(`${url}/api/project`)

    expect(saved.response.status).toBe(200)
    expect(saved.body.assignments[0].allocation).toEqual({
      resourceType: 'storage', groupId: 1, positions: [0],
    })
    expect(loaded.body.items['server:1'].compatibility).toEqual(
      submitted.items['server:1'].compatibility,
    )
    expect(loaded.body.assignments).toEqual(saved.body.assignments)
  })

  it('rejects invalid nested compatibility fields with their exact path', async () => {
    const { store, url } = await createContext()
    store.createInventoryItems({ type: 'server', name: 'Host' })
    const submitted = store.getProject()
    submitted.items['server:1'].compatibility = {
      host: { storageSlots: [{ id: 1, key: 'm2-1', label: 'M.2', count: 0 }] },
    }

    const result = await requestJson(`${url}/api/project`, 'PUT', submitted)

    expect(result.response.status).toBe(400)
    expect(result.body.message).toContain(
      'Inventory item server:1 compatibility.host.storageSlots[0].count must be a positive integer.',
    )
  })

  it('returns a structured 409 and leaves the store atomic for an incompatible transition', async () => {
    const { store, url } = await createContext()
    store.createInventoryItems({
      type: 'server', name: 'Host',
      compatibility: {
        host: {
          storageSlots: [{ id: 1, key: 'm2-1', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
        },
      },
    })
    store.createInventoryItems({
      type: 'storage', name: 'SATA Drive', specs: { interface: 'SATA' },
    })
    const before = JSON.stringify(store.getProject())
    const submitted = store.getProject()
    submitted.assignments = [{
      id: 1, serverId: 'server:1', itemId: 'storage:1', type: 'storage',
      assignedAt: '2026-07-19T00:00:00.000Z',
    }]

    const result = await requestJson(`${url}/api/project`, 'PUT', submitted)

    expect(result.response.status).toBe(409)
    expect(result.body.code).toBe('hardware-incompatible')
    expect(result.body.message).toContain('storage.interface.mismatch')
    expect(JSON.stringify(store.getProject())).toBe(before)
  })
})
