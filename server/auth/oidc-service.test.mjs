// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import * as oidc from 'openid-client'
import { assertAuthenticationStoreShape, createAuthenticationStore, createOwnerAccount, ensureProtectedOwnerRole } from './model.mjs'
import { OidcService } from './oidc-service.mjs'

function harness(claims = { iss: 'https://identity.example/application/o/inventory', sub: 'owner-subject', name: 'Owner', email: 'owner@example.com', email_verified: true }) {
  let state = createAuthenticationStore()
  state.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
  state.nextAccountId = 2
  ensureProtectedOwnerRole(state, 1)
  state.configuration.enabled = true
  state.configuration.oidcEnabled = true
  state.configuration.oidc.issuer = 'https://identity.example/application/o/inventory'
  state.configuration.oidc.clientId = 'homelab-inventory'
  state.configuration.oidc.externalUrl = 'https://inventory.example'
  state.configuration.oidc.clientSecretConfigured = true
  const store = {
    getAuthenticationState: () => structuredClone(state),
    updateAuthentication(mutator) {
      const draft = structuredClone(state)
      mutator(draft)
      assertAuthenticationStoreShape(draft)
      state = draft
    },
  }
  const authService = {
    async persist(mutator) { store.updateAuthentication(mutator) },
    recordEvent: vi.fn(async () => {}),
  }
  const client = {
    discovery: vi.fn(async () => ({ discovered: true })),
    randomPKCECodeVerifier: () => 'v'.repeat(48),
    calculatePKCECodeChallenge: async () => 'c'.repeat(48),
    randomState: () => 's'.repeat(32),
    randomNonce: () => 'n'.repeat(32),
    buildAuthorizationUrl: () => new URL('https://identity.example/authorize'),
    authorizationCodeGrant: vi.fn(async () => ({ claims: () => claims })),
  }
  const service = new OidcService({
    store,
    authService,
    runtime: { oidcClientSecret: 'secret' },
    client,
  })
  return { service, store, authService, client }
}

