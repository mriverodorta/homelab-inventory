import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'

function lifecycleErrorResponse(response, error) {
  if (!(error instanceof InventoryLifecycleError)) throw error

  response.status(error.status).json({
    message: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  })
}

function runWithInventoryStore(withStore, request, response, message, handler) {
  void withStore(request, response, async (store) => {
    try {
      await handler(store)
    } catch (error) {
      lifecycleErrorResponse(response, error)
    }
  }, { message })
}

function itemRef(request) {
  return { type: request.params.type, id: request.params.id }
}

function batchItems(request) {
  return request.body?.items
}

export function registerInventoryRoutes(app, { withStore }) {
  app.post('/api/inventory/items', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to create inventory items.', async (store) => {
      const wrapped = request.body?.item && typeof request.body.item === 'object'
      const item = wrapped ? request.body.item : request.body
      const quantity = wrapped ? (request.body.quantity ?? 1) : 1
      response.status(201).json(store.createInventoryItems(item, quantity))
    })
  })

  app.put('/api/inventory/items/:type/:id', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to update inventory item.', async (store) => {
      response.json(store.updateInventoryItem(itemRef(request), request.body?.item ?? request.body))
    })
  })

  app.post('/api/inventory/items/:type/:id/duplicate', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to duplicate inventory item.', async (store) => {
      response.status(201).json(store.duplicateInventoryItem(itemRef(request), request.body?.quantity ?? 1))
    })
  })

  app.get('/api/inventory/items/:type/:id/dependencies', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to inspect inventory dependencies.', async (store) => {
      response.json(store.getInventoryDependencies(itemRef(request)))
    })
  })

  app.post('/api/inventory/dependencies', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to inspect inventory dependencies.', async (store) => {
      response.json({ reports: store.getInventoryDependencyReports(batchItems(request)) })
    })
  })

  app.post('/api/inventory/items/:type/:id/archive', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to archive inventory item.', async (store) => {
      response.json(store.archiveInventoryItems([itemRef(request)]))
    })
  })

  app.post('/api/inventory/items/:type/:id/restore', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to restore inventory item.', async (store) => {
      response.json(store.restoreInventoryItems([itemRef(request)]))
    })
  })

  app.delete('/api/inventory/items/:type/:id', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to delete inventory item.', async (store) => {
      response.json(store.deleteInventoryItems([itemRef(request)]))
    })
  })

  for (const [action, method] of [
    ['archive', 'archiveInventoryItems'],
    ['restore', 'restoreInventoryItems'],
    ['delete', 'deleteInventoryItems'],
  ]) {
    app.post(`/api/inventory/batch/${action}`, (request, response) => {
      runWithInventoryStore(withStore, request, response, `Unable to ${action} inventory items.`, async (store) => {
        response.json(store[method](batchItems(request)))
      })
    })
  }
}
