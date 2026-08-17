import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSystemsRoutes } from './routes.mjs'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fixture({ authorization = null } = {}) {
  const service = {
    initial: vi.fn(() => ({ projectId: 1, generatedAt: 'now', currentAgentVersion: '0.2.0', systems: [] })),
    live: vi.fn(() => ({ projectId: 1, generatedAt: 'now', systems: [{ itemId: 4, agentState: 'online' }] })),
  }
  const app = express()
  if (authorization) app.use((request, _response, next) => {
    request.authentication = { account: { id: 7 } }
    next()
  })
  registerSystemsRoutes(app, {
    service,
    authorization,
    withStore: async (_request, response, handler) => {
      try { await handler({}) } catch (error) { response.status(500).json({ message: error.message }) }
    },
  })
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })
  servers.push(server)
  return { service, url: `http://127.0.0.1:${server.address().port}` }
}

describe('Systems routes', () => {
  it('returns compact initial and ETag-aware live responses', async () => {
    const { url } = await fixture()
    expect((await fetch(`${url}/api/projects/1/systems`)).status).toBe(200)
    const first = await fetch(`${url}/api/projects/1/systems/live`)
    expect(first.status).toBe(200)
    const responseEtag = first.headers.get('etag')
    expect(responseEtag).toBeTruthy()
    expect((await fetch(`${url}/api/projects/1/systems/live`, {
      headers: { 'If-None-Match': responseEtag },
    })).status).toBe(304)
  })

  it('requires agent view in addition to project view', async () => {
    const authorization = { authorize: vi.fn().mockResolvedValue({ allowed: false }) }
    const { url } = await fixture({ authorization })
    const response = await fetch(`${url}/api/projects/1/systems`)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ permission: 'agents.view' })
  })
})