describe('OIDC authentication service', () => {
  it.each(['valid', 'wrong-state', 'wrong-nonce'])('validates %s callbacks with the real OIDC client and an in-memory provider', async (scenario) => {
    const { service, store } = harness()
    const issuer = 'https://identity.example/application/o/inventory'
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    let nonce
    let verifier
    const transport = vi.fn(async (input, options) => {
      const url = new URL(String(input))
      if (url.href === 'https://identity.example/.well-known/openid-configuration/application/o/inventory'
        || url.href === `${issuer}/.well-known/openid-configuration`) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
        })
      }
      if (url.href === `${issuer}/token`) {
        const body = new URLSearchParams(options.body)
        expect(body.get('code_verifier')).toBe(verifier)
        expect(body.get('redirect_uri')).toBe('https://inventory.example/api/auth/oidc/callback')
        expect(body.get('client_id')).toBe('homelab-inventory')
        const now = Math.floor(Date.now() / 1000)
        const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({
          iss: issuer, sub: 'owner-subject', aud: 'homelab-inventory',
          iat: now, exp: now + 300,
          nonce: scenario === 'wrong-nonce' ? 'invalid-nonce' : nonce,
          email: 'owner@example.com', email_verified: true,
        })).toString('base64url')
        const signature = sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
        return Response.json({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 300, id_token: `${header}.${payload}.${signature}` })
      }
      throw new Error('Unexpected OIDC test request')
    })
    service.client = {
      ...oidc,
      discovery: (server, clientId, metadata) => oidc.discovery(server, clientId, metadata, undefined, { [oidc.customFetch]: transport }),
    }

    const started = await service.start({ bindAccountId: 1 })
    const authorization = new URL(started.url)
    const transaction = store.getAuthenticationState().oidcTransactions[0]
    nonce = authorization.searchParams.get('nonce')
    verifier = transaction.codeVerifier
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('code_challenge')).toBe(await oidc.calculatePKCECodeChallenge(verifier))
    const callback = new URL('https://inventory.example/api/auth/oidc/callback?code=synthetic-code')
    callback.searchParams.set('state', scenario === 'wrong-state' ? 'invalid-state' : transaction.state)

    if (scenario === 'valid') {
      await expect(service.callback(callback.href, started.transactionToken)).resolves.toMatchObject({ accountId: 1, issuer, subject: 'owner-subject' })
      expect(store.getAuthenticationState().oidcIdentities).toHaveLength(1)
      await expect(service.callback(callback.href, started.transactionToken)).rejects.toThrow(/invalid or expired/)
    } else {
      await expect(service.callback(callback.href, started.transactionToken)).rejects.toThrow()
      expect(store.getAuthenticationState().oidcTransactions[0].usedAt).toBeNull()
      expect(store.getAuthenticationState().oidcIdentities).toHaveLength(0)
    }
    expect(transport).toHaveBeenCalledTimes(scenario === 'wrong-state' ? 1 : 2)
  })

  it('uses PKCE, stores an opaque transaction hash, and binds exact issuer/subject to the owner', async () => {
    const { service, store, authService } = harness()
    const started = await service.start({ returnTo: '/settings?section=authentication', bindAccountId: 1 })
    const transaction = store.getAuthenticationState().oidcTransactions[0]
    expect(transaction.tokenHash).not.toBe(started.transactionToken)
    expect(transaction.returnTo).toBe('/settings?section=authentication')
    const completed = await service.callback('https://inventory.example/api/auth/oidc/callback?code=one', started.transactionToken)
    expect(completed).toMatchObject({ accountId: 1, issuer: 'https://identity.example/application/o/inventory', subject: 'owner-subject' })
    expect(store.getAuthenticationState().oidcIdentities[0]).toMatchObject({ accountId: 1, subject: 'owner-subject' })
    expect(authService.recordEvent).toHaveBeenCalledWith('oidc-login-succeeded', expect.any(Object))
    await expect(service.callback('https://inventory.example/api/auth/oidc/callback?code=one', started.transactionToken)).rejects.toThrow(/invalid or expired/)
  })

  it('rejects a mismatched token issuer without consuming the local transaction', async () => {
    const { service, store } = harness({ iss: 'https://attacker.example', sub: 'owner-subject' })
    const started = await service.start({ bindAccountId: 1 })
    await expect(service.callback('https://inventory.example/api/auth/oidc/callback?code=one', started.transactionToken)).rejects.toThrow(/issuer does not match/)
    expect(store.getAuthenticationState().oidcTransactions[0].usedAt).toBeNull()
    expect(store.getAuthenticationState().oidcIdentities).toHaveLength(0)
  })

  it('sanitizes external return URLs to the application root', async () => {
    const { service, store } = harness()
    await service.start({ returnTo: '//attacker.example', bindAccountId: 1 })
    expect(store.getAuthenticationState().oidcTransactions[0].returnTo).toBe('/')
  })

  it('rejects an unknown OIDC identity unless it was invited or explicitly linked', async () => {
    const { service } = harness()
    const started = await service.start()
    await expect(service.callback('https://inventory.example/api/auth/oidc/callback?code=unknown', started.transactionToken)).rejects.toThrow(/not linked to an invited account/)
  })

  it('rejects an unlinked subject after the owner has bound an exact OIDC identity', async () => {
    const { service, store, client } = harness()
    const binding = await service.start({ bindAccountId: 1 })
    await service.callback('https://inventory.example/api/auth/oidc/callback?code=bind', binding.transactionToken)

    client.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        iss: 'https://identity.example/application/o/inventory',
        sub: 'different-subject',
        name: 'Different User',
        email: 'different@example.com',
        email_verified: true,
      }),
    })
    const login = await service.start()
    await expect(service.callback(
      'https://inventory.example/api/auth/oidc/callback?code=unknown',
      login.transactionToken,
    )).rejects.toThrow(/not linked to an invited account/)
    expect(store.getAuthenticationState().oidcIdentities).toHaveLength(1)
  })
})
