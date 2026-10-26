import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuthenticationStore } from './model.mjs'
import { createAuthenticationGuard } from './middleware.mjs'
import { classifyApiRequest, createAuthorizationGuard } from './api-permissions.mjs'
import { browserMutationGuard } from '../request-security.mjs'

const servers = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.() })
  }
})

async function listen({ authenticated = false, allowed = false, enabled = true } = {}) {
  const state = createAuthenticationStore()
  state.configuration.enabled = enabled
  state.configuration.localEnabled = enabled
  const service = { state: () => state, sessions: { authenticateRequest: () => authenticated ? { account: { id: 1 } } : null } }
  // Keep Express defaults here: each guard must remain safe independently of routing hardening.
  const app = express()
  app.use(browserMutationGuard)
  app.use(createAuthenticationGuard({ service }))
  app.use(createAuthorizationGuard({ service, authorization: { authorize: async () => ({ allowed }) } }))
  const hits = []
  for (const [method, path] of [['get', '/api/backups'], ['get', '/api/engine/snapshot'], ['get', '/api/access/users'], ['post', '/api/projects'], ['delete', '/api/inventory/items/cpu/1'], ['post', '/api/backups/restore'], ['post', '/api/agent/hosts/pcBuild/1/heartbeats']]) {
    app[method](path, (req, res) => { hits.push(req.path); res.json({ ok: true }) })
  }
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await new Promise((resolve) => server.once('listening', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, hits }
}

describe('API boundary security', () => {
  it('blocks unauthenticated mixed-case reads and mutations before handlers', async () => {
    const { url, hits } = await listen()
    for (const prefix of ['api', 'API', 'Api', 'aPi', 'apI', 'APi', 'aPI', 'ApI']) {
      for (const [method, suffix] of [['GET', 'backups'], ['GET', 'engine/snapshot'], ['GET', 'access/users'], ['POST', 'projects'], ['DELETE', 'inventory/items/cpu/1'], ['POST', 'backups/restore']]) {
        const response = await fetch(`${url}/${prefix}/${suffix}`, { method })
        expect(response.status, `${method} /${prefix}/${suffix}`).toBe(401)
      }
    }
    expect(hits).toEqual([])
  })

  it('never classifies unexpected API case or the API root as non-API', () => {
    for (const path of ['/API/backups', '/aPi/health', '/api/Backups', '/api', '/API', '/API?x=1']) {
      expect(classifyApiRequest('GET', path)).toEqual({ access: 'denied' })
    }
    expect(classifyApiRequest('GET', '/apiary')).toEqual({ access: 'not-api' })
  })

  it('keeps authorization fail-closed even for authenticated users', async () => {
    const { url, hits } = await listen({ authenticated: true })
    for (const path of ['/api/backups', '/API/backups', '/api/Backups']) {
      expect((await fetch(`${url}${path}`)).status).toBe(403)
    }
    expect(hits).toEqual([])
  })

  it('enforces origin protection on case variants with authentication disabled', async () => {
    const { url, hits } = await listen({ enabled: false })
    for (const path of ['/API/projects', '/api/projects', '/Api/backups/restore']) {
      const response = await fetch(`${url}${path}`, { method: 'POST', headers: { origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' } })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ message: 'Cross-origin browser mutations are not allowed.' })
    }
    expect(hits).toEqual([])
  })

  it('retains permitted canonical routes and case-sensitive pcBuild machine routes', async () => {
    const { url } = await listen({ authenticated: true, allowed: true })
    expect((await fetch(`${url}/api/backups`)).status).toBe(200)
    const machine = await listen()
    expect((await fetch(`${machine.url}/api/agent/hosts/pcBuild/1/heartbeats`, { method: 'POST' })).status).toBe(200)
    expect((await fetch(`${machine.url}/API/agent/hosts/pcBuild/1/heartbeats`, { method: 'POST' })).status).toBe(401)
  })
})
