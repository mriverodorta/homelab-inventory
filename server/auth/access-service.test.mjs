import { describe, expect, it, vi } from 'vitest'
import { AccessService } from './access-service.mjs'
import { assertAuthenticationStoreShape, createAuthenticationStore, createOwnerAccount, ensureProtectedOwnerRole } from './model.mjs'
import { PERMISSIONS } from './permission-catalog.mjs'

function fixture() {
  const state = createAuthenticationStore()
  state.accounts.push(createOwnerAccount(1, 'owner', 'Owner'), {
    id: 2, username: 'operator', email: 'operator@example.com', displayName: 'Operator', protectedOwner: false,
    active: true, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
  })
  state.nextAccountId = 3
  ensureProtectedOwnerRole(state, 1)
  state.accountRoles.push({ id: state.nextAccountRoleId++, accountId: 2, roleId: 4, scopeKind: 'global', scopeId: 0 })
  return state
}

function harness({ rebuild = vi.fn().mockResolvedValue(undefined), actorPermissions = new Map() } = {}) {
  let state = fixture()
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
  const sessions = { revokeAllForAccount: vi.fn() }
  const authorization = {
    rebuild,
    permissionsForSync: (accountId) => accountId === 1
      ? PERMISSIONS.map((permission) => permission.key)
      : (actorPermissions.get(accountId) ?? []),
  }
  return { service: new AccessService({ store, authorization, sessions, now: () => new Date('2026-08-02T01:00:00.000Z') }), store, rebuild, sessions }
}

describe('AccessService', () => {
  it('creates a custom role and combines multiple role assignments', async () => {
    const { service } = harness()
    const role = await service.createRole(1, { name: 'Network operator', permissionIds: [301, 303] })
    expect(role).toMatchObject({ key: 'network-operator', permissionIds: [101, 201, 301, 303, 401, 1001] })
    const user = await service.assignRoles(1, 2, [4, role.id])
    expect(user.roleIds).toEqual([4, role.id])
  })

  it('always includes the read permissions required to boot the workspace', async () => {
    const { service } = harness()
    const role = await service.createRole(1, { name: 'Backup operator', permissionIds: [601, 602] })
    expect(role.permissionIds).toEqual([101, 201, 301, 401, 601, 602, 1001])

    const updated = await service.setRolePermissions(1, role.id, [604])
    expect(updated.permissionIds).toEqual([101, 201, 301, 401, 604, 1001])
    expect(service.listPermissions().filter((permission) => permission.requiredForWorkspace).map((permission) => permission.id))
      .toEqual([101, 201, 301, 401, 1001])
  })

  it('protects the original owner and assigned roles', async () => {
    const { service } = harness()
    await expect(service.updateUser(1, 1, { active: false })).rejects.toThrow(/protected owner/)
    await expect(service.assignRoles(1, 1, [4])).rejects.toThrow(/protected owner/)
    await expect(service.revokeUserSessions(1, 1)).rejects.toThrow(/protected owner sessions/)
    const role = await service.createRole(1, { name: 'Assigned role', permissionIds: [] })
    await service.assignRoles(1, 2, [role.id])
    await expect(service.deleteRole(1, role.id)).rejects.toThrow(/Assigned roles/)
  })

  it('never delegates the protected Owner role', async () => {
    const { service } = harness()
    await expect(service.assignRoles(1, 2, [1])).rejects.toThrow(/Owner role cannot be assigned/)
  })

  it('prevents managers from granting permissions they do not have', async () => {
    const manageable = ['workspace.view', 'inventory.view', 'canvas.view', 'project.view', 'authentication.view', 'users.manage', 'roles.manage']
    const { service } = harness({ actorPermissions: new Map([[2, manageable]]) })
    await expect(service.createRole(2, { name: 'Backup restorer', permissionIds: [606] })).rejects.toThrow(/cannot grant permissions/)
    await expect(service.assignRoles(2, 2, [2])).rejects.toThrow(/cannot grant permissions/)

    const role = await service.createRole(2, { name: 'User manager', permissionIds: [902] })
    expect(role.permissionIds).toEqual([101, 201, 301, 401, 902, 1001])
  })

  it('rolls state and authorization back when policy rebuild fails', async () => {
    const rebuild = vi.fn()
      .mockRejectedValueOnce(new Error('policy compile failed'))
      .mockResolvedValueOnce(undefined)
    const { service, store } = harness({ rebuild })
    const before = store.getAuthenticationState()
    await expect(service.createRole(1, { name: 'Broken role', permissionIds: [301] })).rejects.toThrow(/policy compile failed/)
    expect(store.getAuthenticationState()).toEqual(before)
  })

  it('serializes concurrent mutations without losing either update', async () => {
    let releaseFirstRebuild
    let markFirstRebuildStarted
    const firstRebuildStarted = new Promise((resolve) => { markFirstRebuildStarted = resolve })
    const firstRebuildReleased = new Promise((resolve) => { releaseFirstRebuild = resolve })
    let rebuildCount = 0
    const rebuild = vi.fn(async () => {
      rebuildCount += 1
      if (rebuildCount === 1) {
        markFirstRebuildStarted()
        await firstRebuildReleased
      }
    })
    const { service } = harness({ rebuild })

    const first = service.createRole(1, { name: 'First concurrent role', permissionIds: [301] })
    await firstRebuildStarted
    const second = service.createRole(1, { name: 'Second concurrent role', permissionIds: [303] })
    releaseFirstRebuild()

    const [firstRole, secondRole] = await Promise.all([first, second])
    expect(secondRole.id).toBe(firstRole.id + 1)
    expect(service.listRoles().filter((role) => role.id >= firstRole.id).map((role) => role.name))
      .toEqual(['First concurrent role', 'Second concurrent role'])
  })

  it('disables users and revokes their sessions atomically', async () => {
    const { service, store, sessions } = harness()
    store.updateAuthentication((draft) => {
      draft.sessions.push({
        id: draft.nextSessionId++, accountId: 2, tokenHash: 'a'.repeat(64), remember: false,
        createdAt: '2026-08-02T00:00:00.000Z', lastSeenAt: '2026-08-02T00:00:00.000Z',
        idleExpiresAt: '2026-08-03T00:00:00.000Z', absoluteExpiresAt: '2026-09-01T00:00:00.000Z',
        userAgent: null, ip: null, revokedAt: null,
      })
    })
    await service.updateUser(1, 2, { active: false })
    expect(store.getAuthenticationState().sessions[0].revokedAt).toBe('2026-08-02T01:00:00.000Z')
    expect(sessions.revokeAllForAccount).not.toHaveBeenCalled()
  })
})
