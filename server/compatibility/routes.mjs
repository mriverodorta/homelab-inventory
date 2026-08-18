import { createHash } from 'node:crypto'

function etag(payload) {
  return `"${createHash('sha256').update(JSON.stringify(payload)).digest('base64url')}"`
}

function sendCached(request, response, payload) {
  const responseEtag = etag(payload)
  response.set('Cache-Control', 'private, no-cache').set('ETag', responseEtag)
  if (request.get('if-none-match') === responseEtag) return response.status(304).end()
  return response.json(payload)
}

export function registerCompatibilityRoutes(app, { withStore, service }) {
  app.get('/api/projects/:projectId/compatibility/summary', (request, response) => {
    void withStore(request, response, async (store) => {
      service.reconcile(store)
      return sendCached(request, response, {
        projectId: Number(request.params.projectId),
        engineVersion: service.engineVersion,
        hosts: service.summaries(store, request.params.projectId),
      })
    }, { message: 'Unable to load compatibility summary.' })
  })

  app.get('/api/projects/:projectId/compatibility/findings', (request, response) => {
    void withStore(request, response, async (store) => {
      service.reconcile(store)
      return sendCached(request, response, {
        projectId: Number(request.params.projectId),
        engineVersion: service.engineVersion,
        findings: service.findings(store, {
          projectId: request.params.projectId,
          classification: request.query.classification || null,
          hostType: request.query.hostType || null,
          hostId: request.query.hostId || null,
          visibility: request.query.visibility || 'open',
        }),
      })
    }, { message: 'Unable to load compatibility findings.' })
  })

  app.put('/api/projects/:projectId/compatibility/findings/:findingId/ignore', (request, response) => {
    void withStore(request, response, async (store) => {
      const result = service.setIgnored(store, {
        projectId: request.params.projectId,
        findingId: request.params.findingId,
        ignored: true,
        accountId: request.authentication?.account?.id ?? null,
      })
      return response.json(result)
    }, { message: 'Unable to ignore compatibility finding.' })
  })

  app.delete('/api/projects/:projectId/compatibility/findings/:findingId/ignore', (request, response) => {
    void withStore(request, response, async (store) => {
      const result = service.setIgnored(store, {
        projectId: request.params.projectId,
        findingId: request.params.findingId,
        ignored: false,
        accountId: request.authentication?.account?.id ?? null,
      })
      return response.json(result)
    }, { message: 'Unable to unignore compatibility finding.' })
  })
}
