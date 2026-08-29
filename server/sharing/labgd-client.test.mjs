import { describe, expect, it, vi } from 'vitest'
import { LabGdPublicationClient } from './labgd-client.mjs'

describe('lab.gd installation control client', () => {
  it('retains sanitized staged, failed, and active publication replay metadata', async () => {
    const responses = [
      { operation: { id: 132, state: 'ready' }, missingHashes: ['a'.repeat(64)] },
      { operation: { id: 132, state: 'failed', failureCode: 'registry-definition-unavailable' }, missingHashes: [] },
      { operation: { id: 132, state: 'active', result: { operationId: 132, revisionId: 733 } }, missingHashes: [] },
    ]
    const signedFetch = vi.fn(async () => Response.json(responses.shift()))
    const client = new LabGdPublicationClient({ identityService: { signedFetch } })

    await expect(client.stage({ idempotencyKey: 'stable', sharePublicId: 'share_1', manifest: {}, availableHashes: [] })).resolves.toEqual({
      operationId: 132,
      state: 'ready',
      failureCode: null,
      missingHashes: ['a'.repeat(64)],
      activationResult: null,
    })
    await expect(client.stage({ idempotencyKey: 'stable', sharePublicId: 'share_1', manifest: {}, availableHashes: [] })).resolves.toMatchObject({
      operationId: 132,
      state: 'failed',
      failureCode: 'registry-definition-unavailable',
    })
    await expect(client.stage({ idempotencyKey: 'stable', sharePublicId: 'share_1', manifest: {}, availableHashes: [] })).resolves.toMatchObject({
      operationId: 132,
      state: 'active',
      activationResult: { operationId: 132, revisionId: 733 },
    })
  })

  it('rejects malformed publication replay metadata', async () => {
    const invalid = [
      { operation: { id: 1, state: 'unknown' }, missingHashes: [] },
      { operation: { id: 1, state: 'ready' }, missingHashes: ['A'.repeat(64)] },
      { operation: { id: 1, state: 'ready' }, missingHashes: ['a'.repeat(64), 'a'.repeat(64)] },
      { operation: { id: 1, state: 'failed', failureCode: 'Unsafe Code' }, missingHashes: [] },
      { operation: { id: 1, state: 'active', result: { operationId: 2, revisionId: 3 } }, missingHashes: [] },
    ]
    const signedFetch = vi.fn(async () => Response.json(invalid.shift()))
    const client = new LabGdPublicationClient({ identityService: { signedFetch } })
    for (let index = 0; index < 5; index += 1) {
      await expect(client.stage({ idempotencyKey: 'stable', sharePublicId: 'share_1', manifest: {}, availableHashes: [] })).rejects.toMatchObject({ code: 'sharing-publication-stage-failed' })
    }
  })

  it('retains safe HTTP retry metadata without retaining remote response bodies', async () => {
    const signedFetch = vi.fn(async () => Response.json({ code: 'publication-readiness-unavailable', message: 'not ready' }, { status: 503, headers: { 'retry-after': '90' } }))
    const client = new LabGdPublicationClient({ identityService: { signedFetch } })
    await expect(client.stage({ idempotencyKey: 'stable', sharePublicId: 'share_1', manifest: {}, availableHashes: [] })).rejects.toMatchObject({
      code: 'publication-readiness-unavailable',
      status: 503,
      retryAfterMs: 90_000,
    })
  })

  it('opens signed resumable events with the persisted cursor', async () => {
    const signedFetch = vi.fn(async () => new Response(': heartbeat\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    const client = new LabGdPublicationClient({ identityService: { signedFetch } })
    await client.events(42)
    expect(signedFetch).toHaveBeenCalledWith('/v1/installations/events', expect.objectContaining({ method: 'GET', scope: 'events:read', timeoutMs: 0, headers: { 'last-event-id': '42' } }))
  })

  it('forwards the event-stream cancellation signal to the signed request', async () => {
    const signedFetch = vi.fn(async () => new Response(': heartbeat\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    const client = new LabGdPublicationClient({ identityService: { signedFetch } })
    const controller = new AbortController()
    await client.events(0, { signal: controller.signal })
    expect(signedFetch).toHaveBeenCalledWith('/v1/installations/events', expect.objectContaining({ signal: controller.signal }))
  })

  it('keeps a protected password in the signed request only and returns a sanitized result', async () => {
    let requestBody = null
    const signedFetch = vi.fn(async (_path, options) => {
      requestBody = JSON.parse(new TextDecoder().decode(options.body))
      return Response.json({ publicId: 'share_1', revision: 4, passwordConfigured: true, viewerGrantsRevoked: true })
    })
    const client = new LabGdPublicationClient({ identityService: { signedFetch } })
    const password = 'request-only-password'
    const result = await client.replacePassword('share_1', 3, 'password:share_1:3', password)
    expect(requestBody).toEqual({ expectedRevision: 3, idempotencyKey: 'password:share_1:3', password })
    expect(JSON.stringify(result)).not.toContain(password)
    expect(Object.keys(client)).not.toContain('password')
    expect(signedFetch).toHaveBeenCalledWith('/v1/installation-shares/share_1/password', expect.objectContaining({ scope: 'shares:manage' }))
  })

  it('parses only bounded daily owner analytics', async () => {
    const signedFetch = vi.fn(async () => Response.json({ publicId: 'share_1', totals: { fullLoads: 12, embedLoads: 3 }, daily: [{ date: '2026-08-22', fullLoads: 2, embedLoads: 1 }], lastSuccessfulLoadAt: '2026-08-22T12:00:00.000Z', lifecycle: { state: 'active', expiresAt: null, inactivityAt: '2027-08-22T12:00:00.000Z', graceEndsAt: null } }))
    const client = new LabGdPublicationClient({ identityService: { signedFetch } })
    await expect(client.analytics('share_1')).resolves.toMatchObject({ totals: { fullLoads: 12, embedLoads: 3 }, daily: [{ date: '2026-08-22' }] })
    expect(signedFetch).toHaveBeenCalledWith('/v1/installation-shares/share_1/analytics', expect.objectContaining({ method: 'GET', scope: 'analytics:read' }))
  })
})
