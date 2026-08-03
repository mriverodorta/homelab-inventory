import { describe, expect, it } from 'vitest'
import {
  assertAuthenticationStoreShape,
  createAuthenticationStore,
  createOwnerAccount,
  deriveAuthenticationMode,
  ensureProtectedOwnerRole,
  publicAuthenticationStatus,
} from './model.mjs'

describe('authentication store model', () => {
  it('creates a disabled upgrade-safe store', () => {
    const store = createAuthenticationStore()
    expect(deriveAuthenticationMode(store)).toBe('disabled')
    expect(store.bootstrapState.setupRequired).toBe(false)
    expect(() => assertAuthenticationStoreShape(store)).not.toThrow()
  })

  it('derives local, oidc, and hybrid modes', () => {
    const store = createAuthenticationStore()
    store.configuration.enabled = true
    store.configuration.localEnabled = true
    expect(deriveAuthenticationMode(store)).toBe('local')
    store.configuration.localEnabled = false
    store.configuration.oidcEnabled = true
    expect(deriveAuthenticationMode(store)).toBe('oidc')
    store.configuration.localEnabled = true
    expect(deriveAuthenticationMode(store)).toBe('hybrid')
  })

  it('validates numeric relationships and unique identities', () => {
    const store = createAuthenticationStore()
    store.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
    store.nextAccountId = 2
    ensureProtectedOwnerRole(store, 1)
    store.localCredentials.push({ id: 1, accountId: 1, passwordHash: 'x'.repeat(32), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    store.nextLocalCredentialId = 2
    expect(() => assertAuthenticationStoreShape(store)).not.toThrow()
    store.localCredentials[0].accountId = 99
    expect(() => assertAuthenticationStoreShape(store)).toThrow(/missing account/)
  })

  it('never exposes credential or token records in public status', () => {
    const store = createAuthenticationStore()
    store.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
    store.nextAccountId = 2
    store.localCredentials.push({ id: 1, accountId: 1, passwordHash: 'secret-hash-value'.repeat(2), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    store.nextLocalCredentialId = 2
    const status = publicAuthenticationStatus(store, { authenticatedAccountId: 1 })
    expect(status.account).toEqual({ id: 1, username: 'owner', email: null, displayName: 'Owner', protectedOwner: true })
    expect(JSON.stringify(status)).not.toContain('secret-hash')
  })

  it('allows localhost OIDC development but rejects insecure remote issuers', () => {
    const store = createAuthenticationStore()
    store.configuration.oidc.issuer = 'http://localhost:9000/application/o/inventory'
    store.configuration.oidc.externalUrl = 'http://127.0.0.1:8798'
    expect(() => assertAuthenticationStoreShape(store)).not.toThrow()
    store.configuration.oidc.issuer = 'http://identity.example'
    expect(() => assertAuthenticationStoreShape(store)).toThrow(/must use HTTPS/)
  })

  it('enforces the single-owner model', () => {
    const store = createAuthenticationStore()
    store.accounts.push(createOwnerAccount(1, 'first-owner', 'First'), createOwnerAccount(2, 'second-owner', 'Second'))
    store.nextAccountId = 3
    expect(() => assertAuthenticationStoreShape(store)).toThrow(/one protected owner/)
  })
})
