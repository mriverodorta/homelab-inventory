import { createHash } from 'node:crypto'
import { InventoryMetadataError } from './contract.mjs'
import {
  inventoryMetadataCatalogPayload,
  inventoryMetadataItemPayload,
} from '../live-events/inventory-metadata-payloads.mjs'

function positiveId(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    throw new InventoryMetadataError(`${label} must be a positive safe integer.`)
  }
  const id = Number(value)
  if (!Number.isSafeInteger(id)) throw new InventoryMetadataError(`${label} must be a positive safe integer.`)
  return id
}

function etag(payload) {
  return `"${createHash('sha256').update(JSON.stringify(payload)).digest('base64url')}"`
}

function publicOption(option) {
  const { normalizedLabel: _normalizedLabel, ...payload } = option
  return payload
}

function publicDefinition(definition) {
  const { normalizedName: _normalizedName, options, ...payload } = definition
  return { ...payload, options: options.map(publicOption) }
}

function publicTag(tag) {
  const { normalizedName: _normalizedName, ...payload } = tag
  return payload
}

function publicCatalog(catalog) {
  return {
    revision: catalog.revision,
    definitions: catalog.definitions.map(publicDefinition),
    tags: catalog.tags.map(publicTag),
  }
}

function publicItemMetadata(metadata) {
  return {
    ...metadata,
    definitions: metadata.definitions.map(publicDefinition),
    tags: metadata.tags.map(publicTag),
  }
}

function failure(response, error) {
  if (!(error instanceof InventoryMetadataError)) throw error
  response.status(error.status).json({
    message: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  })
}

function withMetadataStore(withStore, request, response, message, handler) {
  void withStore(request, response, async (store) => {
    try {
      await handler(store, store.inventoryMetadata)
    } catch (error) {
      failure(response, error)
    }
  }, { message })
}

function publishCatalog(eventBus, store, { definitionIds = [], tagIds = [] } = {}) {
  eventBus?.publish({
    scope: store,
    topics: ['inventory-metadata:catalog'],
    kind: 'inventory-metadata.catalog-changed',
    payload: inventoryMetadataCatalogPayload({ definitionIds, tagIds }),
  })
}

function publishItem(eventBus, store, result) {
  const payload = inventoryMetadataItemPayload({ itemId: result.itemId, projectIds: result.affectedProjectIds })
  if (payload.projectIds.length === 0) return
  eventBus?.publish({
    scope: store,
    topics: payload.projectIds.map((projectId) => `inventory-metadata:${projectId}`),
    kind: 'inventory-metadata.item-changed',
    payload,
  })
}

function itemRef(request) {
  return {
    type: request.params.type,
    id: positiveId(request.params.id, 'Inventory item ID'),
  }
}

function etagResponse(request, response, payload) {
  const responseEtag = etag(payload)
  response.set('Cache-Control', 'private, no-cache').set('ETag', responseEtag)
  if (request.get('if-none-match') === responseEtag) return response.status(304).end()
  return response.json(payload)
}

