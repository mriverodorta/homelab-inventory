import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InventoryMetadataError } from './contract.mjs'
import { InventoryMetadataFilterService } from './filter-service.mjs'
import { registerInventoryMetadataRoutes } from './routes.mjs'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fixture() {
  const definition = { id: 1, name: 'Lifecycle', revision: 1, options: [] }
  const tag = { id: 2, name: 'Production', revision: 1 }
  const repository = {
    listCatalog: vi.fn(() => ({ revision: 1, definitions: [definition], tags: [tag] })),
    createDefinition: vi.fn(() => definition),
    updateDefinition: vi.fn(() => ({ ...definition, revision: 2 })),
    archiveDefinition: vi.fn(() => ({ ...definition, revision: 2, archivedAt: 'now' })),
    restoreDefinition: vi.fn(() => ({ ...definition, revision: 2, archivedAt: null })),
    definitionImpact: vi.fn(() => ({ definitionId: 1, itemCount: 3 })),
    deleteDefinitionPermanently: vi.fn(() => ({ definitionId: 1, itemCount: 3 })),
    reorderDefinitions: vi.fn(() => ({ revision: 2, definitions: [definition], tags: [tag] })),
    createTag: vi.fn(() => tag),
    updateTag: vi.fn(() => ({ ...tag, revision: 2 })),
    archiveTag: vi.fn(() => ({ ...tag, revision: 2, archivedAt: 'now' })),
    restoreTag: vi.fn(() => ({ ...tag, revision: 2, archivedAt: null })),
    tagImpact: vi.fn(() => ({ tagId: 2, itemCount: 4 })),
    deleteTagPermanently: vi.fn(() => ({ tagId: 2, itemCount: 4 })),
    reorderTags: vi.fn(() => ({ revision: 2, definitions: [definition], tags: [tag] })),
    getItemMetadata: vi.fn(() => ({ itemId: 91, definitions: [definition], values: [], tags: [] })),
    replaceItemMetadata: vi.fn(() => ({ itemId: 91, affectedProjectIds: [1, 3] })),
  }
  const store = {
    core: { database: {} },
    inventoryMetadata: repository,
    inventoryScope: { resolve: vi.fn(() => 91) },
    getInventoryItemMetadata: vi.fn(() => ({ itemId: 91, definitions: [definition], values: [], tags: [] })),
    updateInventoryItemMetadata: vi.fn(() => ({
      metadata: { itemId: 91, definitions: [definition], values: [], tags: [] },
      itemId: 91,
      affectedProjectIds: [1, 3],
      affectedProjectRevisions: { 1: 4, 3: 8 },
    })),
  }
  const eventBus = { publish: vi.fn() }
  const app = express()
  app.use(express.json())
  registerInventoryMetadataRoutes(app, {
    eventBus,
    withStore: async (_request, response, handler) => {
      try { await handler(store) } catch (error) { response.status(500).json({ message: error.message }) }
    },
  })
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.address().port}`, repository, store, eventBus }
}

async function json(url, path, options = {}) {
  return fetch(`${url}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
}

describe('inventory metadata routes', () => {
  it('returns an ETag-aware compact catalog', async () => {
    const { url, repository } = await fixture()
    const first = await json(url, '/api/inventory-metadata/catalog')
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ definitions: [{ id: 1 }], tags: [{ id: 2 }] })
    const second = await json(url, '/api/inventory-metadata/catalog', {
      headers: { 'If-None-Match': first.headers.get('etag') },
    })
    expect(second.status).toBe(304)
    expect(repository.listCatalog).toHaveBeenCalledTimes(2)
  })

  it('returns an ETag-aware project metadata projection', async () => {
    const projectProjection = vi.spyOn(InventoryMetadataFilterService.prototype, 'projectProjection')
      .mockReturnValue({ projectId: 1, rows: [], matchingItemIds: [] })
    const { url } = await fixture()
    const first = await json(url, '/api/projects/1/inventory-metadata/query', {
      method: 'POST', body: JSON.stringify({ scope: 'systems', definitionIds: [4] }),
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ projectId: 1, rows: [], matchingItemIds: [] })
    expect(projectProjection).toHaveBeenCalledWith(1, { scope: 'systems', definitionIds: [4] })
    projectProjection.mockRestore()
  })

  it('exposes definition and tag lifecycle operations', async () => {
    const { url, repository, eventBus } = await fixture()
    expect((await json(url, '/api/inventory-metadata/definitions', { method: 'POST', body: '{}' })).status).toBe(201)
    expect((await json(url, '/api/inventory-metadata/definitions/1', { method: 'PUT', body: JSON.stringify({ expectedRevision: 1 }) })).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/definitions/1/archive', { method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) })).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/definitions/1/restore', { method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) })).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/definitions/1/impact')).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/definitions/1', { method: 'DELETE', body: JSON.stringify({ confirmationName: 'Lifecycle' }) })).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/definitions/order', { method: 'PUT', body: JSON.stringify({ ids: [1] }) })).status).toBe(200)

    expect((await json(url, '/api/inventory-metadata/tags', { method: 'POST', body: '{}' })).status).toBe(201)
    expect((await json(url, '/api/inventory-metadata/tags/2', { method: 'PUT', body: JSON.stringify({ expectedRevision: 1 }) })).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/tags/2/archive', { method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) })).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/tags/2/restore', { method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) })).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/tags/2/impact')).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/tags/2', { method: 'DELETE', body: JSON.stringify({ confirmationName: 'Production' }) })).status).toBe(200)
    expect((await json(url, '/api/inventory-metadata/tags/order', { method: 'PUT', body: JSON.stringify({ ids: [2] }) })).status).toBe(200)

    expect(repository.createDefinition).toHaveBeenCalled()
    expect(repository.deleteTagPermanently).toHaveBeenCalledWith(2, 'Production')
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      topics: ['inventory-metadata:catalog'],
      kind: 'inventory-metadata.catalog-changed',
    }))
  })

  it('reads and replaces item metadata through legacy inventory identity', async () => {
    const { url, store, eventBus } = await fixture()
    const read = await json(url, '/api/inventory/items/server/7/metadata')
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ itemId: 91 })
    const write = await json(url, '/api/inventory/items/server/7/metadata', {
      method: 'PUT',
      body: JSON.stringify({ values: [], tagIds: [] }),
    })
    expect(write.status).toBe(200)
    expect(store.getInventoryItemMetadata).toHaveBeenCalledWith({ type: 'server', id: 7 })
    expect(store.updateInventoryItemMetadata).toHaveBeenCalledWith(
      { type: 'server', id: 7 },
      { values: [], tagIds: [] },
    )
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      topics: ['inventory-metadata:1', 'inventory-metadata:3'],
      payload: { itemId: 91, projectIds: [1, 3] },
    }))
  })

  it('maps structured validation and conflict failures', async () => {
    const { url, repository } = await fixture()
    repository.createDefinition.mockImplementation(() => {
      throw new InventoryMetadataError('Name already exists.', {
        code: 'inventory-metadata-conflict', status: 409, details: { id: 1 },
      })
    })
    const response = await json(url, '/api/inventory-metadata/definitions', { method: 'POST', body: '{}' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      message: 'Name already exists.',
      code: 'inventory-metadata-conflict',
      details: { id: 1 },
    })
  })
})
