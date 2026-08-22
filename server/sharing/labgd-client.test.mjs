import { describe, expect, it, vi } from 'vitest'
import { LabGdPublicationClient } from './labgd-client.mjs'

describe('lab.gd installation control client', () => {
  it('opens signed resumable events with the persisted cursor', async () => {
    const signedFetch = vi.fn(async () => new Response(': heartbeat\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    const client = new LabGdPublicationClient({ identityService: { signedFetch } })
    await client.events(42)
    expect(signedFetch).toHaveBeenCalledWith('/v1/installations/events', expect.objectContaining({ method: 'GET', scope: 'events:read', timeoutMs: 0, headers: { 'last-event-id': '42' } }))
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
