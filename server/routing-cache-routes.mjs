import { validateRoutingCache } from './routing-cache-model.mjs'
import { isRelationalId } from './db/relational-ids.mjs'

class RoutingCacheScopeError extends Error {
  constructor(message, code, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

function routingCacheStoreScope(store, request) {
  const rawProjectId = request.query?.projectId
  const rawWorkspaceId = request.query?.workspaceId
  if (rawProjectId === undefined || rawWorkspaceId === undefined) {
    throw new RoutingCacheScopeError(
      'Routing cache project and workspace scope must be provided together.',
      'invalid-routing-cache-scope',
      400,
    )
  }
  const projectId = Number(rawProjectId)
  const workspaceId = Number(rawWorkspaceId)
  if (!isRelationalId(projectId) || !isRelationalId(workspaceId)) {
    throw new RoutingCacheScopeError(
      'Routing cache project and workspace IDs must be positive safe integers.',
      'invalid-routing-cache-scope',
      400,
    )
  }
  let workbook
  try {
    workbook = store.getProjectWorkbook(projectId)
  } catch {
    throw new RoutingCacheScopeError('Routing cache project was not found.', 'routing-cache-scope-not-found', 404)
  }
  const workspace = workbook.workspaces.find((candidate) => candidate.id === workspaceId)
  if (!workspace) {
    throw new RoutingCacheScopeError('Routing cache workspace was not found.', 'routing-cache-scope-not-found', 404)
  }
  if (workspace.type !== 'canvas') {
    throw new RoutingCacheScopeError(
      'Routing cache is available only for Canvas workspaces.',
      'invalid-routing-cache-workspace',
      400,
    )
  }
  return store.forWorkspace(projectId, workspaceId)
}

function runWithRoutingCacheStore(withStore, request, response, handler) {
  void withStore(request, response, async (store) => {
    try {
      await handler(routingCacheStoreScope(store, request))
    } catch (error) {
      if (!(error instanceof RoutingCacheScopeError)) throw error
      response.status(error.status).json({ message: error.message, code: error.code })
    }
  }, {
    status: request.method === 'PUT' ? 400 : 500,
    message: 'Unable to access cable routing cache.',
  })
}

export function registerRoutingCacheRoutes(app, { withStore }) {
  app.get('/api/routing-cache', (request, response) => {
    runWithRoutingCacheStore(withStore, request, response, async (store) => {
      response.json(store.getRoutingCache())
    })
  })

  app.put('/api/routing-cache', (request, response) => {
    runWithRoutingCacheStore(withStore, request, response, async (store) => {
      const cache = validateRoutingCache(request.body)
      response.json(store.setRoutingCache(cache))
    })
  })
}
