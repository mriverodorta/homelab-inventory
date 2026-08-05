import express from 'express'
import { describe, expect, it } from 'vitest'
import { AgentContractService, AGENT_SCHEMA_BUNDLE_DIGEST } from './contract-service.mjs'

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }))
  })
}

describe('agent contract service', () => {
  it('serves one deterministic safe contract and honors conditional requests', async () => {
    const service = new AgentContractService()
    const app = express()
    app.get('/contract', (request, response) => service.respond(request, response))
    const { server, url } = await listen(app)
    try {
      const first = await fetch(`${url}/contract`)
      const payload = await first.json()
      expect(payload).toMatchObject({
        protocolMajor: 1,
        schemaBundleDigest: AGENT_SCHEMA_BUNDLE_DIGEST,
        collection: { hostIntervalSeconds: 60, serviceIntervalSeconds: 600 },
        privacy: {
          containersEnabled: false,
          smartEnabled: false,
          rawHardwareIdentifiersEnabled: false,
        },
      })
      expect(first.headers.get('etag')).toMatch(/^"sha256-/)
      const conditional = await fetch(`${url}/contract`, {
        headers: { 'If-None-Match': first.headers.get('etag') },
      })
      expect(conditional.status).toBe(304)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
