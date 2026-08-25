import { createHash } from 'node:crypto'

function requestOrigin(request) {
  return new URL(`${request.protocol}://${request.get('host')}`).origin
}

function etag(payload) {
  return `"${createHash('sha256').update(JSON.stringify(payload)).digest('base64url')}"`
}

async function requireAgentView(request, response, authorization) {
  const accountId = request.authentication?.account?.id
  if (!accountId || !authorization) return true
  const decision = await authorization.authorize(accountId, 'agents.view')
  if (decision.allowed) return true
  response.status(403).json({
    message: 'You do not have permission to view agent status.',
    code: 'permission-denied',
    permission: 'agents.view',
  })
  return false
}

async function attentionCategories(request, authorization) {
  const id = request.authentication?.account?.id
  if (!id || !authorization) return null
  const permissions = [
    ['registry', 'registry.view'],
    ['audit', 'audit.view'],
    ['notification', 'notifications.view'],
  ]
  const decisions = await Promise.all(permissions.map(async ([category, permission]) => ({
    category,
    allowed: (await authorization.authorize(id, permission)).allowed,
  })))
  return new Set(decisions.filter((decision) => decision.allowed).map((decision) => decision.category))
}

function accountId(request) {
  return request.authentication?.account?.id ?? null
}

function requestedCanvas(request) {
  const value = request.query?.workspaceId
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError('Systems canvas ID must be a positive safe integer.')
  }
  return parsed
}

function handleSystemsViewError(response, error) {
  const status = Number(error?.status)
  if (Number.isSafeInteger(status) && status >= 400 && status < 600) {
    response.status(status).json({ message: error.message, code: error.code })
    return true
  }
  return false
}

function viewEtag(views) {
  return etag(views.map((view) => ({ id: view.id, revision: view.revision, isDefault: view.isDefault })))
}

export function registerSystemsRoutes(app, {
  withStore,
  service,
  savedViews = null,
  attention = null,
  authorization = null,
}) {
  app.get('/api/projects/:projectId/systems', (request, response) => {
    void withStore(request, response, async (store) => {
      if (!await requireAgentView(request, response, authorization)) return
      const categories = await attentionCategories(request, authorization)
      response
        .set('Cache-Control', 'no-store')
        .json(service.initial(store, request.params.projectId, requestOrigin(request), {
          attentionCategories: categories,
          workspaceId: requestedCanvas(request),
        }))
    }, { message: 'Unable to load systems.' })
  })

  app.get('/api/projects/:projectId/systems/live', (request, response) => {
    void withStore(request, response, async (store) => {
      if (!await requireAgentView(request, response, authorization)) return
      const categories = await attentionCategories(request, authorization)
      const payload = service.live(store, request.params.projectId, requestOrigin(request), {
        attentionCategories: categories,
        workspaceId: requestedCanvas(request),
      })
      const responseEtag = etag({ projectId: payload.projectId, systems: payload.systems })
      response.set('Cache-Control', 'no-store').set('ETag', responseEtag)
      if (request.get('if-none-match') === responseEtag) return response.status(304).end()
      return response.json(payload)
    }, { message: 'Unable to refresh systems.' })
  })

  if (attention) app.get('/api/projects/:projectId/systems/:hostType/:hostId/attention', (request, response) => {
    void withStore(request, response, async (store) => {
      if (!await requireAgentView(request, response, authorization)) return
      const categories = await attentionCategories(request, authorization)
      const payload = attention.details(
        store,
        request.params.projectId,
        request.params.hostType,
        request.params.hostId,
        categories,
        requestedCanvas(request) ?? store.workspaceId,
      )
      const responseEtag = etag(payload)
      response.set('Cache-Control', 'private, no-cache').set('ETag', responseEtag)
      if (request.get('if-none-match') === responseEtag) return response.status(304).end()
      return response.json(payload)
    }, { message: 'Unable to load system attention.' })
  })

  if (!savedViews) return

  app.get('/api/projects/:projectId/systems/views', (request, response) => {
    void withStore(request, response, async (store) => {
      const views = savedViews.list(store, { projectId: request.params.projectId, accountId: accountId(request) })
      const responseEtag = viewEtag(views)
      response.set('Cache-Control', 'private, no-cache').set('ETag', responseEtag)
      if (request.get('if-none-match') === responseEtag) return response.status(304).end()
      return response.json({ views })
    }, { message: 'Unable to load saved Systems views.' })
  })

  app.post('/api/projects/:projectId/systems/views', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const view = savedViews.create(store, { projectId: request.params.projectId, accountId: accountId(request), input: request.body })
        return response.status(201).json({ view })
      } catch (error) {
        if (!handleSystemsViewError(response, error)) throw error
      }
    }, { message: 'Unable to create the saved Systems view.' })
  })

  app.patch('/api/projects/:projectId/systems/views/:viewId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const view = savedViews.replace(store, {
          projectId: request.params.projectId,
          accountId: accountId(request),
          viewId: request.params.viewId,
          expectedRevision: request.body?.expectedRevision,
          input: request.body,
        })
        return response.json({ view })
      } catch (error) {
        if (!handleSystemsViewError(response, error)) throw error
      }
    }, { message: 'Unable to update the saved Systems view.' })
  })

  app.delete('/api/projects/:projectId/systems/views/:viewId', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        return response.json(savedViews.delete(store, {
          projectId: request.params.projectId,
          accountId: accountId(request),
          viewId: request.params.viewId,
          expectedRevision: request.body?.expectedRevision,
        }))
      } catch (error) {
        if (!handleSystemsViewError(response, error)) throw error
      }
    }, { message: 'Unable to delete the saved Systems view.' })
  })

  app.post('/api/projects/:projectId/systems/views/:viewId/default', (request, response) => {
    void withStore(request, response, async (store) => {
      try {
        const view = savedViews.setDefault(store, {
          projectId: request.params.projectId,
          accountId: accountId(request),
          viewId: request.params.viewId,
          expectedRevision: request.body?.expectedRevision,
        })
        return response.json({ view })
      } catch (error) {
        if (!handleSystemsViewError(response, error)) throw error
      }
    }, { message: 'Unable to set the default Systems view.' })
  })
}
