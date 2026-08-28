import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSystemsRoutes } from './routes.mjs'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fixture({ authorization = null, savedViews = null, attention = null } = {}) {
  const service = {
    initial: vi.fn(() => ({ projectId: 1, generatedAt: 'now', currentAgentVersion: '0.2.0', systems: [] })),
    live: vi.fn(() => ({ projectId: 1, generatedAt: 'now', systems: [{ itemId: 4, agentState: 'online' }] })),
  }
  const app = express()
  app.use(express.json())
  if (authorization) app.use((request, _response, next) => {
    request.authentication = { account: { id: 7 } }
    next()
  })
  registerSystemsRoutes(app, {
    service,
    savedViews,
    attention,
    authorization,
    withStore: async (_request, response, handler) => {
      try { await handler({}) } catch (error) { response.status(500).json({ message: error.message }) }
    },
  })
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
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

  it('exposes ETag-aware saved view lifecycle routes', async () => {
    const view = { id: 3, projectId: 1, name: 'Fleet', revision: 1, isDefault: false, configuration: {} }
    const savedViews = {
      list: vi.fn(() => [view]),
      create: vi.fn(() => view),
      replace: vi.fn(() => ({ ...view, revision: 2 })),
      delete: vi.fn(() => ({ deleted: true, id: 3 })),
      setDefault: vi.fn(() => ({ ...view, isDefault: true, revision: 2 })),
    }
    const { url } = await fixture({ savedViews })
    const list = await fetch(`${url}/api/projects/1/systems/views`)
    expect(list.status).toBe(200)
    expect((await list.json()).views).toEqual([view])
    expect((await fetch(`${url}/api/projects/1/systems/views`, {
      headers: { 'If-None-Match': list.headers.get('etag') },
    })).status).toBe(304)
    expect((await fetch(`${url}/api/projects/1/systems/views`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fleet' }),
    })).status).toBe(201)
    expect((await fetch(`${url}/api/projects/1/systems/views/3`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1 }),
    })).status).toBe(200)
    expect((await fetch(`${url}/api/projects/1/systems/views/3/default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1 }),
    })).status).toBe(200)
    expect((await fetch(`${url}/api/projects/1/systems/views/3`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1 }),
    })).status).toBe(200)
  })

  it('maps saved view conflicts without turning them into server errors', async () => {
    const conflict = Object.assign(new Error('This saved view changed in another session.'), {
      code: 'systems-view-conflict', status: 409,
    })
    const savedViews = {
      list: vi.fn(() => []),
      create: vi.fn(() => { throw conflict }),
      replace: vi.fn(), delete: vi.fn(), setDefault: vi.fn(),
    }
    const { url } = await fixture({ savedViews })
    const response = await fetch(`${url}/api/projects/1/systems/views`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'systems-view-conflict' })
  })

  it('returns ETag-aware materialized Attention details without evaluating them', async () => {
    const attention = { details: vi.fn(() => ({ summary: { totalCount: 1, revision: 2 }, findings: [{ key: 'audit:1' }] })) }
    const { url } = await fixture({ attention })
    const first = await fetch(`${url}/api/projects/1/systems/server/7/attention`)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ summary: { totalCount: 1 }, findings: [{ key: 'audit:1' }] })
    const second = await fetch(`${url}/api/projects/1/systems/server/7/attention`, {
      headers: { 'If-None-Match': first.headers.get('etag') },
    })
    expect(second.status).toBe(304)
    expect(attention.details).toHaveBeenCalledTimes(2)
  })

  it('limits Attention summaries and details to independently authorized domains', async () => {
    const authorization = {
      authorize: vi.fn(async (_accountId, permission) => ({
        allowed: permission === 'agents.view' || permission === 'audit.view',
      })),
    }
    const attention = { details: vi.fn(() => ({ summary: { totalCount: 1 }, findings: [] })) }
    const { service, url } = await fixture({ authorization, attention })
    expect((await fetch(`${url}/api/projects/1/systems`)).status).toBe(200)
    const initialOptions = service.initial.mock.calls[0][3]
    expect([...initialOptions.attentionCategories]).toEqual(['audit'])
    expect((await fetch(`${url}/api/projects/1/systems/server/7/attention`)).status).toBe(200)
    expect([...attention.details.mock.calls[0][4]]).toEqual(['audit'])
  })
})
