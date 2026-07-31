import { validateRoutingCache } from './routing-cache-model.mjs'

export function registerRoutingCacheRoutes(app, { withStore }) {
  app.get('/api/routing-cache', (request, response) => {
    void withStore(request, response, async (store) => {
      response.json(store.getRoutingCache())
    }, { message: 'Unable to load cable routing cache.' })
  })

  app.put('/api/routing-cache', (request, response) => {
    void withStore(request, response, async (store) => {
      const cache = validateRoutingCache(request.body)
      response.json(store.setRoutingCache(cache))
    }, { status: 400, message: 'Unable to save cable routing cache.' })
  })
}
