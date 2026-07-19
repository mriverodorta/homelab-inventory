import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'

function lifecycleErrorResponse(response, error) {
  if (!(error instanceof InventoryLifecycleError)) throw error

  response.status(error.status).json({
    message: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  })
}

export function registerProjectRoutes(app, { withStore }) {
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
