import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'

function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InventoryLifecycleError(`${label} must be a positive safe integer.`, {
      code: 'invalid-workspace-id',
      status: 400,
    })
  }
  return parsed
}

function respond(response, error) {
  const message = error instanceof Error ? error.message : 'Workspace request failed.'
  const status = error instanceof InventoryLifecycleError
    ? error.status
    : /was not found/iu.test(message)
      ? 404
      : /Systems|at least one Canvas|duplicate IDs|exactly once/iu.test(message)
        ? 409
        : 400
  response.status(status).json({
    message,
    code: error instanceof InventoryLifecycleError
      ? error.code
      : status === 404
        ? 'workspace-not-found'
        : status === 409
          ? 'workspace-conflict'
          : 'invalid-workspace',
  })
}

function ids(request) {
  return {
    projectId: positiveId(request.params.projectId, 'Project ID'),
    workspaceId: positiveId(request.params.workspaceId, 'Workspace ID'),
  }
}

export function registerWorkspaceRoutes(app, { withStore }) {
  app.post('/api/projects/:projectId/workspaces', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.status(201).json(store.createWorkspace(
          positiveId(request.params.projectId, 'Project ID'),
          request.body ?? {},
        ))
      } catch (error) {
        respond(response, error)
      }
    }, { status: 400, message: 'Unable to create workspace.' })
  })

  app.put('/api/projects/:projectId/workspaces/reorder', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.json(store.reorderWorkspaces(
          positiveId(request.params.projectId, 'Project ID'),
          request.body?.workspaceIds ?? [],
        ))
      } catch (error) {
        respond(response, error)
      }
    }, { status: 400, message: 'Unable to reorder workspaces.' })
  })

  app.put('/api/projects/:projectId/default-workspace', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.json(store.setDefaultWorkspace(
          positiveId(request.params.projectId, 'Project ID'),
          positiveId(request.body?.workspaceId, 'Workspace ID'),
        ))
      } catch (error) {
        respond(response, error)
      }
    }, { status: 400, message: 'Unable to set the default workspace.' })
  })

  app.patch('/api/projects/:projectId/workspaces/:workspaceId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const { projectId, workspaceId } = ids(request)
        response.json(store.updateWorkspaceMetadata(projectId, workspaceId, request.body ?? {}))
      } catch (error) {
        respond(response, error)
      }
    }, { status: 400, message: 'Unable to update workspace.' })
  })

  app.patch('/api/projects/:projectId/workspaces/:workspaceId/configuration', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const { projectId, workspaceId } = ids(request)
        response.json(store.updateCanvasWorkspaceConfiguration(projectId, workspaceId, request.body ?? {}))
      } catch (error) {
        respond(response, error)
      }
    }, { status: 400, message: 'Unable to update Canvas configuration.' })
  })

  app.delete('/api/projects/:projectId/workspaces/:workspaceId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const { projectId, workspaceId } = ids(request)
        response.json(store.archiveWorkspace(projectId, workspaceId))
      } catch (error) {
        respond(response, error)
      }
    }, { status: 400, message: 'Unable to archive workspace.' })
  })

  app.get('/api/projects/:projectId/workspaces/:workspaceId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const { projectId, workspaceId } = ids(request)
        response.json(store.getWorkspace(projectId, workspaceId))
      } catch (error) {
        respond(response, error)
      }
    }, { message: 'Unable to load workspace.' })
  })

  app.put('/api/projects/:projectId/workspaces/:workspaceId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const { projectId, workspaceId } = ids(request)
        response.json(store.setWorkspace(projectId, workspaceId, request.body))
      } catch (error) {
        respond(response, error)
      }
    }, { status: 400, message: 'Unable to save workspace.' })
  })
}
