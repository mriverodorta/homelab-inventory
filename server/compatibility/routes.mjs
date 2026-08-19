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

export function registerCompatibilityRoutes(app, { withStore, service, eventBus = null }) {
  app.get('/api/projects/:projectId/compatibility/policy', (request, response) => {
    void withStore(request, response, async (store) => {
      response.json(store.getProjectCompatibilityPolicy(Number(request.params.projectId)))
    }, { message: 'Unable to load compatibility policy.' })
  })

  app.put('/api/projects/:projectId/compatibility/policy', (request, response) => {
    void withStore(request, response, async (store) => {
      const projectId = Number(request.params.projectId)
      const result = store.updateProjectCompatibilityPolicy(projectId, request.body ?? {})
      service.markProjectDirty(store, projectId, 'compatibility-policy-changed')
      service.schedule(store)
      eventBus?.publish({
        scope: store,
        topics: [`compatibility:${projectId}`, `systems:${projectId}`],
        kind: 'compatibility.policy-changed',
        payload: { projectId, revision: result.revision },
      })
      response.json(result)
    }, { message: 'Unable to update compatibility policy.' })
  })

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
