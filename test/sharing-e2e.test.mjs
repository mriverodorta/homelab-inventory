import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SharingInstallationIdentityService } from '../server/sharing/installation-identity.mjs'
import { LabGdPublicationClient } from '../server/sharing/labgd-client.mjs'
import { signedRequestHeaders } from '../server/sharing/installation-auth.mjs'
import { FakeLabGd } from './support/fake-labgd.mjs'
import { SharingInstallationEventCoordinator } from '../server/sharing/installation-event-coordinator.mjs'

const roots = []

const capabilities = {
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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function projectionRepository() {
  let projection = null
  return {
    getInstallationProjection: () => projection,
    saveInstallationProjection: (value) => {
      projection = { id: 1, createdAtMs: 1, updatedAtMs: 1, ...value }
      return projection
    },
  }
}

describe('lab.gd sharing protocol', () => {
  it('enrolls without publishing, then performs one signed manifest-first publication', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'homelab-sharing-e2e-'))
    roots.push(dataDir)
    const paths = []
    const fetchImpl = async (url, init = {}) => {
      const pathname = new URL(url).pathname
      paths.push(pathname)
      if (pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (pathname === '/v1/capabilities') return Response.json(capabilities)
      if (pathname === '/v1/installations/challenge') return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (pathname === '/v1/installations/activate') return Response.json({ status: 'active', installationId: 7, token: 't'.repeat(32), scopes: ['publication:write', 'events:read', 'shares:manage', 'analytics:read', 'token:renew', 'key:rotate', 'claim:create'], tokenExpiresAt: '2026-08-22T13:00:00.000Z' }, { status: 201 })
      expect(init.headers.authorization).toBe(`Bearer ${'t'.repeat(32)}`)
      expect(init.headers['x-labgd-signature']).toMatch(/^[A-Za-z0-9+/]+=*$/u)
      if (pathname === '/v1/publications/manifest') return Response.json({ operation: { id: 11 }, missingHashes: ['a'.repeat(64)] }, { status: 202 })
      if (pathname === `/v1/publications/operations/11/blobs/${'a'.repeat(64)}`) return new Response(null, { status: 204 })
      if (pathname === '/v1/publications/operations/11/activate') return Response.json({ revisionId: 21 })
      throw new Error(`Unexpected request: ${pathname}`)
    }
    const repository = projectionRepository()
    const identity = new SharingInstallationIdentityService({
      dataDir,
      repository,
      labGdOrigin: 'https://lab.example.test',
      fetchImpl,
      now: () => new Date('2026-08-22T12:00:00.000Z'),
    })

    await identity.activate()
    expect(paths).toEqual(['/readyz', '/v1/capabilities', '/v1/installations/challenge', '/v1/installations/activate'])
    expect(paths.some((path) => path.startsWith('/v1/publications/'))).toBe(false)

    const client = new LabGdPublicationClient({ identityService: identity })
    const staged = await client.stage({
      idempotencyKey: 'share:1:1',
      sharePublicId: 'share_public_0001',
      manifest: { shareContractVersion: 1 },
      availableHashes: [],
    })
    expect(staged).toEqual({ operationId: 11, missingHashes: ['a'.repeat(64)] })
    await client.upload(11, { contentHash: 'a'.repeat(64), contentJson: '{"viewType":"systems"}', mediaType: 'application/json' })
    expect(await client.activate(11, 0)).toEqual({ revisionId: 21 })
    expect(paths.filter((path) => path.startsWith('/v1/publications/'))).toEqual([
      '/v1/publications/manifest',
      `/v1/publications/operations/11/blobs/${'a'.repeat(64)}`,
      '/v1/publications/operations/11/activate',
    ])

    const restarted = new SharingInstallationIdentityService({
      dataDir,
      repository,
      labGdOrigin: 'https://lab.example.test',
      fetchImpl,
      now: () => new Date('2026-08-22T12:00:30.000Z'),
    })
    await restarted.activate()
    expect(paths.filter((path) => path === '/v1/installations/challenge')).toHaveLength(1)
  })

  it('keeps signed publication ownership isolated across two installations', async () => {
    const fake = new FakeLabGd()
    const services = []
    for (let index = 0; index < 2; index += 1) {
      const dataDir = await mkdtemp(join(tmpdir(), `homelab-sharing-owner-${index}-`))
      roots.push(dataDir)
      const identity = new SharingInstallationIdentityService({
        dataDir,
        repository: projectionRepository(),
        labGdOrigin: 'https://lab.example.test',
        fetchImpl: fake.fetch,
        now: () => new Date('2026-08-22T12:00:00.000Z'),
      })
      await identity.activate()
      services.push({ identity, client: new LabGdPublicationClient({ identityService: identity }) })
    }

    const manifest = { shareContractVersion: 1 }
    await expect(services[0].client.stage({ idempotencyKey: 'owner-a', sharePublicId: 'share_public_0001', manifest, availableHashes: [] }))
      .resolves.toMatchObject({ operationId: 1 })
    await expect(services[1].client.stage({ idempotencyKey: 'owner-b', sharePublicId: 'share_public_0001', manifest, availableHashes: [] }))
      .rejects.toMatchObject({ code: 'not-found' })
    await expect(services[1].client.stage({ idempotencyKey: 'owner-b-own', sharePublicId: 'share_public_0002', manifest, availableHashes: [] }))
      .resolves.toMatchObject({ operationId: 2 })
    expect(fake.installations).toHaveLength(2)
    expect(fake.shareOwners.get('share_public_0001')).not.toBe(fake.shareOwners.get('share_public_0002'))
  })

  it('rejects a replayed signed installation nonce', async () => {
    const fake = new FakeLabGd()
    const dataDir = await mkdtemp(join(tmpdir(), 'homelab-sharing-replay-'))
    roots.push(dataDir)
    const identity = new SharingInstallationIdentityService({
      dataDir,
      repository: projectionRepository(),
      labGdOrigin: 'https://lab.example.test',
      fetchImpl: fake.fetch,
      now: () => new Date('2026-08-22T12:00:00.000Z'),
    })
    await identity.activate()
    const { keys } = await identity.ensure()
    const credentials = JSON.parse(await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8'))
    const body = Buffer.from(JSON.stringify({ sharePublicId: 'share_public_replay' }))
    const headers = {
      'content-type': 'application/json',
      ...signedRequestHeaders({
        token: credentials.token,
        body,
        scope: 'publication:write',
        privateKey: keys.privateKey,
        now: new Date('2026-08-22T12:00:00.000Z'),
        nonce: 'replayed-installation-nonce',
      }),
    }
    const first = await fake.fetch('https://lab.example.test/v1/publications/manifest', { method: 'POST', headers, body })
    const replay = await fake.fetch('https://lab.example.test/v1/publications/manifest', { method: 'POST', headers, body })
    expect(first.status).toBe(202)
    expect(replay.status).toBe(401)
  })

  it('reconstructs resumable event delivery without duplicate cursor application', async () => {
    const state = { cursor: 0, applied: [] }
    const repository = {
      getSettings: () => ({ connectionEnabled: true, enrollmentState: 'connected', remoteEventCursor: state.cursor }),
      applyRemoteEvent: (event) => { if (event.id <= state.cursor) return { applied: false, shares: [] }; state.cursor = event.id; state.applied.push(event.id); return { applied: true, shares: [] } },
    }
    const identityService = { getCapabilities: () => ({ installationEvents: true }), readiness: vi.fn() }
    const client = { events: vi.fn(async (cursor) => new Response(`id: ${cursor + 1}\nevent: recovery\ndata: {"eventVersion":1,"state":"active","occurredAt":"2026-08-22T12:00:00.000Z"}\n\n`, { headers: { 'content-type': 'text/event-stream' } })) }
    for (let restart = 0; restart < 2; restart += 1) {
      const coordinator = new SharingInstallationEventCoordinator({ repository, client, identityService, setTimer: () => 1, clearTimer: () => {} })
      coordinator.stopped = false
      await coordinator.connect()
      coordinator.stop()
    }
    expect(client.events.mock.calls.map(([cursor]) => cursor)).toEqual([0, 1])
    expect(state.applied).toEqual([1, 2])
    expect(state.cursor).toBe(2)
  })

  it('does not create an event connection when sharing is environment-disabled', () => {
    const events = vi.fn()
    const coordinator = new SharingInstallationEventCoordinator({ repository: {}, client: { events }, identityService: {}, effectiveEnabled: false, setTimer: vi.fn() })
    coordinator.start()
    expect(events).not.toHaveBeenCalled()
  })
})
