import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { browserMutationGuard } from './request-security.mjs'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections?.()
  })))
})

async function listen() {
  const app = express()
  app.use(browserMutationGuard)
  app.post('/api/project', (_request, response) => response.json({ ok: true }))
  app.post('/api/agent/servers/1/register', (_request, response) => response.json({ ok: true }))
  const server = app.listen(0)
  servers.push(server)
  await new Promise((resolve) => server.once('listening', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

describe('browserMutationGuard', () => {
  it('allows same-origin browser requests and headerless CLI requests', async () => {
    const url = await listen()
    const browser = await fetch(`${url}/api/project`, {
      method: 'POST',
      headers: { Origin: url, 'Sec-Fetch-Site': 'same-origin' },
    })
    const cli = await fetch(`${url}/api/project`, { method: 'POST' })

    expect(browser.status).toBe(200)
    expect(cli.status).toBe(200)
  })

  it('rejects cross-origin and opaque browser mutations', async () => {
    const url = await listen()
    const crossOrigin = await fetch(`${url}/api/project`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
    })
    const opaque = await fetch(`${url}/api/project`, {
      method: 'POST',
      headers: { Origin: 'null' },
    })

    expect(crossOrigin.status).toBe(403)
    expect(opaque.status).toBe(403)
  })

  it('leaves bearer-token agent registration available cross-origin', async () => {
    const url = await listen()
    const response = await fetch(`${url}/api/agent/servers/1/register`, {
      method: 'POST',
      headers: { Origin: 'https://agent.example', 'Sec-Fetch-Site': 'cross-site' },
    })

    expect(response.status).toBe(200)
  })
})
