import { describe, expect, it, vi } from 'vitest'
import { assertAuthenticationStoreShape, createAuthenticationStore, createOwnerAccount } from './model.mjs'
import { OidcService } from './oidc-service.mjs'

function harness(claims = { iss: 'https://identity.example/application/o/inventory', sub: 'owner-subject', name: 'Owner' }) {
  let state = createAuthenticationStore()
  state.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
  state.nextAccountId = 2
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

  it('requires a local owner session before the first OIDC identity binding', async () => {
    const { service } = harness()
    await expect(service.start()).rejects.toThrow(/Sign in locally and link/)
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
      }),
    })
    const login = await service.start()
    await expect(service.callback(
      'https://inventory.example/api/auth/oidc/callback?code=unknown',
      login.transactionToken,
    )).rejects.toThrow(/not linked to the owner account/)
    expect(store.getAuthenticationState().oidcIdentities).toHaveLength(1)
  })
})
