import { describe, expect, it, vi } from 'vitest'
import { registerApplicationEventRoutes } from './routes.mjs'

function setup({ allowed = true } = {}) {
  let handler
  const app = { get: (_path, candidate) => { handler = candidate } }
  const store = {}
  const hub = { connect: vi.fn() }
  const authorization = { authorize: vi.fn(async () => ({ allowed })) }
  registerApplicationEventRoutes(app, {
    withStore: async (_request, _response, callback) => callback(store, null),
    hub,
    authorization,
  })
  const response = {
    status: vi.fn(function status() { return this }),
    json: vi.fn(function json() { return this }),
  }
  return { handler, hub, authorization, response, store }
}

describe('registerApplicationEventRoutes', () => {
  it('authorizes every normalized topic before connecting', async () => {
    const fixture = setup()
    await fixture.handler({ query: { topics: 'systems:1,agents:fleet' }, authentication: { account: { id: 4 } } }, fixture.response)
    await vi.waitFor(() => expect(fixture.hub.connect).toHaveBeenCalled())
    expect(fixture.authorization.authorize).toHaveBeenCalledWith(4, 'agents.view')
    expect(fixture.authorization.authorize).toHaveBeenCalledWith(4, 'project.view')
    expect(fixture.hub.connect).toHaveBeenCalledWith(expect.objectContaining({ scope: fixture.store }))
  })

  it('rejects malformed and unauthorized subscriptions', async () => {
    const malformed = setup()
    await malformed.handler({ query: { topics: 'unknown' }, authentication: { account: { id: 4 } } }, malformed.response)
    await vi.waitFor(() => expect(malformed.response.status).toHaveBeenCalledWith(400))
    expect(malformed.response.status).toHaveBeenCalledWith(400)
    expect(malformed.hub.connect).not.toHaveBeenCalled()

    const denied = setup({ allowed: false })
    await denied.handler({ query: { topics: 'agents:fleet' }, authentication: { account: { id: 4 } } }, denied.response)
    await vi.waitFor(() => expect(denied.response.status).toHaveBeenCalledWith(403))
    expect(denied.response.status).toHaveBeenCalledWith(403)
    expect(denied.hub.connect).not.toHaveBeenCalled()
  })
})
