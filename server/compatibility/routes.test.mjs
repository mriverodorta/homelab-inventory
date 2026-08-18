import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerCompatibilityRoutes } from './routes.mjs'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fixture() {
  const service = {
    engineVersion: 'canonical-v2',
    reconcile: vi.fn(),
    summaries: vi.fn(() => [{ hostType: 'server', hostId: 7, actionable: 1, informational: 2 }]),
    findings: vi.fn(() => [{ id: 3, classification: 'informational' }]),
    setIgnored: vi.fn((_store, input) => ({ findingId: Number(input.findingId), ignored: input.ignored })),
  }
  const app = express()
  registerCompatibilityRoutes(app, {
    service,
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

describe('compatibility audit routes', () => {
  it('returns an ETag-aware compact summary', async () => {
    const { url } = await fixture()
    const first = await fetch(`${url}/api/projects/1/compatibility/summary`)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      projectId: 1,
      engineVersion: 'canonical-v2',
      hosts: [{ hostType: 'server', hostId: 7, actionable: 1, informational: 2 }],
    })
    expect((await fetch(`${url}/api/projects/1/compatibility/summary`, {
      headers: { 'If-None-Match': first.headers.get('etag') },
    })).status).toBe(304)
  })

  it('passes host and classification filters to the persisted projection', async () => {
    const { service, url } = await fixture()
    const response = await fetch(`${url}/api/projects/1/compatibility/findings?classification=informational&hostType=nas&hostId=4`)
    expect(response.status).toBe(200)
    expect(service.findings).toHaveBeenCalledWith({}, {
      projectId: '1', classification: 'informational', hostType: 'nas', hostId: '4', visibility: 'open',
    })
  })

  it('persists ignore decisions through dedicated mutation routes', async () => {
    const { service, url } = await fixture()
    expect((await fetch(`${url}/api/projects/1/compatibility/findings/3/ignore`, { method: 'PUT' })).status).toBe(200)
    expect((await fetch(`${url}/api/projects/1/compatibility/findings/3/ignore`, { method: 'DELETE' })).status).toBe(200)
    expect(service.setIgnored.mock.calls.map((call) => call[1].ignored)).toEqual([true, false])
  })
})
