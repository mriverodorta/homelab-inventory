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

export function registerSystemsRoutes(app, {
  withStore,
  service,
  authorization = null,
}) {
  app.get('/api/projects/:projectId/systems', (request, response) => {
    void withStore(request, response, async (store) => {
      if (!await requireAgentView(request, response, authorization)) return
      response
        .set('Cache-Control', 'no-store')
        .json(service.initial(store, request.params.projectId, requestOrigin(request)))
    }, { message: 'Unable to load systems.' })
  })

  app.get('/api/projects/:projectId/systems/live', (request, response) => {
    void withStore(request, response, async (store) => {
      if (!await requireAgentView(request, response, authorization)) return
      const payload = service.live(store, request.params.projectId, requestOrigin(request))
      const responseEtag = etag({ projectId: payload.projectId, systems: payload.systems })
      response.set('Cache-Control', 'no-store').set('ETag', responseEtag)
      if (request.get('if-none-match') === responseEtag) return response.status(304).end()
      return response.json(payload)
    }, { message: 'Unable to refresh systems.' })
  })
}
