import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'

function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InventoryLifecycleError(`${label} must be a positive safe integer.`, {
      code: 'invalid-project-id',
      status: 400,
    })
  }
  return parsed
}

function projectError(error) {
  if (error instanceof InventoryLifecycleError) return error
  const message = error instanceof Error ? error.message : 'Project request failed.'
  const conflict = /unique constraint|already exists|cannot be archived|cannot be deleted|at least one canvas|remain linked|cross-project dependency/iu.test(message)
  const missing = /was not found/iu.test(message)
  return new InventoryLifecycleError(message, {
    code: missing ? 'project-not-found' : conflict ? 'project-conflict' : 'invalid-project',
    status: missing ? 404 : conflict ? 409 : 400,
  })
}

function lifecycleErrorResponse(response, error) {
  if (!(error instanceof InventoryLifecycleError)) throw error

  response.status(error.status).json({
    message: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  })
}

export function registerProjectRoutes(app, { withStore }) {
  app.get('/api/projects', (request, response) => {
    void withStore(request, response, async (store) => {
      response.json({ projects: store.listProjects() })
    }, { message: 'Unable to load projects.' })
  })

  app.get('/api/projects/archived', (request, response) => {
    void withStore(request, response, async (store) => {
      response.json({ projects: store.listArchivedProjects() })
    }, { message: 'Unable to load archived projects.' })
  })

  app.post('/api/projects', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.status(201).json(store.createProject(request.body ?? {}))
      } catch (error) {
        lifecycleErrorResponse(response, projectError(error))
      }
    }, { status: 400, message: 'Unable to create project.' })
  })

  app.get('/api/projects/:projectId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.json(store.getProjectWorkbook(positiveId(request.params.projectId, 'Project ID')))
      } catch (error) {
        lifecycleErrorResponse(response, projectError(error))
      }
    }, { message: 'Unable to load project.' })
  })

  app.patch('/api/projects/:projectId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.json(store.updateProject(
          positiveId(request.params.projectId, 'Project ID'),
          request.body ?? {},
        ))
      } catch (error) {
        lifecycleErrorResponse(response, projectError(error))
      }
    }, { status: 400, message: 'Unable to update project.' })
  })

  app.delete('/api/projects/:projectId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const projectId = positiveId(request.params.projectId, 'Project ID')
        store.archiveProject(projectId)
        response.json({ ok: true, projectId })
      } catch (error) {
        lifecycleErrorResponse(response, projectError(error))
      }
    }, { status: 400, message: 'Unable to archive project.' })
  })

  app.post('/api/projects/:projectId/restore', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.json(store.restoreProject(positiveId(request.params.projectId, 'Project ID')))
      } catch (error) {
        lifecycleErrorResponse(response, projectError(error))
      }
    }, { status: 400, message: 'Unable to restore project.' })
  })

  app.get('/api/projects/:projectId/deletion-impact', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.json(store.getProjectDeletionImpact(positiveId(request.params.projectId, 'Project ID')))
      } catch (error) {
        lifecycleErrorResponse(response, projectError(error))
      }
    }, { message: 'Unable to inspect project deletion.' })
  })

  app.delete('/api/projects/:projectId/permanent', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const projectId = positiveId(request.params.projectId, 'Project ID')
        response.json({ ok: true, impact: store.deleteArchivedProject(projectId) })
      } catch (error) {
        lifecycleErrorResponse(response, projectError(error))
      }
    }, { status: 400, message: 'Unable to permanently delete project.' })
  })

  app.get('/api/projects/:projectId/workbook', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.json(store.getProjectWorkbook(positiveId(request.params.projectId, 'Project ID')))
      } catch (error) {
        lifecycleErrorResponse(response, projectError(error))
      }
    }, { message: 'Unable to load project workbook.' })
  })

  app.get('/api/project', (request, response) => {
    void withStore(request, response, async (store) => {
      response.json(store.getProject())
    }, { message: 'Unable to load project.' })
  })

  app.put('/api/project', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        response.json(store.setProject(request.body))
      } catch (error) {
        lifecycleErrorResponse(response, error)
      }
    }, { status: 400, message: 'Unable to save project.' })
  })
}
