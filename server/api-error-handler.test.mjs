import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiErrorHandler } from './api-error-handler.mjs'

const servers = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections?.()
  })))
})

async function listen() {
  const app = express()
  app.use(express.json({ limit: '32b' }))
  app.post('/api/test', (_request, response) => response.json({ ok: true }))
  app.get('/api/fail', () => { throw new Error('EACCES: /data/private/store.json') })
  app.use(apiErrorHandler)
  const server = app.listen(0)
  servers.push(server)
  await new Promise((resolve) => server.once('listening', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

describe('apiErrorHandler', () => {
  it('returns JSON for malformed and oversized request bodies', async () => {
    const url = await listen()
    const malformed = await fetch(`${url}/api/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    })
    const oversized = await fetch(`${url}/api/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(64) }),
    })

    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ code: 'invalid-json' })
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toMatchObject({ code: 'request-body-too-large' })
  })

  it('does not expose unexpected server details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const url = await listen()
    const response = await fetch(`${url}/api/fail`)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ message: 'The request could not be completed.', code: 'request-failed' })
    expect(JSON.stringify(body)).not.toContain('/data/private')
  })
})
