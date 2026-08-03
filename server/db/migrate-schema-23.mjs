import { createBuiltInAuthorizationRecords } from '../auth/permission-catalog.mjs'
import { createAuthenticationStore, ensureProtectedOwnerRole, normalizeAuthenticationStore } from '../auth/model.mjs'

function normalizedEmail(value) {
  const email = String(value ?? '').normalize('NFKC').trim().toLowerCase()
  return email || null
}

export function migrateSchema22To23(currentInput, { now = new Date().toISOString() } = {}) {
  if (currentInput?.version === 2) {
    return {
      authentication: structuredClone(currentInput),
      summary: { migratedAuthentication: false, accounts: currentInput.accounts?.length ?? 0 },
    }
  }

  const current = currentInput ?? createAuthenticationStore({ setupRequired: false })
  const builtIns = createBuiltInAuthorizationRecords(now)
  const authentication = normalizeAuthenticationStore({
    ...structuredClone(current),
    version: 2,
    nextRoleId: builtIns.nextRoleId,
    nextRolePermissionId: builtIns.nextRolePermissionId,
    nextAccountRoleId: 1,
    nextInvitationId: 1,
    nextIdentityLinkRequestId: 1,
    roles: builtIns.roles,
    rolePermissions: builtIns.rolePermissions,
    accountRoles: [],
    invitations: [],
    identityLinkRequests: [],
  })

  authentication.accounts = authentication.accounts.map((account, index) => {
    const identity = authentication.oidcIdentities.find((candidate) => candidate.accountId === account.id)
    const migrated = {
      id: account.id,
      username: account.username,
      email: normalizedEmail(account.email ?? identity?.email),
      displayName: account.displayName,
      protectedOwner: index === 0 || account.role === 'owner',
      active: account.active !== false,
      createdAt: account.createdAt ?? now,
      updatedAt: account.updatedAt ?? now,
    }
    return migrated
  })

  const owner = authentication.accounts.find((account) => account.protectedOwner)
  if (owner) ensureProtectedOwnerRole(authentication, owner.id)

  return {
    authentication,
    summary: {
      migratedAuthentication: true,
      accounts: authentication.accounts.length,
      protectedOwnerId: owner?.id ?? null,
      builtInRoles: builtIns.roles.length,
    },
  }
}
