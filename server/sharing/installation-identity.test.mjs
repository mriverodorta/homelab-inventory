import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeSharingCredentials, SharingInstallationIdentityService, SharingRecoveryPendingError, SharingUnsupportedError } from './installation-identity.mjs'
import { LEGACY_SHARING_TOKEN_SCOPES, SHARING_TOKEN_SCOPES } from './installation-auth.mjs'

const roots = []

function capabilities() {
  return {
    protocolVersion: 1,
    shareContractVersions: [1],
    viewContractVersions: { systems: [1], canvas: [1] },
    capabilities: {
      installationEvents: { supported: true, resumable: true },
      protectedPasswordHandoff: { supported: true },
      lifecycleOperations: { supported: true, operations: ['update', 'unpublish', 'delete', 'republish', 'replace-password'] },
      accountClaiming: { supported: true, statusSupported: true },
      ownerAnalytics: { supported: true, buckets: ['day'], retentionDays: 90 },
      comments: { configurationSupported: true, interactionSupported: false },
      reactions: { configurationSupported: true, interactionSupported: false },
    },
  }
}

function activeToken(overrides = {}) {
  return {
    status: 'active',
    installationId: 7,
    token: 't'.repeat(32),
    scopes: [...SHARING_TOKEN_SCOPES],
    tokenExpiresAt: '2026-08-22T13:00:00.000Z',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function repository() {
  let projection = null
  return {
    getInstallationProjection: () => projection,
    saveInstallationProjection: (value) => {
      projection = { id: 1, accountClaimed: false, githubUsername: null, accountClaimedAtMs: null, accountBindingRevision: 0, createdAtMs: 1, updatedAtMs: 1, ...value }
      return projection
    },
    deleteInstallationProjection: () => { projection = null },
    reconcileInstallationAccount: (status) => {
      projection = { ...projection, accountClaimed: status.claimed, githubUsername: status.githubUsername, accountClaimedAtMs: status.accountClaimedAtMs, accountBindingRevision: status.accountBindingRevision ?? projection.accountBindingRevision }
      return projection
    },
  }
}

async function setup(handler = null, { capabilityDocument = capabilities() } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homelab-sharing-identity-'))
  roots.push(dataDir)
  const requests = []
  const repo = repository()
  const fetchImpl = async (url, init = {}) => {
    const rawBody = init.body ? Buffer.from(init.body).toString() : ''
    let body = null
    if (rawBody) {
      try {
        body = JSON.parse(rawBody)
      } catch (error) {
        throw new Error(`Invalid test request body: ${JSON.stringify(rawBody)}`, { cause: error })
      }
    }
    const request = { url: new URL(url), init, body }
    requests.push(request)
    if (request.url.pathname === '/v1/capabilities') return Response.json(capabilityDocument)
    if (handler) return handler(request, requests)
    if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
    if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
    if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
    throw new Error(`Unexpected request ${request.url.pathname}`)
  }
  const service = new SharingInstallationIdentityService({
    dataDir,
    repository: repo,
    labGdOrigin: 'https://lab.example.test',
    fetchImpl,
    now: () => new Date('2026-08-22T12:00:00.000Z'),
  })
  return { dataDir, repo, service, requests }
}

describe('sharing installation identity', () => {
  it('accepts only the complete or exact legacy credential scope set and marks legacy renewal', () => {
    const base = { version: 1, clientInstanceId: '11111111-2222-4333-8444-555555555555', installationId: 7, token: 't'.repeat(32), tokenExpiresAt: '2026-08-22T13:00:00.000Z' }
    expect(normalizeSharingCredentials({ ...base, scopes: SHARING_TOKEN_SCOPES }, base.clientInstanceId)).toMatchObject({ renewalRequired: false })
    expect(normalizeSharingCredentials({ ...base, scopes: LEGACY_SHARING_TOKEN_SCOPES }, base.clientInstanceId)).toMatchObject({ renewalRequired: true })
    expect(normalizeSharingCredentials({ ...base, scopes: ['publication:write'] }, base.clientInstanceId)).toBeNull()
    expect(normalizeSharingCredentials({ ...base, scopes: [...LEGACY_SHARING_TOKEN_SCOPES, 'unknown:scope'] }, base.clientInstanceId)).toBeNull()
  })

  it('creates one stable protected identity and rebuilds its SQLite projection', async () => {
    const { dataDir, repo, service } = await setup()
    const first = await service.ensure()
    const instanceBody = await readFile(join(dataDir, 'sharing', 'installation-instance.json'), 'utf8')
    const keyBody = await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')
    expect((await stat(join(dataDir, 'sharing', 'installation-instance.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(dataDir, 'sharing', 'installation-ed25519.pem'))).mode & 0o777).toBe(0o600)
    repo.deleteInstallationProjection()
    const rebuilt = await service.ensure()
    expect(rebuilt.instance.clientInstanceId).toBe(first.instance.clientInstanceId)
    expect(rebuilt.keys.keyId).toBe(first.keys.keyId)
    expect(await readFile(join(dataDir, 'sharing', 'installation-instance.json'), 'utf8')).toBe(instanceBody)
    expect(await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')).toBe(keyBody)
  })

  it('enrolls with a privacy-minimal activation payload and reuses credentials', async () => {
    const { dataDir, repo, service, requests } = await setup()
    const credentials = await service.activate()
    expect(credentials).toMatchObject({ installationId: 7, clientInstanceId: expect.any(String) })
    const challenge = requests.find(({ url }) => url.pathname.endsWith('/challenge'))
    const activation = requests.find(({ url }) => url.pathname.endsWith('/activate'))
    expect(Object.keys(challenge.body)).toEqual(['clientInstanceId'])
    expect(Object.keys(activation.body).sort()).toEqual(['challenge', 'clientInstanceId', 'publicKeySpki', 'signature'])
    expect(JSON.stringify([challenge.body, activation.body])).not.toMatch(/hostname|inventory|project|telemetry|registry|agent|tag|custom/iu)
    expect(repo.getInstallationProjection()).toMatchObject({ state: 'active', remoteInstallationId: 7 })
    expect((await stat(join(dataDir, 'sharing', 'installation-credentials.json'))).mode & 0o777).toBe(0o600)
    await service.activate()
    expect(requests.filter(({ url }) => url.pathname.endsWith('/challenge'))).toHaveLength(1)
  })

  it('enrolls while publication is gated and enforces the gate only for publication writes', async () => {
    let publicationReady = false
    let publicationRequests = 0
    const { dataDir, repo, service, requests } = await setup((request) => {
      if (request.url.pathname === '/readyz') {
        return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady })
      }
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname === '/v1/installations/events') return new Response(null, { status: 204 })
      if (request.url.pathname === '/v1/publications/test') {
        publicationRequests += 1
        return Response.json({ ok: true })
      }
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })

    await expect(service.activate()).resolves.toMatchObject({ installationId: 7 })
    expect(repo.getInstallationProjection()).toMatchObject({ state: 'active', remoteInstallationId: 7 })
    expect((await stat(join(dataDir, 'sharing', 'installation-instance.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(dataDir, 'sharing', 'installation-ed25519.pem'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(dataDir, 'sharing', 'installation-credentials.json'))).mode & 0o777).toBe(0o600)

    await expect(service.signedFetch('/v1/installations/events', { method: 'GET', scope: 'events:read' })).resolves.toMatchObject({ status: 204 })
    await expect(service.signedFetch('/v1/publications/test')).rejects.toMatchObject({ code: 'labgd-unavailable' })
    expect(publicationRequests).toBe(0)

    publicationReady = true
    await expect(service.signedFetch('/v1/publications/test')).resolves.toMatchObject({ status: 200 })
    expect(publicationRequests).toBe(1)
    expect(requests.filter(({ url }) => url.pathname.endsWith('/challenge'))).toHaveLength(1)
    expect(requests.filter(({ url }) => url.pathname.endsWith('/activate'))).toHaveLength(1)
  })

  it('renews legacy credentials with the old token without changing installation identity', async () => {
    let renewals = 0
    const { dataDir, service, repo } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/renew')) {
        renewals += 1
        expect(request.body).toEqual({ scopes: [...SHARING_TOKEN_SCOPES] })
        return Response.json({ token: 'r'.repeat(32), scopes: [...SHARING_TOKEN_SCOPES], tokenExpiresAt: '2026-08-22T14:00:00.000Z' })
      }
      if (request.url.pathname === '/v1/installations/events') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    const before = await service.ensure()
    await service.writeCredentials({ version: 1, clientInstanceId: before.instance.clientInstanceId, installationId: 7, token: 'l'.repeat(32), scopes: [...LEGACY_SHARING_TOKEN_SCOPES], tokenExpiresAt: '2026-08-22T13:00:00.000Z' })
    await service.signedFetch('/v1/installations/events', { method: 'GET', scope: 'events:read' })
    const after = await service.ensure()
    expect(renewals).toBe(1)
    expect(after.instance.clientInstanceId).toBe(before.instance.clientInstanceId)
    expect(after.keys.keyId).toBe(before.keys.keyId)
    expect(repo.getInstallationProjection().remoteInstallationId).toBe(7)
    expect(JSON.parse(await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8')).scopes).toContain('events:read')
  })

  it('challenge-activates an expired credential with the existing identity without attempting renewal', async () => {
    const { dataDir, service, repo, requests } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/renew')) return Response.json({ error: 'authentication-failed' }, { status: 401 })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname === '/v1/installations/events') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    const before = await service.ensure()
    repo.saveInstallationProjection({ ...before.projection, remoteInstallationId: 7, credentialExpiresAtMs: Date.parse('2026-08-22T11:59:00.000Z'), state: 'active' })
    await service.writeCredentials({
      version: 1,
      clientInstanceId: before.instance.clientInstanceId,
      installationId: 7,
      token: 'e'.repeat(32),
      scopes: [...SHARING_TOKEN_SCOPES],
      tokenExpiresAt: '2026-08-22T11:59:00.000Z',
    })

    await expect(service.signedFetch('/v1/installations/events', { method: 'GET', scope: 'events:read' })).resolves.toMatchObject({ status: 204 })

    expect(requests.filter(({ url }) => url.pathname.endsWith('/renew'))).toHaveLength(0)
    expect(requests.filter(({ url }) => url.pathname.endsWith('/challenge'))).toHaveLength(1)
    const activation = requests.find(({ url }) => url.pathname.endsWith('/activate'))
    expect(activation.body).toMatchObject({
      clientInstanceId: before.instance.clientInstanceId,
      publicKeySpki: before.keys.publicKeySpki,
    })
    expect(repo.getInstallationProjection()).toMatchObject({ remoteInstallationId: 7, state: 'active' })
    expect(JSON.parse(await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8')).token).toBe('t'.repeat(32))
  })

  it('challenge-activates once when proactive renewal loses an authentication race', async () => {
    const { service, repo, requests } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/renew')) return Response.json({ error: 'authentication-failed' }, { status: 401 })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname === '/v1/installations/events') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    const before = await service.ensure()
    repo.saveInstallationProjection({ ...before.projection, remoteInstallationId: 7, credentialExpiresAtMs: Date.parse('2026-08-22T12:00:30.000Z'), state: 'active' })
    await service.writeCredentials({
      version: 1,
      clientInstanceId: before.instance.clientInstanceId,
      installationId: 7,
      token: 'n'.repeat(32),
      scopes: [...SHARING_TOKEN_SCOPES],
      tokenExpiresAt: '2026-08-22T12:00:30.000Z',
    })

    await service.signedFetch('/v1/installations/events', { method: 'GET', scope: 'events:read' })

    expect(requests.filter(({ url }) => url.pathname.endsWith('/renew'))).toHaveLength(1)
    expect(requests.filter(({ url }) => url.pathname.endsWith('/challenge'))).toHaveLength(1)
    expect(requests.filter(({ url }) => url.pathname.endsWith('/activate'))).toHaveLength(1)
  })

  it('does not challenge-activate after a non-authentication renewal failure', async () => {
    const { service, repo, requests } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/renew')) return Response.json({ error: 'renewal-unavailable' }, { status: 503 })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    const before = await service.ensure()
    repo.saveInstallationProjection({ ...before.projection, remoteInstallationId: 7, credentialExpiresAtMs: Date.parse('2026-08-22T12:00:30.000Z'), state: 'active' })
    await service.writeCredentials({
      version: 1,
      clientInstanceId: before.instance.clientInstanceId,
      installationId: 7,
      token: 'n'.repeat(32),
      scopes: [...SHARING_TOKEN_SCOPES],
      tokenExpiresAt: '2026-08-22T12:00:30.000Z',
    })

    await expect(service.signedFetch('/v1/installations/events', { method: 'GET', scope: 'events:read' })).rejects.toMatchObject({ code: 'renewal-unavailable' })
    expect(requests.filter(({ url }) => url.pathname.endsWith('/challenge'))).toHaveLength(0)
  })

  it('fails closed when reactivation returns a different logical installation', async () => {
    const { dataDir, service, repo } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken({ installationId: 8 }), { status: 201 })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    const before = await service.ensure()
    repo.saveInstallationProjection({ ...before.projection, remoteInstallationId: 7, credentialExpiresAtMs: Date.parse('2026-08-22T11:59:00.000Z'), state: 'active' })
    await service.writeCredentials({
      version: 1,
      clientInstanceId: before.instance.clientInstanceId,
      installationId: 7,
      token: 'e'.repeat(32),
      scopes: [...SHARING_TOKEN_SCOPES],
      tokenExpiresAt: '2026-08-22T11:59:00.000Z',
    })
    const credentialsBefore = await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8')

    await expect(service.signedFetch('/v1/installations/events', { method: 'GET', scope: 'events:read' })).rejects.toMatchObject({ code: 'sharing-installation-identity-mismatch' })
    expect(await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8')).toBe(credentialsBefore)
    expect(repo.getInstallationProjection()).toMatchObject({ remoteInstallationId: 7, state: 'active' })
  })

  it('rejects activation responses that omit authoritative scopes or expiry', async () => {
    const { service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json({ status: 'active', installationId: 7, token: 't'.repeat(32) }, { status: 201 })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    await expect(service.activate()).rejects.toBeInstanceOf(SharingUnsupportedError)
  })

  it('accepts only the complete non-secret account claim contract', async () => {
    const { service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/claim-device')) return Response.json({
        claimId: 'claim_123',
        userCode: 'ABCD-2345',
        verificationUrl: 'https://app.lab.gd/claim',
        expiresAt: '2026-08-22T12:10:00.000Z',
        state: 'pending',
      }, { status: 201 })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    expect(await service.createClaimDevice()).toEqual({
      claimId: 'claim_123',
      userCode: 'ABCD-2345',
      verificationUrl: 'https://app.lab.gd/claim',
      expiresAt: '2026-08-22T12:10:00.000Z',
      state: 'pending',
    })
  })

  it('reconciles authoritative installation account state with the GitHub username', async () => {
    const { repo, service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/account-status')) return Response.json({
        claimed: true,
        githubUsername: 'maikeldorta',
        claimedAt: '2026-08-22T12:05:00.000Z',
      })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    await service.activate()

    await expect(service.reconcileAccountStatus()).resolves.toEqual({
      claimed: true,
      githubUsername: 'maikeldorta',
      accountClaimedAtMs: Date.parse('2026-08-22T12:05:00.000Z'),
    })
    expect(repo.getInstallationProjection()).toMatchObject({
      accountClaimed: true,
      githubUsername: 'maikeldorta',
    })
  })

  it('uses negotiated status v2 and accepts only the bounded unlink contract', async () => {
    const capabilityDocument = capabilities()
    capabilityDocument.capabilities.accountClaiming = {
      supported: true,
      statusSupported: true,
      statusVersions: [1, 2],
      unlinkSupported: true,
      unlinkDispositions: ['keep', 'unpublish', 'delete'],
    }
    const { repo, service, requests } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/account-status-v2')) return Response.json({ claimed: true, githubUsername: 'maikeldorta', claimedAt: '2026-08-22T12:05:00.000Z', bindingRevision: 3 })
      if (request.url.pathname.endsWith('/account/unlink')) return Response.json({
        account: { connected: false, githubUsername: null, bindingRevision: 4 },
        disposition: 'unpublish',
        affected: { shares: 2, keptOnline: 0, unpublished: 2, deleted: 0 },
      })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    }, { capabilityDocument })
    await service.activate()
    await expect(service.reconcileAccountStatus()).resolves.toMatchObject({ accountBindingRevision: 3 })
    expect(repo.getInstallationProjection()).toMatchObject({ accountClaimed: true, accountBindingRevision: 3 })

    await expect(service.unlinkAccount({
      idempotencyKey: '53af605e-c601-4cab-b5f1-24e4f9e2b38d',
      expectedAccountBindingRevision: 3,
      shareDisposition: 'unpublish',
    })).resolves.toEqual({
      account: { connected: false, githubUsername: null, bindingRevision: 4 },
      disposition: 'unpublish',
      affected: { shares: 2, keptOnline: 0, unpublished: 2, deleted: 0 },
    })
    expect(requests.some(({ url }) => url.pathname.endsWith('/account-status'))).toBe(false)
    expect(requests.find(({ url }) => url.pathname.endsWith('/account/unlink'))?.body).toEqual({
      requestVersion: 1,
      idempotencyKey: '53af605e-c601-4cab-b5f1-24e4f9e2b38d',
      expectedAccountBindingRevision: 3,
      shareDisposition: 'unpublish',
    })
  })

  it('rejects malformed unlink counts and preserves the current account projection', async () => {
    const capabilityDocument = capabilities()
    capabilityDocument.capabilities.accountClaiming = { supported: true, statusSupported: true, statusVersions: [1, 2], unlinkSupported: true, unlinkDispositions: ['keep', 'unpublish', 'delete'] }
    const { repo, service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/account-status-v2')) return Response.json({ claimed: true, githubUsername: 'maikeldorta', claimedAt: '2026-08-22T12:05:00.000Z', bindingRevision: 3 })
      if (request.url.pathname.endsWith('/account/unlink')) return Response.json({ account: { connected: false, githubUsername: null, bindingRevision: 4 }, disposition: 'delete', affected: { shares: 2, keptOnline: 0, unpublished: 0, deleted: 1 } })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    }, { capabilityDocument })
    await service.activate()
    await service.reconcileAccountStatus()
    const before = repo.getInstallationProjection()
    await expect(service.unlinkAccount({ idempotencyKey: 'a7a7e28e-932f-4edb-a72b-6bf5fcda61c6', expectedAccountBindingRevision: 3, shareDisposition: 'delete' })).rejects.toMatchObject({ code: 'labgd-account-unlink-failed' })
    expect(repo.getInstallationProjection()).toEqual(before)
  })

  it('converges an already-claimed response instead of creating another claim', async () => {
    const { service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/claim-device')) return Response.json({ code: 'installation-already-claimed' }, { status: 409 })
      if (request.url.pathname.endsWith('/account-status')) return Response.json({
        claimed: true,
        githubUsername: 'maikeldorta',
        claimedAt: '2026-08-22T12:05:00.000Z',
      })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })

    await expect(service.createClaimDevice()).resolves.toEqual({
      state: 'claimed',
      account: {
        claimed: true,
        githubUsername: 'maikeldorta',
        accountClaimedAtMs: Date.parse('2026-08-22T12:05:00.000Z'),
      },
    })
  })

  it('rejects malformed installation account status without changing local state', async () => {
    const { repo, service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/account-status')) return Response.json({ claimed: false, githubUsername: 'leaked-name', claimedAt: null })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    await service.activate()
    const before = repo.getInstallationProjection()

    await expect(service.reconcileAccountStatus()).rejects.toMatchObject({ code: 'labgd-account-status-failed' })
    expect(repo.getInstallationProjection()).toEqual(before)
  })

  it('rejects claim verification destinations other than the exact clean app.lab.gd path', async () => {
    const { service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/claim-device')) return Response.json({ claimId: 'claim_123', userCode: 'ABCD-2345', verificationUrl: 'https://app.lab.gd/claim?code=ABCD-2345', expiresAt: '2026-08-22T12:10:00.000Z', state: 'pending' }, { status: 201 })
      throw new Error(`Unexpected request ${request.url.pathname}`)
    })
    await expect(service.createClaimDevice()).rejects.toThrow(/claim/iu)
  })

  it('persists recovery pending without generating repeated replacement keys', async () => {
    const { dataDir, repo, service, requests } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      return Response.json({ status: 'recovery-pending', installationId: 8 }, { status: 409 })
    })
    const keyBefore = (await service.ensure()).keys.keyId
    await expect(service.activate()).rejects.toBeInstanceOf(SharingRecoveryPendingError)
    expect(repo.getInstallationProjection()).toMatchObject({ state: 'recovery-pending', recoveryPublicKeySpki: expect.any(String) })
    await expect(service.resumeRecovery()).rejects.toBeInstanceOf(SharingRecoveryPendingError)
    expect((await service.ensure()).keys.keyId).toBe(keyBefore)
    expect(requests.filter(({ url }) => url.pathname.endsWith('/activate'))).toHaveLength(2)
    expect(await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')).toContain('PRIVATE KEY')
  })

  it('keeps the old key and credentials when authenticated rotation fails', async () => {
    const { dataDir, service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/rotate')) return Response.json({ error: 'rotation-unavailable' }, { status: 503 })
      throw new Error('Unexpected request')
    })
    await service.activate()
    const key = await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')
    const credentials = await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8')
    await expect(service.rotateKey()).rejects.toThrow()
    expect(await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')).toBe(key)
    expect(await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8')).toBe(credentials)
  })

  it('retains one replacement key when rotation requires owner recovery', async () => {
    const { dataDir, repo, service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json(activeToken(), { status: 201 })
      if (request.url.pathname.endsWith('/rotate')) return Response.json({ status: 'recovery-pending', installationId: 7 }, { status: 409 })
      throw new Error('Unexpected request')
    })
    await service.activate()
    const originalKey = await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')
    await expect(service.rotateKey()).rejects.toBeInstanceOf(SharingRecoveryPendingError)
    expect(await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')).toBe(originalKey)
    expect(await readFile(join(dataDir, 'sharing', 'installation-recovery-ed25519.pem'), 'utf8')).toContain('PRIVATE KEY')
    expect(repo.getInstallationProjection()).toMatchObject({ state: 'recovery-pending', recoveryPublicKeySpki: expect.any(String) })
  })
})
