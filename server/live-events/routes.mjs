import { parseApplicationLiveTopics } from './topics.mjs'

function routeError(response, error) {
  response.status(400).json({ message: error instanceof Error ? error.message : 'Application live event topics are invalid.', code: 'invalid-event-topics' })
}

export function registerApplicationEventRoutes(app, { withStore, hub, authorization = null, demo = false }) {
  app.get('/api/events', (request, response) => {
    void withStore(request, response, async (store) => {
      let topics
      try { topics = parseApplicationLiveTopics(request.query.topics) } catch (error) { routeError(response, error); return }
      if (!demo && authorization && request.authentication?.account?.id) {
        const accountId = request.authentication.account.id
        for (const topic of topics) {
          const decision = await authorization.authorize(accountId, topic.permission)
          if (!decision.allowed) {
            response.status(403).json({ message: 'You do not have permission to subscribe to this live event topic.', code: 'permission-denied', permission: topic.permission })
            return
          }
        }
      }
      hub.connect({ scope: store, topics, request, response })
    }, { message: 'Unable to open the application event stream.' })
  })
}

