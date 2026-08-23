import { describe, expect, it, vi } from 'vitest'

import { verifySharingReadiness } from './verify-contract-readiness.mjs'

const labGdCapabilities = {
  protocolVersion: 1,
  shareContractVersions: [1],
  viewContractVersions: { systems: [1], canvas: [1] },
  capabilities: {
    installationEvents: { supported: true, resumable: true },
    protectedPasswordHandoff: { supported: true },
    lifecycleOperations: { supported: true, operations: ['update', 'unpublish', 'delete', 'republish', 'replace-password'] },
    accountClaiming: { supported: true },
    ownerAnalytics: { supported: true, buckets: ['day'], retentionDays: 90 },
    comments: { configurationSupported: true, interactionSupported: false },
    reactions: { configurationSupported: true, interactionSupported: false },
  },
}

const negotiatedCapabilities = {
  version: 1,
  publication: true,
  accountClaiming: true,
  installationEvents: true,
  ownerAnalytics: true,
  protectedShares: true,
  remoteLifecycle: true,
  views: ['systems', 'canvas'],
  visibility: ['public', 'unlisted', 'protected'],
  mutability: ['immutable', 'replaceable'],
  synchronization: ['manual', 'synchronized'],
  embeds: true,
  resourceSnapshots: true,
  comments: 'coming-soon',
  reactions: 'coming-soon',
}

function fetcher({ enrollmentState = 'connected', capabilities = negotiatedCapabilities, publicationReady = true } = {}) {
  return vi.fn(async (url, _init) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'inventory.test' && parsed.pathname === '/api/health') {
      return Response.json({ ok: true, mode: 'production', schemaVersion: 33 })
    }
    if (parsed.hostname === 'lab.test' && parsed.pathname === '/readyz') {
      return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady })
    }
    if (parsed.hostname === 'lab.test' && parsed.pathname === '/v1/capabilities') return Response.json(labGdCapabilities)
    if (parsed.hostname === 'inventory.test' && parsed.pathname === '/api/sharing/settings') {
      return Response.json({
        available: true,
        automaticEnrollment: true,
        demo: false,
        staging: false,
        capabilities,
        settings: { connectionEnabled: true, enrollmentState },
      })
    }
    if (parsed.hostname === 'inventory.test' && parsed.pathname === '/api/sharing/capabilities') return Response.json(capabilities)
    throw new Error(`Unexpected request: ${parsed}`)
  })
}

describe('sharing rollout verifier', () => {
  it('proves connected enrollment and exact capability negotiation without mutations', async () => {
    const fetchImpl = fetcher()
    await expect(verifySharingReadiness({
      appOrigin: 'https://inventory.test',
      labGdOrigin: 'https://lab.test',
      sessionCookie: 'session=test',
      fetchImpl,
    })).resolves.toMatchObject({
      ok: true,
      app: { schemaVersion: 33, enrollmentState: 'connected' },
      labGd: { contractMode: 'packages-enabled', publicationReady: true },
    })
    expect(fetchImpl.mock.calls.every(([, init]) => init.method == null || init.method === 'GET')).toBe(true)
    const settingsRequest = fetchImpl.mock.calls.find(([url]) => new URL(url).pathname === '/api/sharing/settings')
    expect(settingsRequest?.[1].headers.cookie).toBe('session=test')
  })

  it('fails while enrollment is pending', async () => {
    await expect(verifySharingReadiness({
      appOrigin: 'https://inventory.test',
      labGdOrigin: 'https://lab.test',
      fetchImpl: fetcher({ enrollmentState: 'pending' }),
    })).rejects.toThrow('enrollment is pending')
  })

  it('separates gated enrollment verification from publication-ready verification', async () => {
    const fetchImpl = fetcher({ publicationReady: false })
    await expect(verifySharingReadiness({
      appOrigin: 'https://inventory.test',
      labGdOrigin: 'https://lab.test',
      fetchImpl,
    })).resolves.toMatchObject({
      ok: true,
      labGd: { publicationReady: false },
    })
    await expect(verifySharingReadiness({
      appOrigin: 'https://inventory.test',
      labGdOrigin: 'https://lab.test',
      fetchImpl,
      requirePublicationReady: true,
    })).rejects.toThrow('publication is not ready')
  })

  it('fails when the app exposes a capability that lab.gd did not negotiate', async () => {
    await expect(verifySharingReadiness({
      appOrigin: 'https://inventory.test',
      labGdOrigin: 'https://lab.test',
      fetchImpl: fetcher({ capabilities: { ...negotiatedCapabilities, ownerAnalytics: false } }),
    })).rejects.toThrow('does not match negotiated lab.gd capabilities')
  })
})
