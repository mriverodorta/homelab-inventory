import { describe, expect, it } from 'vitest'
import { LabGdPublicationClient } from './labgd-client.mjs'
import { createTestFetchGuard } from './test-network-guard.mjs'

function fakeLabGd() {
  const hash = 'a'.repeat(64)
  const operation = { id: 132, state: 'staged', failureCode: null, uploaded: new Set(), result: null }
  let registryAvailable = false
  let logicalRevision = 0
  let event = null
  const transport = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    const body = init.body?.byteLength ? JSON.parse(new TextDecoder().decode(init.body)) : {}
    if (url.pathname === '/v1/publications/manifest') {
      return Response.json({
        operation: { id: operation.id, state: operation.state, ...(operation.failureCode ? { failureCode: operation.failureCode } : {}), ...(operation.result ? { result: operation.result } : {}) },
        missingHashes: operation.state === 'active' || operation.uploaded.has(hash) ? [] : [hash],
      }, { status: 202 })
    }
    if (url.pathname.endsWith(`/blobs/${hash}`) && init.method === 'PUT') {
      operation.uploaded.add(hash)
      operation.state = 'ready'
      return new Response(null, { status: 204 })
    }
    if (url.pathname.endsWith('/activate')) {
      if (!registryAvailable) {
        operation.state = 'failed'
        operation.failureCode = 'registry-definition-unavailable'
        return Response.json({ error: 'publication-failed' }, { status: 409 })
      }
      expect(body.expectedShareRevision).toBe(0)
      operation.state = 'active'
      operation.failureCode = null
      operation.result = { operationId: operation.id, revisionId: 733 }
      logicalRevision = 1
      event = `id: 1\nevent: publication\ndata: {"eventVersion":1,"sharePublicId":"share_contract_1","revision":1,"state":"active","occurredAt":"2026-08-29T12:00:00.000Z"}\n\n`
      return Response.json(operation.result)
    }
    if (url.pathname === '/v1/installations/events') return new Response(event ?? ': heartbeat\n\n', { headers: { 'content-type': 'text/event-stream' } })
    if (url.pathname === '/v1/installation-shares/share_contract_1/unpublish') {
      expect(body.expectedRevision).toBe(logicalRevision)
      logicalRevision += 1
      return Response.json({ publicId: 'share_contract_1', revision: logicalRevision, state: 'unpublished' })
    }
    throw new Error(`Unexpected fake LabGD path ${url.pathname}`)
  }
  return {
    hash,
    setRegistryAvailable(value) { registryAvailable = value },
    signedFetch: (pathname, options) => createTestFetchGuard(transport)(new URL(pathname, 'http://127.0.0.1:8787'), options),
  }
}

describe('frozen LabGD publication lifecycle harness', () => {
  it('recovers one Registry-blocked operation and continues lifecycle at the exact logical revision', async () => {
    const remote = fakeLabGd()
    const client = new LabGdPublicationClient({ identityService: { signedFetch: remote.signedFetch } })
    const request = { idempotencyKey: 'stable-contract-operation', sharePublicId: 'share_contract_1', manifest: { shareContractVersion: 1 }, availableHashes: [] }
    const staged = await client.stage(request)
    expect(staged).toMatchObject({ operationId: 132, state: 'staged', missingHashes: [remote.hash] })
    await client.upload(132, { contentHash: remote.hash, contentJson: '{}', mediaType: 'application/json' })
    await expect(client.activate(132, 0)).rejects.toMatchObject({ code: 'publication-failed', status: 409 })
    await expect(client.stage(request)).resolves.toMatchObject({ operationId: 132, state: 'failed', failureCode: 'registry-definition-unavailable', missingHashes: [] })

    remote.setRegistryAvailable(true)
    await expect(client.activate(132, 0)).resolves.toEqual({ operationId: 132, revisionId: 733 })
    await expect(client.stage(request)).resolves.toMatchObject({ operationId: 132, state: 'active', activationResult: { operationId: 132, revisionId: 733 } })
    await expect((await client.events(0)).text()).resolves.toContain('"revision":1')
    await expect(client.unpublish('share_contract_1', 1, 'unpublish:share_contract_1:1')).resolves.toMatchObject({ revision: 2, state: 'unpublished' })
  })
})
