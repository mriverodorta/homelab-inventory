import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSharingRoutes } from './routes.mjs'

const servers = []

async function server(options) {
  const app = express()
  app.use(express.json())
  registerSharingRoutes(app, options)
  const listener = app.listen(0)
  await new Promise((resolve) => listener.once('listening', resolve))
  servers.push(listener)
  return `http://127.0.0.1:${listener.address().port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((listener) => new Promise((resolve) => listener.close(resolve))))
})

describe('sharing routes', () => {
  it.each([
    [{ demo: true }, 'sharing-disabled-in-demo'],
    [{ staging: true }, 'sharing-disabled-in-staging'],
    [{}, 'sharing-disabled-by-environment'],
  ])('fails closed without creating a sharing runtime', async (flags, code) => {
    const baseUrl = await server({ ...flags, effectiveEnabled: false })
    const status = await fetch(`${baseUrl}/api/sharing/settings`).then((response) => response.json())
    expect(status).toMatchObject({
      available: false,
      capabilities: { publication: false, protectedShares: false, views: [] },
      settings: { connectionEnabled: false, enrollmentState: 'disabled' },
    })
    const mutation = await fetch(`${baseUrl}/api/sharing/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(mutation.status).toBe(403)
    expect(await mutation.json()).toMatchObject({ code })
  })

  it('previews and queues only an explicitly approved share', async () => {
    const share = { id: 3, localRevision: 1, projectId: 1 }
    const repository = {
      getSettings: () => ({ revision: 1, connectionEnabled: true, enrollmentState: 'connected' }),
      createShare: vi.fn(() => share),
      getShareConfiguration: vi.fn(() => ({ share, views: [] })),
      listShares: vi.fn(() => [share]),
    }
    const publicationService = {
      preview: vi.fn(async () => ({
        manifestHash: 'a'.repeat(64),
        manifest: { shareContractVersion: 1 },
        summary: { views: 1, items: 2 },
        byteLength: 123,
        approved: false,
        blobs: [{ value: { viewType: 'systems', publicViewId: 'view-1' } }],
      })),
      approvePreview: vi.fn(async () => ({ ...share, state: 'preview-ready' })),
      enqueuePublish: vi.fn(async () => ({ id: 7, state: 'queued' })),
    }
    const wake = vi.fn()
    const baseUrl = await server({
      repository,
      publicationService,
      publicationCoordinator: { wake },
      identityService: {},
      effectiveEnabled: true,
    })
    const preview = await fetch(`${baseUrl}/api/sharing/shares/3/preview`, { method: 'POST' })
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({
      manifestHash: 'a'.repeat(64),
      summary: { items: 2 },
      views: [{ viewType: 'systems', publicViewId: 'view-1' }],
    })
    const publish = await fetch(`${baseUrl}/api/sharing/shares/3/publish`, { method: 'POST' })
    expect(publish.status).toBe(202)
    expect(publicationService.enqueuePublish).toHaveBeenCalledWith(3)
    expect(wake).toHaveBeenCalledOnce()
  })

  it('exposes optional remote behavior only after explicit capability negotiation', async () => {
    const baseUrl = await server({
      repository: { getSettings: () => ({ revision: 1, connectionEnabled: true, enrollmentState: 'connected' }) },
      publicationService: {},
      identityService: {},
      effectiveEnabled: true,
      remoteCapabilities: { accountClaiming: true, protectedShares: true },
    })
    expect(await fetch(`${baseUrl}/api/sharing/capabilities`).then((response) => response.json())).toMatchObject({
      publication: true,
      accountClaiming: true,
      protectedShares: true,
      ownerAnalytics: false,
      visibility: ['public', 'unlisted', 'protected'],
    })
  })

  it('returns and refreshes authoritative installation account state', async () => {
    let projection = { accountClaimed: false, githubUsername: null, accountClaimedAtMs: null }
    const reconcileAccountStatus = vi.fn(async () => {
      projection = {
        accountClaimed: true,
        githubUsername: 'maikeldorta',
        accountClaimedAtMs: Date.parse('2026-08-22T12:05:00.000Z'),
      }
    })
    const repository = {
      getSettings: () => ({ revision: 1, connectionEnabled: true, enrollmentState: 'connected' }),
      getInstallationProjection: () => projection,
    }
    const baseUrl = await server({
      repository,
      publicationService: {},
      identityService: { reconcileAccountStatus },
      effectiveEnabled: true,
      remoteCapabilities: { accountClaiming: true, installationAccountStatus: true },
    })

    expect(await fetch(`${baseUrl}/api/sharing/settings`).then((response) => response.json())).toMatchObject({
      settings: { account: { claimed: false, githubUsername: null, claimedAtMs: null } },
    })
    const response = await fetch(`${baseUrl}/api/sharing/account/reconcile`, { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      settings: {
        account: {
          claimed: true,
          githubUsername: 'maikeldorta',
          claimedAtMs: Date.parse('2026-08-22T12:05:00.000Z'),
        },
      },
    })
    expect(reconcileAccountStatus).toHaveBeenCalledOnce()
  })

  it('mounts lifecycle, protected password, and analytics routes behind negotiated capabilities', async () => {
    const publicationService = {
      enqueueLifecycle: vi.fn((_id, kind) => ({ id: kind === 'delete' ? 3 : 2, kind, idempotencyKey: `stable-${kind}` })),
      republish: vi.fn(async () => ({ id: 1, state: 'synced' })),
      replacePassword: vi.fn(async (_id, password) => { expect(password).toBe('request-only-password'); return { share: { id: 1 }, passwordConfigured: true, viewerGrantsRevoked: true } }),
      analytics: vi.fn(async () => ({ publicId: 'share_1', totals: { fullLoads: 2, embedLoads: 1 }, daily: [] })),
    }
    const wake = vi.fn()
    const baseUrl = await server({ repository: { getSettings: () => ({ revision: 1, connectionEnabled: true, enrollmentState: 'connected' }) }, publicationService, publicationCoordinator: { wake }, identityService: { getCapabilities: () => ({ remoteLifecycle: true, protectedShares: true, ownerAnalytics: true }) }, effectiveEnabled: true })
    expect((await fetch(`${baseUrl}/api/sharing/shares/1/unpublish`, { method: 'POST' })).status).toBe(202)
    expect((await fetch(`${baseUrl}/api/sharing/shares/1`, { method: 'DELETE' })).status).toBe(202)
    expect((await fetch(`${baseUrl}/api/sharing/shares/1/republish`, { method: 'POST' })).status).toBe(200)
    expect((await fetch(`${baseUrl}/api/sharing/shares/1/password`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'request-only-password' }) })).status).toBe(200)
    expect((await fetch(`${baseUrl}/api/sharing/shares/1/analytics`)).status).toBe(200)
    expect(wake).toHaveBeenCalledTimes(2)
  })
})
