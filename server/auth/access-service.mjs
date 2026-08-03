import { assertAuthenticationStoreShape } from './model.mjs'
import {
  PERMISSIONS,
  PERMISSION_BY_ID,
  PERMISSION_BY_KEY,
  REQUIRED_WORKSPACE_PERMISSION_IDS,
} from './permission-catalog.mjs'

function positiveId(value, label) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} is invalid.`)
  return id
}

function cleanText(value, label, maxLength) {
  const text = String(value ?? '').normalize('NFKC').trim()
  if (!text || text.length > maxLength) throw new Error(`${label} must contain 1-${maxLength} characters.`)
  return text
}

function cleanRoleKey(value) {
  const key = String(value ?? '').normalize('NFKC').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(key)) throw new Error('Role key is invalid.')
  return key
}

function normalizedPermissionIds(values) {
  if (!Array.isArray(values)) throw new Error('Permission IDs must be an array.')
  const ids = [...new Set([
    ...REQUIRED_WORKSPACE_PERMISSION_IDS,
    ...values.map((value) => positiveId(value, 'Permission ID')),
  ])]
  for (const id of ids) if (!PERMISSION_BY_ID.has(id)) throw new Error(`Permission ${id} is unknown.`)
  return ids.sort((left, right) => left - right)
}

function normalizedRoleIds(state, values) {
  if (!Array.isArray(values)) throw new Error('Role IDs must be an array.')
  const ids = [...new Set(values.map((value) => positiveId(value, 'Role ID')))]
  for (const id of ids) {
    const role = state.roles.find((candidate) => candidate.id === id && candidate.active)
    if (!role) throw new Error(`Role ${id} is unavailable.`)
  }
  return ids.sort((left, right) => left - right)
}

function permissionIdsForActor(authorization, actorId) {
  const keys = authorization.permissionsForSync(actorId)
  return new Set(keys.map((key) => {
    const permission = PERMISSION_BY_KEY.get(key)
    if (!permission) throw new Error(`Permission ${key} is unknown.`)
    return permission.id
  }))
}

function appendEvent(draft, actorId, type, detail, timestamp) {
  draft.securityEvents.push({
    id: draft.nextSecurityEventId++,
    accountId: actorId,
    type,
    detail: detail == null ? null : String(detail).slice(0, 255),
    ip: null,
    userAgent: null,
    createdAt: timestamp,
  })
  if (draft.securityEvents.length > 500) draft.securityEvents.splice(0, draft.securityEvents.length - 500)
}

function publicRole(state, role) {
  const permissionIds = state.rolePermissions
    .filter((relation) => relation.roleId === role.id)
    .map((relation) => relation.permissionId)
    .sort((left, right) => left - right)
  return { ...structuredClone(role), permissionIds, empty: permissionIds.length === 0 }
}

function publicUser(state, account) {
  const roleIds = state.accountRoles
    .filter((assignment) => assignment.accountId === account.id && assignment.scopeKind === 'global' && assignment.scopeId === 0)
    .map((assignment) => assignment.roleId)
  return {
    id: account.id,
    username: account.username,
    email: account.email ?? null,
    displayName: account.displayName,
    protectedOwner: account.protectedOwner === true,
    active: account.active,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    roleIds,
    identityMethods: {
      local: state.localCredentials.some((credential) => credential.accountId === account.id),
      oidc: state.oidcIdentities.some((identity) => identity.accountId === account.id),
    },
  }
}

export class AccessService {
  constructor({ store, authorization, sessions, now = () => new Date() }) {
    this.store = store
    this.authorization = authorization
    this.sessions = sessions
    this.now = now
    this.mutationQueue = Promise.resolve()
  }

  state() {
    return this.store.getAuthenticationState()
  }

  async mutate(actorId, eventType, detail, mutator) {
    const pending = this.mutationQueue.then(() => this.performMutation(actorId, eventType, detail, mutator))
    this.mutationQueue = pending.catch(() => {})
    return pending
  }

  async performMutation(actorId, eventType, detail, mutator) {
    const previous = this.state()
    const timestamp = this.now().toISOString()
    let result
    const next = structuredClone(previous)
    result = mutator(next, timestamp)
    appendEvent(next, actorId, eventType, detail, timestamp)
    assertAuthenticationStoreShape(next)
    try {
      await this.authorization.rebuild(next)
      this.store.updateAuthentication((draft) => {
        for (const key of Object.keys(draft)) delete draft[key]
        Object.assign(draft, structuredClone(next))
      })
      await this.store.flush(['authentication'])
      return result
    } catch (error) {
      await this.authorization.rebuild(previous).catch(() => {})
      this.store.updateAuthentication((draft) => {
        for (const key of Object.keys(draft)) delete draft[key]
        Object.assign(draft, structuredClone(previous))
      })
      await this.store.flush(['authentication']).catch(() => {})
      throw error
    }
  }

  listUsers() {
    const state = this.state()
    return state.accounts.map((account) => publicUser(state, account))
  }

  listRoles() {
    const state = this.state()
    return state.roles.map((role) => publicRole(state, role))
  }

  listPermissions() {
    const required = new Set(REQUIRED_WORKSPACE_PERMISSION_IDS)
    return PERMISSIONS.map((permission) => ({
      ...permission,
      requiredForWorkspace: required.has(permission.id),
    }))
  }

  assertDelegatedPermissionIds(actorId, permissionIds) {
    const allowed = permissionIdsForActor(this.authorization, actorId)
    const denied = permissionIds.filter((permissionId) => !allowed.has(permissionId))
    if (denied.length > 0) throw new Error('You cannot grant permissions that you do not have.')
  }

  assertAssignableRoleIds(actorId, state, roleIdInputs) {
    const roleIds = normalizedRoleIds(state, roleIdInputs)
    const roles = roleIds.map((roleId) => state.roles.find((role) => role.id === roleId))
    if (roles.some((role) => role.key === 'owner')) throw new Error('The Owner role cannot be assigned.')
    const permissionIds = state.rolePermissions
      .filter((relation) => roleIds.includes(relation.roleId))
      .map((relation) => relation.permissionId)
    this.assertDelegatedPermissionIds(actorId, permissionIds)
    return roleIds
  }

  async updateUser(actorId, accountIdInput, input) {
    const accountId = positiveId(accountIdInput, 'Account ID')
    return this.mutate(actorId, 'user-updated', accountId, (draft, timestamp) => {
      const account = draft.accounts.find((candidate) => candidate.id === accountId)
      if (!account) throw new Error('User was not found.')
      if (account.protectedOwner) throw new Error('The protected owner cannot be modified from Access administration.')
      if (input.displayName !== undefined) account.displayName = cleanText(input.displayName, 'Display name', 100)
      if (input.active !== undefined) account.active = input.active === true
      account.updatedAt = timestamp
      if (!account.active) {
        for (const session of draft.sessions) {
          if (session.accountId === accountId && !session.revokedAt) session.revokedAt = timestamp
        }
      }
      return publicUser(draft, account)
    })
  }

  async deleteUser(actorId, accountIdInput) {
    const accountId = positiveId(accountIdInput, 'Account ID')
    return this.mutate(actorId, 'user-deleted', accountId, (draft) => {
      const account = draft.accounts.find((candidate) => candidate.id === accountId)
      if (!account) throw new Error('User was not found.')
      if (account.protectedOwner) throw new Error('The protected owner cannot be deleted.')
      for (const name of ['localCredentials', 'oidcIdentities', 'sessions', 'recoveryTokens', 'oidcTransactions']) {
        draft[name] = draft[name].filter((record) => record.accountId !== accountId)
      }
      draft.accountRoles = draft.accountRoles.filter((assignment) => assignment.accountId !== accountId)
      draft.invitations = draft.invitations.map((invitation) => invitation.accountId === accountId ? { ...invitation, accountId: null } : invitation)
      draft.identityLinkRequests = draft.identityLinkRequests.filter((request) => request.accountId !== accountId)
      draft.accounts = draft.accounts.filter((candidate) => candidate.id !== accountId)
      return { id: accountId }
    })
  }

  async assignRoles(actorId, accountIdInput, roleIdInputs) {
    const accountId = positiveId(accountIdInput, 'Account ID')
    return this.mutate(actorId, 'user-roles-updated', accountId, (draft) => {
      const account = draft.accounts.find((candidate) => candidate.id === accountId)
      if (!account) throw new Error('User was not found.')
      if (account.protectedOwner) throw new Error('The protected owner roles cannot be changed.')
      const roleIds = this.assertAssignableRoleIds(actorId, draft, roleIdInputs)
      draft.accountRoles = draft.accountRoles.filter((assignment) => accountId !== assignment.accountId)
      for (const roleId of roleIds) {
        draft.accountRoles.push({ id: draft.nextAccountRoleId++, accountId, roleId, scopeKind: 'global', scopeId: 0 })
      }
      return publicUser(draft, account)
    })
  }

  async revokeUserSessions(actorId, accountIdInput) {
    const accountId = positiveId(accountIdInput, 'Account ID')
    return this.mutate(actorId, 'user-sessions-revoked', accountId, (draft, timestamp) => {
      const account = draft.accounts.find((candidate) => candidate.id === accountId)
      if (!account) throw new Error('User was not found.')
      if (account.protectedOwner) throw new Error('The protected owner sessions cannot be revoked from Access administration.')
      for (const session of draft.sessions) if (session.accountId === accountId && !session.revokedAt) session.revokedAt = timestamp
      return { id: accountId }
    })
  }

  async createRole(actorId, input) {
    return this.mutate(actorId, 'role-created', input?.name, (draft, timestamp) => {
      const key = cleanRoleKey(input?.key ?? input?.name)
      if (draft.roles.some((role) => role.key === key)) throw new Error('Role key already exists.')
      const role = {
        id: draft.nextRoleId++, key,
        name: cleanText(input?.name, 'Role name', 80),
        description: String(input?.description ?? '').normalize('NFKC').trim().slice(0, 255),
        builtIn: false, active: true, createdAt: timestamp, updatedAt: timestamp,
      }
      draft.roles.push(role)
      const permissionIds = normalizedPermissionIds(input?.permissionIds ?? [])
      this.assertDelegatedPermissionIds(actorId, permissionIds)
      this.replaceRolePermissions(draft, role.id, permissionIds)
      return publicRole(draft, role)
    })
  }

  async duplicateRole(actorId, roleIdInput, input) {
    const roleId = positiveId(roleIdInput, 'Role ID')
    const state = this.state()
    const source = state.roles.find((role) => role.id === roleId)
    if (!source) throw new Error('Role was not found.')
    return this.createRole(actorId, {
      name: input?.name ?? `${source.name} copy`,
      key: input?.key,
      description: input?.description ?? source.description,
      permissionIds: state.rolePermissions.filter((relation) => relation.roleId === roleId).map((relation) => relation.permissionId),
    })
  }

  async updateRole(actorId, roleIdInput, input) {
    const roleId = positiveId(roleIdInput, 'Role ID')
    return this.mutate(actorId, 'role-updated', roleId, (draft, timestamp) => {
      const role = draft.roles.find((candidate) => candidate.id === roleId)
      if (!role) throw new Error('Role was not found.')
      if (role.builtIn) throw new Error('Built-in roles cannot be modified.')
      if (input.name !== undefined) role.name = cleanText(input.name, 'Role name', 80)
      if (input.description !== undefined) role.description = String(input.description ?? '').normalize('NFKC').trim().slice(0, 255)
      if (input.active !== undefined) role.active = input.active === true
      role.updatedAt = timestamp
      return publicRole(draft, role)
    })
  }

  replaceRolePermissions(draft, roleId, values) {
    const permissionIds = normalizedPermissionIds(values)
    draft.rolePermissions = draft.rolePermissions.filter((relation) => relation.roleId !== roleId)
    for (const permissionId of permissionIds) {
      draft.rolePermissions.push({ id: draft.nextRolePermissionId++, roleId, permissionId })
    }
  }

  async setRolePermissions(actorId, roleIdInput, values) {
    const roleId = positiveId(roleIdInput, 'Role ID')
    return this.mutate(actorId, 'role-permissions-updated', roleId, (draft, timestamp) => {
      const role = draft.roles.find((candidate) => candidate.id === roleId)
      if (!role) throw new Error('Role was not found.')
      if (role.builtIn) throw new Error('Built-in role permissions cannot be modified.')
      const permissionIds = normalizedPermissionIds(values)
      this.assertDelegatedPermissionIds(actorId, permissionIds)
      this.replaceRolePermissions(draft, roleId, permissionIds)
      role.updatedAt = timestamp
      return publicRole(draft, role)
    })
  }

  async deleteRole(actorId, roleIdInput) {
    const roleId = positiveId(roleIdInput, 'Role ID')
    return this.mutate(actorId, 'role-deleted', roleId, (draft) => {
      const role = draft.roles.find((candidate) => candidate.id === roleId)
      if (!role) throw new Error('Role was not found.')
      if (role.builtIn) throw new Error('Built-in roles cannot be deleted.')
      if (draft.accountRoles.some((assignment) => assignment.roleId === roleId)) throw new Error('Assigned roles cannot be deleted.')
      if (draft.invitations.some((invitation) => invitation.status === 'pending' && invitation.roleIds.includes(roleId))) throw new Error('Roles used by pending invitations cannot be deleted.')
      draft.rolePermissions = draft.rolePermissions.filter((relation) => relation.roleId !== roleId)
      draft.roles = draft.roles.filter((candidate) => candidate.id !== roleId)
      return { id: roleId }
    })
  }
}
