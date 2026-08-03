import { describe, expect, it, vi } from 'vitest'
import { AccessService } from './access-service.mjs'
import { InvitationService } from './invitation-service.mjs'
import { assertAuthenticationStoreShape, createAuthenticationStore, createOwnerAccount, ensureProtectedOwnerRole } from './model.mjs'
import { PERMISSIONS } from './permission-catalog.mjs'

vi.stubGlobal('Bun', {
  password: {
    hash: vi.fn().mockResolvedValue('$argon2id$test-password-hash-with-enough-characters'),
  },
})

function harness({ permissionsForSync = () => PERMISSIONS.map((permission) => permission.key) } = {}) {
  let state = createAuthenticationStore()
  state.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
  state.nextAccountId = 2
  ensureProtectedOwnerRole(state, 1)
  const store = {
    getAuthenticationState: () => structuredClone(state),
    updateAuthentication(mutator) {
      const draft = structuredClone(state)
      mutator(draft)
      assertAuthenticationStoreShape(draft)
      state = draft
    },
    flush: vi.fn().mockResolvedValue(undefined),
  }
  const authorization = {
    rebuild: vi.fn().mockResolvedValue(undefined),
    permissionsForSync,
  }
  const sessions = { create: vi.fn().mockReturnValue({ token: 'session', session: { id: 1, accountId: 2 } }) }
  const access = new AccessService({ store, authorization, sessions, now: () => new Date('2026-08-02T12:00:00.000Z') })
  return { service: new InvitationService({ accessService: access, sessionService: sessions, now: () => new Date('2026-08-02T12:00:00.000Z') }), store, sessions }
}

function managerHarness() {
  const result = harness({
    permissionsForSync: (accountId) => accountId === 1
      ? PERMISSIONS.map((permission) => permission.key)
      : ['workspace.view', 'inventory.view', 'canvas.view', 'project.view', 'authentication.view'],
  })
  result.store.updateAuthentication((draft) => {
    draft.accounts.push({
      id: 2, username: 'manager', email: 'manager@example.com', displayName: 'Manager', protectedOwner: false,
      active: true, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    })
    draft.nextAccountId = 3
    draft.accountRoles.push({ id: draft.nextAccountRoleId++, accountId: 2, roleId: 2, scopeKind: 'global', scopeId: 0 })
  })
  return result
}

describe('InvitationService', () => {
  it('persists only a token hash and activates a local account with numeric role relationships', async () => {
    const { service, store } = harness()
    const created = await service.create(1, { email: 'USER@Example.COM', identityType: 'local', roleIds: [4] })
    expect(created.token).toBeTruthy()
    expect(JSON.stringify(store.getAuthenticationState())).not.toContain(created.token)
    const result = await service.activateLocal(created.token, { username: 'new.user', displayName: 'New User', password: 'correct horse battery staple' })
    expect(result.token).toBe('session')
    const state = store.getAuthenticationState()
    expect(state.accounts[1]).toMatchObject({ email: 'user@example.com', username: 'new.user', protectedOwner: false })
    expect(state.accountRoles).toContainEqual(expect.objectContaining({ accountId: 2, roleId: 4, scopeKind: 'global', scopeId: 0 }))
    expect(state.invitations[0]).toMatchObject({ status: 'accepted', accountId: 2 })
  })

  it('rejects duplicate pending emails and wrong activation methods', async () => {
    const { service } = harness()
    const created = await service.create(1, { email: 'user@example.com', identityType: 'oidc', roleIds: [4] })
    await expect(service.create(1, { email: 'USER@example.com', identityType: 'local', roleIds: [4] })).rejects.toThrow(/pending invitation/)
    await expect(service.activateLocal(created.token, { displayName: 'No', password: 'correct horse battery staple' })).rejects.toThrow(/requires OIDC/)
  })

  it('does not allow invitations to receive the protected Owner role', async () => {
    const { service } = harness()
    await expect(service.create(1, { email: 'owner-role@example.com', identityType: 'local', roleIds: [1] }))
      .rejects.toThrow(/Owner role cannot be assigned/)
  })

  it('revalidates delegated roles when an invitation is resent', async () => {
    const { service, store } = managerHarness()
    const created = await service.create(1, { email: 'operator@example.com', identityType: 'local', roleIds: [2] })
    store.updateAuthentication((draft) => {
      draft.accountRoles = draft.accountRoles.filter((assignment) => assignment.accountId !== 2)
      draft.accountRoles.push({ id: draft.nextAccountRoleId++, accountId: 2, roleId: 4, scopeKind: 'global', scopeId: 0 })
    })

    await expect(service.resend(2, created.invitation.id)).rejects.toThrow(/cannot grant permissions/)
  })
})
