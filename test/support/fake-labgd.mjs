import { createHash, createPublicKey, verify } from 'node:crypto'

const scopes = ['publication:write', 'events:read', 'shares:manage', 'analytics:read', 'token:renew', 'key:rotate', 'claim:create']

export class FakeLabGd {
  constructor() {
    this.installations = new Map()
    this.tokens = new Map()
    this.challenges = new Map()
    this.nonces = new Set()
    this.shareOwners = new Map()
    this.nextInstallationId = 1
    this.nextOperationId = 1
  }

  fetch = async (url, init = {}) => {
    const pathname = new URL(url).pathname
    const body = bytes(init.body)
    if (pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
    if (pathname === '/v1/capabilities') return Response.json(capabilityDocument())
    if (pathname === '/v1/installations/challenge') {
      const clientInstanceId = json(body).clientInstanceId
      const value = `challenge-${createHash('sha256').update(clientInstanceId).digest('hex')}`
      this.challenges.set(clientInstanceId, value)
      return Response.json({ value }, { status: 201 })
    }
    if (pathname === '/v1/installations/activate') return this.activate(json(body))
    const claimRoute = pathname === '/v1/installations/account-status' || pathname === '/v1/installations/account-status-v2' || pathname === '/v1/installations/account/unlink'
    const installation = this.authenticate(init.headers, body, claimRoute ? 'claim:create' : 'publication:write')
    if (!installation) return Response.json({ error: 'authentication-failed' }, { status: 401 })
    if (pathname === '/v1/installations/account-status') return Response.json({ claimed: installation.claimed, githubUsername: installation.githubUsername, claimedAt: installation.claimedAt })
    if (pathname === '/v1/installations/account-status-v2') return Response.json({ claimed: installation.claimed, githubUsername: installation.githubUsername, claimedAt: installation.claimedAt, bindingRevision: installation.bindingRevision })
    if (pathname === '/v1/installations/account/unlink') return this.unlinkAccount(installation, json(body))
    if (pathname === '/v1/publications/manifest') {
      const value = json(body)
      const existingOwner = this.shareOwners.get(value.sharePublicId)
      if (existingOwner && existingOwner !== installation.id) return Response.json({ error: 'not-found' }, { status: 404 })
      this.shareOwners.set(value.sharePublicId, installation.id)
      return Response.json({ operation: { id: this.nextOperationId++, state: 'ready' }, missingHashes: [] }, { status: 202 })
    }
    return Response.json({ error: 'not-found' }, { status: 404 })
  }

  activate(value) {
    const challenge = this.challenges.get(value.clientInstanceId)
    if (!challenge || challenge !== value.challenge) return Response.json({ error: 'authentication-failed' }, { status: 401 })
    const publicKey = publicKeyFromSpki(value.publicKeySpki)
    const valid = verify(null, Buffer.from(`${challenge}\n${value.clientInstanceId}`), publicKey, Buffer.from(value.signature, 'base64'))
    if (!valid) return Response.json({ error: 'authentication-failed' }, { status: 401 })
    let installation = this.installations.get(value.clientInstanceId)
    if (!installation) {
      installation = { id: this.nextInstallationId++, clientInstanceId: value.clientInstanceId, publicKey, claimed: false, githubUsername: null, claimedAt: null, bindingRevision: 0, unlinkOperations: new Map() }
      this.installations.set(value.clientInstanceId, installation)
    }
    const token = `token-${installation.id}-${'x'.repeat(32)}`
    this.tokens.set(token, installation)
    return Response.json({
      status: 'active',
      installationId: installation.id,
      token,
      scopes,
      tokenExpiresAt: '2026-08-22T13:00:00.000Z',
    }, { status: 201 })
  }

  unlinkAccount(installation, request) {
    const existing = installation.unlinkOperations.get(request.idempotencyKey)
    if (existing) return Response.json(existing)
    if (!installation.claimed) return Response.json({ message: 'Installation account is not linked.', code: 'installation-account-not-linked' }, { status: 409 })
    if (request.expectedAccountBindingRevision !== installation.bindingRevision) return Response.json({ message: 'Account binding changed.', code: 'account-binding-changed' }, { status: 409 })
    const shares = [...this.shareOwners.values()].filter((owner) => owner === installation.id).length
    installation.claimed = false
    installation.githubUsername = null
    installation.claimedAt = null
    installation.bindingRevision += 1
    const result = {
      account: { connected: false, githubUsername: null, bindingRevision: installation.bindingRevision },
      disposition: request.shareDisposition,
      affected: {
        shares,
        keptOnline: request.shareDisposition === 'keep' ? shares : 0,
        unpublished: request.shareDisposition === 'unpublish' ? shares : 0,
        deleted: request.shareDisposition === 'delete' ? shares : 0,
      },
    }
    installation.unlinkOperations.set(request.idempotencyKey, result)
    return Response.json(result)
  }

  authenticate(headersValue, body, requiredScope) {
    const headers = new Headers(headersValue)
    const installation = this.tokens.get(headers.get('authorization')?.replace(/^Bearer /u, ''))
    const nonce = headers.get('x-labgd-nonce')
    if (!installation || !nonce || this.nonces.has(nonce)) return null
    const timestamp = headers.get('x-labgd-timestamp')
    const signature = headers.get('x-labgd-signature')
    if (!timestamp || !signature) return null
    const bodyHash = createHash('sha256').update(body).digest('hex')
    const payload = Buffer.from(`${timestamp}\n${nonce}\n${bodyHash}\n${requiredScope}`)
    if (!verify(null, payload, installation.publicKey, Buffer.from(signature, 'base64'))) return null
    this.nonces.add(nonce)
    return installation
  }
}

function capabilityDocument() {
  return {
    protocolVersion: 1,
    shareContractVersions: [1],
    viewContractVersions: { systems: [1], canvas: [1] },
    capabilities: {
      installationEvents: { supported: true, resumable: true },
      protectedPasswordHandoff: { supported: true },
      lifecycleOperations: { supported: true, operations: ['update', 'unpublish', 'delete', 'republish', 'replace-password'] },
      accountClaiming: { supported: true, statusSupported: true, statusVersions: [1, 2], unlinkSupported: true, unlinkDispositions: ['keep', 'unpublish', 'delete'] },
      ownerAnalytics: { supported: true, buckets: ['day'], retentionDays: 90 },
      comments: { configurationSupported: true, interactionSupported: false },
      reactions: { configurationSupported: true, interactionSupported: false },
    },
  }
}

function publicKeyFromSpki(value) {
  return createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' })
}

function bytes(value) {
  if (value == null) return Buffer.alloc(0)
  if (typeof value === 'string') return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  throw new Error('Unsupported fake request body.')
}

function json(value) {
  return JSON.parse(value.toString('utf8'))
}