export function registerInventoryMetadataRoutes(app, { withStore, eventBus = null }) {
  app.get('/api/inventory-metadata/catalog', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to load inventory metadata.', (_store, repository) => {
      const payload = publicCatalog(repository.listCatalog({ includeArchived: request.query.includeArchived === 'true' }))
      return etagResponse(request, response, payload)
    })
  })

  app.put('/api/inventory-metadata/definitions/order', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to reorder custom fields.', (store, repository) => {
      const catalog = publicCatalog(repository.reorderDefinitions(request.body?.ids))
      publishCatalog(eventBus, store, { definitionIds: request.body?.ids })
      response.json(catalog)
    })
  })

  app.post('/api/inventory-metadata/definitions', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to create the custom field.', (store, repository) => {
      const definition = repository.createDefinition(request.body)
      publishCatalog(eventBus, store, { definitionIds: [definition.id] })
      response.status(201).json({ definition: publicDefinition(definition) })
    })
  })

  app.put('/api/inventory-metadata/definitions/:id', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to update the custom field.', (store, repository) => {
      const definition = repository.updateDefinition(
        positiveId(request.params.id, 'Custom field definition ID'),
        request.body?.expectedRevision,
        request.body,
        { deleteValuesForRemovedTypes: request.body?.deleteValuesForRemovedTypes === true },
      )
      publishCatalog(eventBus, store, { definitionIds: [definition.id] })
      response.json({ definition: publicDefinition(definition) })
    })
  })

  for (const action of ['archive', 'restore']) {
    app.post(`/api/inventory-metadata/definitions/:id/${action}`, (request, response) => {
      withMetadataStore(withStore, request, response, `Unable to ${action} the custom field.`, (store, repository) => {
        const id = positiveId(request.params.id, 'Custom field definition ID')
        const definition = action === 'archive'
          ? repository.archiveDefinition(id, request.body?.expectedRevision)
          : repository.restoreDefinition(id, request.body?.expectedRevision)
        publishCatalog(eventBus, store, { definitionIds: [id] })
        response.json({ definition: publicDefinition(definition) })
      })
    })
  }

  app.get('/api/inventory-metadata/definitions/:id/impact', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to inspect custom field impact.', (_store, repository) => {
      response.json({ impact: repository.definitionImpact(positiveId(request.params.id, 'Custom field definition ID')) })
    })
  })

  app.delete('/api/inventory-metadata/definitions/:id', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to permanently delete the custom field.', (store, repository) => {
      const id = positiveId(request.params.id, 'Custom field definition ID')
      const impact = repository.deleteDefinitionPermanently(id, request.body?.confirmationName)
      publishCatalog(eventBus, store, { definitionIds: [id] })
      response.json({ deleted: true, impact })
    })
  })

  app.put('/api/inventory-metadata/tags/order', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to reorder inventory tags.', (store, repository) => {
      const catalog = publicCatalog(repository.reorderTags(request.body?.ids))
      publishCatalog(eventBus, store, { tagIds: request.body?.ids })
      response.json(catalog)
    })
  })

  app.post('/api/inventory-metadata/tags', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to create the inventory tag.', (store, repository) => {
      const tag = repository.createTag(request.body)
      publishCatalog(eventBus, store, { tagIds: [tag.id] })
      response.status(201).json({ tag: publicTag(tag) })
    })
  })

  app.put('/api/inventory-metadata/tags/:id', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to update the inventory tag.', (store, repository) => {
      const tag = repository.updateTag(
        positiveId(request.params.id, 'Inventory tag ID'),
        request.body?.expectedRevision,
        request.body,
      )
      publishCatalog(eventBus, store, { tagIds: [tag.id] })
      response.json({ tag: publicTag(tag) })
    })
  })

  for (const action of ['archive', 'restore']) {
    app.post(`/api/inventory-metadata/tags/:id/${action}`, (request, response) => {
      withMetadataStore(withStore, request, response, `Unable to ${action} the inventory tag.`, (store, repository) => {
        const id = positiveId(request.params.id, 'Inventory tag ID')
        const tag = action === 'archive'
          ? repository.archiveTag(id, request.body?.expectedRevision)
          : repository.restoreTag(id, request.body?.expectedRevision)
        publishCatalog(eventBus, store, { tagIds: [id] })
        response.json({ tag: publicTag(tag) })
      })
    })
  }

  app.get('/api/inventory-metadata/tags/:id/impact', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to inspect inventory tag impact.', (_store, repository) => {
      response.json({ impact: repository.tagImpact(positiveId(request.params.id, 'Inventory tag ID')) })
    })
  })

  app.delete('/api/inventory-metadata/tags/:id', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to permanently delete the inventory tag.', (store, repository) => {
      const id = positiveId(request.params.id, 'Inventory tag ID')
      const impact = repository.deleteTagPermanently(id, request.body?.confirmationName)
      publishCatalog(eventBus, store, { tagIds: [id] })
      response.json({ deleted: true, impact })
    })
  })

  app.get('/api/inventory/items/:type/:id/metadata', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to load inventory item metadata.', (store) => {
      const payload = publicItemMetadata(store.getInventoryItemMetadata(itemRef(request)))
      return etagResponse(request, response, payload)
    })
  })

  app.put('/api/inventory/items/:type/:id/metadata', (request, response) => {
    withMetadataStore(withStore, request, response, 'Unable to update inventory item metadata.', (store) => {
      const result = store.updateInventoryItemMetadata(itemRef(request), request.body)
      publishItem(eventBus, store, result)
      response.json({
        metadata: publicItemMetadata(result.metadata),
        affectedProjectIds: result.affectedProjectIds,
        affectedProjectRevisions: result.affectedProjectRevisions,
      })
    })
  })
}
