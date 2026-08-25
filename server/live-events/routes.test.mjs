import { describe, expect, it, vi } from 'vitest'
import { registerApplicationEventRoutes } from './routes.mjs'

function setup({ allowed = true, workspace = { id: 2 } } = {}) {
  let handler
  const app = { get: (_path, candidate) => { handler = candidate } }
  const workspaceQuery = { get: vi.fn(() => workspace) }
  const store = { core: { database: { query: vi.fn(() => workspaceQuery) } } }
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
  return { handler, hub, authorization, response, store, workspaceQuery }
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

  it('authorizes a canvas-scoped systems subscription only for its owning project', async () => {
    const fixture = setup()
    await fixture.handler({
      query: { topics: 'systems:1:workspace:2' },
      authentication: { account: { id: 4 } },
    }, fixture.response)

    await vi.waitFor(() => expect(fixture.hub.connect).toHaveBeenCalled())
    expect(fixture.workspaceQuery.get).toHaveBeenCalledWith(2, 1)
    expect(fixture.authorization.authorize).toHaveBeenCalledWith(4, 'project.view')
    expect(fixture.authorization.authorize).toHaveBeenCalledWith(4, 'agents.view')

    const unavailable = setup({ workspace: null })
    await unavailable.handler({
      query: { topics: 'systems:1:workspace:9' },
      authentication: { account: { id: 4 } },
    }, unavailable.response)

    await vi.waitFor(() => expect(unavailable.response.status).toHaveBeenCalledWith(404))
    expect(unavailable.workspaceQuery.get).toHaveBeenCalledWith(9, 1)
    expect(unavailable.hub.connect).not.toHaveBeenCalled()
  })
})
