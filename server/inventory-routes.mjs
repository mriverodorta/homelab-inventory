import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'
import { isRelationalId } from './db/relational-ids.mjs'
import { computeCatalogDigests } from '../packages/catalog-protocol/src/index.ts'

function lifecycleErrorResponse(response, error) {
  if (!(error instanceof InventoryLifecycleError)) throw error

  response.status(error.status).json({
    message: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  })
}

function inventoryStoreScope(store, request) {
  const rawProjectId = request.query?.projectId
  const rawWorkspaceId = request.query?.workspaceId
  if (rawProjectId === undefined && rawWorkspaceId === undefined) return { store, scoped: false }
  if (rawProjectId === undefined || rawWorkspaceId === undefined) {
    throw new InventoryLifecycleError('Inventory project and workspace scope must be provided together.', {
      code: 'invalid-inventory-scope',
      status: 400,
    })
  }
  const scopedProjectId = Number(rawProjectId)
  const scopedWorkspaceId = Number(rawWorkspaceId)
  if (!isRelationalId(scopedProjectId) || !isRelationalId(scopedWorkspaceId)) {
    throw new InventoryLifecycleError('Inventory project and workspace IDs must be positive safe integers.', {
      code: 'invalid-inventory-scope',
      status: 400,
    })
  }
  try {
    return { store: store.forWorkspace(scopedProjectId, scopedWorkspaceId), scoped: true }
  } catch (error) {
    throw new InventoryLifecycleError(
      error instanceof Error ? error.message : 'Inventory workspace scope was not found.',
      { code: 'inventory-scope-not-found', status: 404 },
    )
  }
}

function runWithInventoryStore(withStore, request, response, message, handler) {
  void withStore(request, response, async (store) => {
    try {
      const scope = inventoryStoreScope(store, request)
      await handler(scope.store, scope.scoped)
    } catch (error) {
      lifecycleErrorResponse(response, error)
    }
  }, { message })
}

function itemRef(request) {
  const rawId = request.params.id
  const id = typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId)
    ? Number(rawId)
    : null

  return { type: request.params.type, id: isRelationalId(id) ? id : null }
}

function nasItemRef(request) {
  const rawId = request.params.id
  const id = typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId)
    ? Number(rawId)
    : null
  return { type: 'nas', id: isRelationalId(id) ? id : null }
}

function batchItems(request) {
  return request.body?.items
}

function projectId(request) {
  const parsed = Number(request.params.projectId)
  if (!isRelationalId(parsed)) {
    throw new InventoryLifecycleError('Project ID must be a positive safe integer.', {
      code: 'invalid-project-id',
      status: 400,
    })
  }
  return parsed
}

function submittedProjectId(value, label) {
  if (!isRelationalId(value)) {
    throw new InventoryLifecycleError(`${label} must be a positive safe integer.`, {
      code: 'invalid-project-id',
      status: 400,
    })
  }
  return value
}

export function registerInventoryRoutes(app, { withStore, onHostsDeleted = null }) {
  app.get('/api/projects/:projectId/inventory/global-available', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to list available global inventory.', async (store) => {
      response.json({ items: store.listAvailableGlobalInventory(projectId(request)) })
    })
  })

  app.post('/api/projects/:projectId/inventory/items', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to create project inventory items.', async (store) => {
      const wrapped = request.body?.item && typeof request.body.item === 'object'
      const item = wrapped ? request.body.item : request.body
      const quantity = wrapped ? (request.body.quantity ?? 1) : 1
      const metadata = wrapped ? (request.body.metadata ?? null) : null
      response.status(201).json(store.createInventoryItemsForProject(projectId(request), item, quantity, metadata))
    })
  })

  app.post('/api/inventory/items/:type/:id/scope', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to change inventory scope.', async (store) => {
      response.json(store.setInventoryScope(itemRef(request), request.body ?? {}))
    })
  })

  app.post('/api/projects/:projectId/inventory/:type/:id/membership', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to add global inventory to the project.', async (store) => {
      response.status(201).json(store.addGlobalInventoryMembership(projectId(request), itemRef(request)))
    })
  })

  app.delete('/api/projects/:projectId/inventory/:type/:id/membership', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to remove global inventory from the project.', async (store) => {
      response.json(store.removeGlobalInventoryMembership(projectId(request), itemRef(request)))
    })
  })

  app.post('/api/projects/:projectId/inventory/:type/:id/duplicate', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to duplicate inventory into the project.', async (store) => {
      response.status(201).json(store.duplicateInventoryToProject(
        submittedProjectId(request.body?.sourceProjectId, 'Source project ID'),
        projectId(request),
        itemRef(request),
      ))
    })
  })

  app.post('/api/inventory/items', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to create inventory items.', async (store, scoped) => {
      const wrapped = request.body?.item && typeof request.body.item === 'object'
      const item = wrapped ? request.body.item : request.body
      const quantity = wrapped ? (request.body.quantity ?? 1) : 1
      const metadata = wrapped ? (request.body.metadata ?? null) : null
      response.status(201).json(scoped
        ? store.createScopedInventoryItems(item, quantity, metadata)
        : store.createInventoryItems(item, quantity, metadata))
    })
  })

  app.put('/api/inventory/items/:type/:id', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to update inventory item.', async (store) => {
      const ref = itemRef(request)
      const input = request.body?.item ?? request.body
      const { contentHash } = await computeCatalogDigests({ ...input, type: ref.type })
      response.json(store.updateInventoryItemAndReconcileCatalog(ref, input, contentHash))
    })
  })

  app.post('/api/inventory/items/nas/:id/power-configuration', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to change NAS power configuration.', async (store) => {
      response.json(store.changeNasPowerConfiguration(
        nasItemRef(request),
        request.body?.powerConfiguration,
        request.body?.confirmed === true,
      ))
    })
  })

  app.patch('/api/inventory/items/:type/:id/properties', (request, response) => {
    runWithInventoryStore(withStore, request, response, 'Unable to update inventory item properties.', async (store) => {
      response.json(store.updateInventoryItemProperties(itemRef(request), request.body?.properties))
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
      const ref = itemRef(request)
      const result = store.deleteInventoryItems([ref])
      if (['server', 'nas', 'pcBuild'].includes(ref.type)) await onHostsDeleted?.([ref])
      response.json(result)
    })
  })

  for (const [action, method] of [
    ['archive', 'archiveInventoryItems'],
    ['restore', 'restoreInventoryItems'],
    ['delete', 'deleteInventoryItems'],
  ]) {
    app.post(`/api/inventory/batch/${action}`, (request, response) => {
      runWithInventoryStore(withStore, request, response, `Unable to ${action} inventory items.`, async (store) => {
        const items = batchItems(request)
        const result = store[method](items)
        if (action === 'delete') {
          const hosts = (Array.isArray(items) ? items : []).filter((ref) => ['server', 'nas', 'pcBuild'].includes(ref?.type))
          if (hosts.length > 0) await onHostsDeleted?.(hosts)
        }
        response.json(result)
      })
    })
  }
}
