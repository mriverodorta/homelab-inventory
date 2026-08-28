import express from 'express'
import { describe, expect, it } from 'vitest'
import {
  AgentContractService,
  AGENT_LEGACY_SCHEMA_BUNDLE_DIGEST,
  AGENT_PRE_OPENRC_SCHEMA_BUNDLE_DIGEST,
  AGENT_SCHEMA_BUNDLE_DIGEST,
} from './contract-service.mjs'

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }))
  })
}

describe('agent contract service', () => {
  it('negotiates deterministic current and legacy contracts and honors conditional requests', async () => {
    const service = new AgentContractService()
    const app = express()
    app.get('/contract', (request, response) => service.respond(request, response))
    const { server, url } = await listen(app)
    try {
      const first = await fetch(`${url}/contract`, {
        headers: { 'X-Homelab-Agent-Schema-Digest': AGENT_SCHEMA_BUNDLE_DIGEST },
      })
      const payload = await first.json()
      expect(payload).toMatchObject({
        protocolMajor: 1,
        schemaBundleDigest: AGENT_SCHEMA_BUNDLE_DIGEST,
        collection: { hostIntervalSeconds: 60, serviceIntervalSeconds: 600 },
        privacy: {
          containersEnabled: true,
          smartEnabled: false,
          rawHardwareIdentifiersEnabled: false,
        },
      })
      expect(first.headers.get('etag')).toMatch(/^"sha256-/)
      const conditional = await fetch(`${url}/contract`, {
        headers: {
          'If-None-Match': first.headers.get('etag'),
          'X-Homelab-Agent-Schema-Digest': AGENT_SCHEMA_BUNDLE_DIGEST,
        },
      })
      expect(conditional.status).toBe(304)

      const legacy = await fetch(`${url}/contract`)
      expect(await legacy.json()).toMatchObject({
        protocolMajor: 1,
        schemaBundleDigest: AGENT_LEGACY_SCHEMA_BUNDLE_DIGEST,
      })
      expect(legacy.headers.get('etag')).not.toBe(first.headers.get('etag'))

      const preOpenRC = await fetch(`${url}/contract`, {
        headers: { 'X-Homelab-Agent-Schema-Digest': AGENT_PRE_OPENRC_SCHEMA_BUNDLE_DIGEST },
      })
      expect(await preOpenRC.json()).toMatchObject({
        protocolMajor: 1,
        schemaBundleDigest: AGENT_PRE_OPENRC_SCHEMA_BUNDLE_DIGEST,
      })

      const unsupported = await fetch(`${url}/contract`, {
        headers: { 'X-Homelab-Agent-Schema-Digest': '0'.repeat(64) },
      })
      expect(unsupported.status).toBe(409)
      expect(await unsupported.json()).toMatchObject({ code: 'agent-schema-bundle-unsupported' })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
