import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from './db/store.mjs'
import { registerRegistryRoutes } from './registry-routes.mjs'

const resources = []

async function createServer() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-routes-'))
  const store = new HomelabInventoryStore({
    appVersion: '1.0.0',
    dataDir,
    legacyProjectPath: path.join(dataDir, 'legacy.json'),
    saveDebounceMs: 1,
    seedEmptyData: false,
    seedDir: path.join(dataDir, 'missing-seed'),
  })
  await store.init()
  const app = express()
  app.use(express.json())
  const withStore = async (_request, _response, handler) => handler(store)
  registerRegistryRoutes(app, { withStore })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  resources.push({ dataDir, store, server })
  const address = server.address()
  return { baseUrl: `http://127.0.0.1:${address.port}`, store }
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ dataDir, store, server }) => {
    await store.flush().catch(() => {})
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(dataDir, { recursive: true, force: true })
  }))
})

describe('registry routes', () => {
  it('updates local registry preferences without changing the project revision', async () => {
    const { baseUrl, store } = await createServer()
    const revision = store.getEngineRevision()
    const response = await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { mode: 'offline', defaultInventorySource: 'manual' } }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).settings).toMatchObject({ mode: 'offline', defaultInventorySource: 'manual' })
    expect(store.getEngineRevision()).toBe(revision)
  })

  it('creates, exports, deletes, previews, and imports sanitized private templates', async () => {
    const { baseUrl } = await createServer()
    const created = await fetch(`${baseUrl}/api/registry/private-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Reusable server',
        item: {
          type: 'server',
          name: 'Example server',
          manufacturer: 'Example',
          properties: { lanIp: '192.168.1.10' },
        },
      }),
    })
    const createdPayload = await created.json()
    expect(created.status).toBe(201)
    expect(createdPayload.privateTemplates[0]).toMatchObject({ id: 1, name: 'Reusable server' })
    expect(JSON.stringify(createdPayload)).not.toContain('192.168.1.10')

    const exported = await fetch(`${baseUrl}/api/registry/private-templates/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    }).then((response) => response.json())
    expect(exported.checksum).toMatch(/^[a-f0-9]{64}$/)

    expect((await fetch(`${baseUrl}/api/registry/private-templates/1`, { method: 'DELETE' })).status).toBe(200)
    const preview = await fetch(`${baseUrl}/api/registry/private-templates/import/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: exported }),
    }).then((response) => response.json())
    expect(preview).toMatchObject({ valid: true, errors: [] })

    const imported = await fetch(`${baseUrl}/api/registry/private-templates/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: exported }),
    }).then((response) => response.json())
    expect(imported).toMatchObject({ imported: 1, skipped: 0 })
    expect(imported.registry.privateTemplates[0].id).toBe(1)
  })

  it('rejects invalid packs and stale preference writes', async () => {
    const { baseUrl } = await createServer()
    await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { defaultInventorySource: 'manual' } }),
    })
    const conflict = await fetch(`${baseUrl}/api/registry/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { defaultInventorySource: 'catalog' }, expectedUpdatedAt: null }),
    })
    expect(conflict.status).toBe(409)

    const invalid = await fetch(`${baseUrl}/api/registry/private-templates/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: { format: 'other', version: 1, templates: [] } }),
    })
    expect(invalid.status).toBe(400)
  })
})
