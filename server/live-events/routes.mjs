import { parseApplicationLiveTopics } from './topics.mjs'

function routeError(response, error) {
  response.status(400).json({ message: error instanceof Error ? error.message : 'Application live event topics are invalid.', code: 'invalid-event-topics' })
}

export function registerApplicationEventRoutes(app, { withStore, hub, authorization = null, demo = false }) {
  app.get('/api/events', (request, response) => {
    void withStore(request, response, async (store) => {
      let topics
      try { topics = parseApplicationLiveTopics(request.query.topics) } catch (error) { routeError(response, error); return }
      for (const topic of topics) {
        if (topic.workspaceId == null) continue
        const workspace = store.core.database.query(`
          SELECT id FROM workspaces
          WHERE id = ? AND project_id = ? AND type = 'canvas' AND archived_at_ms IS NULL
        `).get(topic.workspaceId, topic.projectId)
        if (!workspace) {
          response.status(404).json({ message: 'The requested canvas is unavailable.', code: 'workspace-not-found' })
          return
        }
      }
      if (!demo && authorization && request.authentication?.account?.id) {
        const accountId = request.authentication.account.id
        for (const topic of topics) {
          for (const permission of topic.permissions ?? [topic.permission]) {
            const decision = await authorization.authorize(accountId, permission)
            if (!decision.allowed) {
              response.status(403).json({ message: 'You do not have permission to subscribe to this live event topic.', code: 'permission-denied', permission })
              return
            }
          }
        }
      }
      hub.connect({ scope: store, topics, request, response })
    }, { message: 'Unable to open the application event stream.' })
  })
}
