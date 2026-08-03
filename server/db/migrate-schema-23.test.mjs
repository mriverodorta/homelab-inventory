import { describe, expect, it } from 'vitest'
import { createAuthenticationStore } from '../auth/model.mjs'
import { migrateSchema22To23 } from './migrate-schema-23.mjs'

function legacyStore() {
  const store = createAuthenticationStore()
  store.version = 1
  for (const key of ['nextRoleId', 'nextRolePermissionId', 'nextAccountRoleId', 'nextInvitationId', 'nextIdentityLinkRequestId']) delete store[key]
  for (const key of ['roles', 'rolePermissions', 'accountRoles', 'invitations', 'identityLinkRequests']) delete store[key]
  store.nextAccountId = 2
  store.accounts = [{ id: 1, username: 'owner', displayName: 'Owner', role: 'owner', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
  return store
}

describe('schema 23 authorization migration', () => {
  it('preserves the owner and assigns the built-in Owner role', () => {
    const migrated = migrateSchema22To23(legacyStore(), { now: '2026-08-02T00:00:00.000Z' })
    expect(migrated.authentication.version).toBe(2)
    expect(migrated.authentication.accounts[0]).toMatchObject({ id: 1, protectedOwner: true })
    expect(migrated.authentication.accountRoles).toContainEqual(expect.objectContaining({ accountId: 1, roleId: 1, scopeKind: 'global', scopeId: 0 }))
    expect(migrated.authentication.roles.map((role) => role.key)).toEqual(['owner', 'administrator', 'editor', 'viewer'])
  })

  it('is idempotent once schema 23 data exists', () => {
    const first = migrateSchema22To23(legacyStore(), { now: '2026-08-02T00:00:00.000Z' })
    const second = migrateSchema22To23(first.authentication, { now: '2026-08-03T00:00:00.000Z' })
    expect(second.authentication).toEqual(first.authentication)
    expect(second.summary.migratedAuthentication).toBe(false)
  })
})
