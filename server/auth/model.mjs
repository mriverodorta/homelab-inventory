import { BUILT_IN_ROLE_DEFINITIONS, PERMISSION_BY_ID, createBuiltInAuthorizationRecords } from './permission-catalog.mjs'

const AUTH_STORE_VERSION = 2

function nowIso() {
  return new Date().toISOString()
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function assertPositiveId(value, path) {
  if (!isPositiveSafeInteger(value)) throw new Error(`${path} must be a positive safe integer.`)
}

function assertOptionalDate(value, path) {
  if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) {
    throw new Error(`${path} must be null or an ISO timestamp.`)
  }
}

function assertDate(value, path) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${path} must be an ISO timestamp.`)
}

function assertHttpsOrLocalUrl(value, path) {
  if (value === null) return
  let url
  try { url = new URL(value) } catch { throw new Error(`${path} must be a valid URL.`) }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) {
    throw new Error(`${path} must use HTTPS.`)
  }
}

function assertTokenHash(value, path) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${path} is invalid.`)
}

function assertUniqueIds(records, path) {
  const ids = records.map((record, index) => {
    assertPositiveId(record?.id, `${path}[${index}].id`)
    return record.id
  })
  if (new Set(ids).size !== ids.length) throw new Error(`${path} IDs must be unique.`)
}

function assertNextId(nextId, records, path) {
  assertPositiveId(nextId, path)
  if (records.some((record) => record.id >= nextId)) throw new Error(`${path} must exceed every persisted ID.`)
}

export function createAuthenticationStore({ setupRequired = false } = {}) {
  const builtIns = createBuiltInAuthorizationRecords()
  return {
    version: AUTH_STORE_VERSION,
    nextAccountId: 1,
    nextLocalCredentialId: 1,
    nextOidcIdentityId: 1,
    nextSessionId: 1,
    nextRecoveryTokenId: 1,
    nextSecurityEventId: 1,
    nextOidcTransactionId: 1,
    nextRoleId: builtIns.nextRoleId,
    nextRolePermissionId: builtIns.nextRolePermissionId,
    nextAccountRoleId: 1,
    nextInvitationId: 1,
    nextIdentityLinkRequestId: 1,
    accounts: [],
    localCredentials: [],
    oidcIdentities: [],
    sessions: [],
    recoveryTokens: [],
    securityEvents: [],
    oidcTransactions: [],
    roles: builtIns.roles,
    rolePermissions: builtIns.rolePermissions,
    accountRoles: [],
    invitations: [],
    identityLinkRequests: [],
    configuration: {
      enabled: false,
      localEnabled: false,
      oidcEnabled: false,
      oidc: {
        issuer: null,
        clientId: null,
        scopes: ['openid', 'profile', 'email'],
        externalUrl: null,
        clientSecretConfigured: false,
      },
      updatedAt: null,
    },
    bootstrapState: {
      setupRequired: setupRequired === true,
      completedAt: null,
    },
  }
}

export function deriveAuthenticationMode(store) {
  if (store?.configuration?.enabled !== true) return 'disabled'
  const local = store.configuration.localEnabled === true
  const oidc = store.configuration.oidcEnabled === true
  if (local && oidc) return 'hybrid'
  if (local) return 'local'
  if (oidc) return 'oidc'
  return 'disabled'
}

export function publicAuthenticationStatus(store, { authenticatedAccountId = null } = {}) {
  const mode = deriveAuthenticationMode(store)
  const account = authenticatedAccountId == null
    ? null
    : store.accounts.find((candidate) => candidate.id === authenticatedAccountId) ?? null
  return {
    mode,
    setupRequired: store.bootstrapState.setupRequired === true,
    authenticated: account !== null,
    account: account ? {
      id: account.id,
      username: account.username,
      email: account.email ?? null,
      displayName: account.displayName,
      protectedOwner: account.protectedOwner === true,
    } : null,
    methods: {
      local: store.configuration.localEnabled === true,
      oidc: store.configuration.oidcEnabled === true,
    },
    oidc: {
      issuer: store.configuration.oidc.issuer,
      clientId: store.configuration.oidc.clientId,
      scopes: [...store.configuration.oidc.scopes],
      externalUrl: store.configuration.oidc.externalUrl,
      clientSecretConfigured: store.configuration.oidc.clientSecretConfigured === true,
    },
  }
}

export function normalizeAuthenticationStore(value, options = {}) {
  const defaults = createAuthenticationStore(options)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  return {
    ...defaults,
    ...structuredClone(value),
    accounts: Array.isArray(value.accounts) ? value.accounts : [],
    localCredentials: Array.isArray(value.localCredentials) ? value.localCredentials : [],
    oidcIdentities: Array.isArray(value.oidcIdentities) ? value.oidcIdentities : [],
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
    recoveryTokens: Array.isArray(value.recoveryTokens) ? value.recoveryTokens : [],
    securityEvents: Array.isArray(value.securityEvents) ? value.securityEvents : [],
    oidcTransactions: Array.isArray(value.oidcTransactions) ? value.oidcTransactions : [],
    roles: Array.isArray(value.roles) ? value.roles : defaults.roles,
    rolePermissions: Array.isArray(value.rolePermissions) ? value.rolePermissions : defaults.rolePermissions,
    accountRoles: Array.isArray(value.accountRoles) ? value.accountRoles : [],
    invitations: Array.isArray(value.invitations) ? value.invitations : [],
    identityLinkRequests: Array.isArray(value.identityLinkRequests) ? value.identityLinkRequests : [],
    configuration: {
      ...defaults.configuration,
      ...(value.configuration ?? {}),
      oidc: {
        ...defaults.configuration.oidc,
        ...(value.configuration?.oidc ?? {}),
      },
    },
    bootstrapState: {
      ...defaults.bootstrapState,
      ...(value.bootstrapState ?? {}),
    },
  }
}

export function assertAuthenticationStoreShape(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) throw new Error('Authentication store must be an object.')
  if (store.version !== AUTH_STORE_VERSION) throw new Error('Authentication store version is unsupported.')

  const arrays = [
    'accounts', 'localCredentials', 'oidcIdentities', 'sessions', 'recoveryTokens',
    'securityEvents', 'oidcTransactions', 'roles', 'rolePermissions', 'accountRoles',
    'invitations', 'identityLinkRequests',
  ]
  for (const name of arrays) {
    if (!Array.isArray(store[name])) throw new Error(`authentication.${name} must be an array.`)
    assertUniqueIds(store[name], `authentication.${name}`)
  }

  const nextIds = [
    ['nextAccountId', 'accounts'],
    ['nextLocalCredentialId', 'localCredentials'],
    ['nextOidcIdentityId', 'oidcIdentities'],
    ['nextSessionId', 'sessions'],
    ['nextRecoveryTokenId', 'recoveryTokens'],
    ['nextSecurityEventId', 'securityEvents'],
    ['nextOidcTransactionId', 'oidcTransactions'],
    ['nextRoleId', 'roles'],
    ['nextRolePermissionId', 'rolePermissions'],
    ['nextAccountRoleId', 'accountRoles'],
    ['nextInvitationId', 'invitations'],
    ['nextIdentityLinkRequestId', 'identityLinkRequests'],
  ]
  for (const [next, records] of nextIds) assertNextId(store[next], store[records], `authentication.${next}`)

  const accountIds = new Set(store.accounts.map((account) => account.id))
  const usernames = new Set()
  const emails = new Set()
  let protectedOwnerCount = 0
  for (const [index, account] of store.accounts.entries()) {
    const path = `authentication.accounts[${index}]`
    if (typeof account.username !== 'string' || !/^[a-z0-9._-]{3,64}$/.test(account.username)) throw new Error(`${path}.username is invalid.`)
    if (usernames.has(account.username)) throw new Error('Authentication usernames must be unique.')
    usernames.add(account.username)
    if (typeof account.displayName !== 'string' || account.displayName.length < 1 || account.displayName.length > 100) throw new Error(`${path}.displayName is invalid.`)
    if (account.email !== null && account.email !== undefined) {
      if (typeof account.email !== 'string' || account.email !== account.email.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email)) throw new Error(`${path}.email is invalid.`)
      if (emails.has(account.email)) throw new Error('Authentication account emails must be unique.')
      emails.add(account.email)
    }
    if (typeof account.protectedOwner !== 'boolean') throw new Error(`${path}.protectedOwner must be boolean.`)
    if (account.protectedOwner) protectedOwnerCount += 1
    if (typeof account.active !== 'boolean') throw new Error(`${path}.active must be boolean.`)
    assertOptionalDate(account.createdAt, `${path}.createdAt`)
    assertOptionalDate(account.updatedAt, `${path}.updatedAt`)
  }
  if (protectedOwnerCount > 1) throw new Error('Authentication may contain only one protected owner.')

  const localAccounts = new Set()
  for (const [index, credential] of store.localCredentials.entries()) {
    const path = `authentication.localCredentials[${index}]`
    assertPositiveId(credential.accountId, `${path}.accountId`)
    if (!accountIds.has(credential.accountId)) throw new Error(`${path}.accountId references a missing account.`)
    if (localAccounts.has(credential.accountId)) throw new Error('Each account may have only one local credential.')
    localAccounts.add(credential.accountId)
    if (typeof credential.passwordHash !== 'string' || credential.passwordHash.length < 20) throw new Error(`${path}.passwordHash is invalid.`)
    assertOptionalDate(credential.createdAt, `${path}.createdAt`)
    assertOptionalDate(credential.updatedAt, `${path}.updatedAt`)
  }

  const oidcKeys = new Set()
  for (const [index, identity] of store.oidcIdentities.entries()) {
    const path = `authentication.oidcIdentities[${index}]`
    assertPositiveId(identity.accountId, `${path}.accountId`)
    if (!accountIds.has(identity.accountId)) throw new Error(`${path}.accountId references a missing account.`)
    assertHttpsOrLocalUrl(identity.issuer, `${path}.issuer`)
    if (typeof identity.subject !== 'string' || identity.subject.length < 1 || identity.subject.length > 255) throw new Error(`${path}.subject is invalid.`)
    if (identity.email !== null && identity.email !== undefined && (typeof identity.email !== 'string' || identity.email !== identity.email.toLowerCase())) throw new Error(`${path}.email is invalid.`)
    const key = `${identity.issuer}\u0000${identity.subject}`
    if (oidcKeys.has(key)) throw new Error('OIDC issuer and subject pairs must be unique.')
    oidcKeys.add(key)
    assertOptionalDate(identity.createdAt, `${path}.createdAt`)
    assertOptionalDate(identity.lastLoginAt, `${path}.lastLoginAt`)
  }

  for (const name of ['sessions', 'recoveryTokens', 'securityEvents', 'oidcTransactions']) {
    for (const [index, record] of store[name].entries()) {
      const path = `authentication.${name}[${index}]`
      if (record.accountId !== null && record.accountId !== undefined) {
        assertPositiveId(record.accountId, `${path}.accountId`)
        if (!accountIds.has(record.accountId)) throw new Error(`${path}.accountId references a missing account.`)
      }
    }
  }


  const sessionHashes = new Set()
  for (const [index, session] of store.sessions.entries()) {
    const path = `authentication.sessions[${index}]`
    assertTokenHash(session.tokenHash, `${path}.tokenHash`)
    if (sessionHashes.has(session.tokenHash)) throw new Error('Authentication session token hashes must be unique.')
    sessionHashes.add(session.tokenHash)
    if (typeof session.remember !== 'boolean') throw new Error(`${path}.remember must be boolean.`)
    for (const field of ['createdAt', 'lastSeenAt', 'idleExpiresAt', 'absoluteExpiresAt']) assertDate(session[field], `${path}.${field}`)
    assertOptionalDate(session.revokedAt, `${path}.revokedAt`)
  }

  const recoveryHashes = new Set()
  for (const [index, recovery] of store.recoveryTokens.entries()) {
    const path = `authentication.recoveryTokens[${index}]`
    assertTokenHash(recovery.tokenHash, `${path}.tokenHash`)
    if (recoveryHashes.has(recovery.tokenHash)) throw new Error('Authentication recovery token hashes must be unique.')
    recoveryHashes.add(recovery.tokenHash)
    assertDate(recovery.createdAt, `${path}.createdAt`)
    assertDate(recovery.expiresAt, `${path}.expiresAt`)
    assertOptionalDate(recovery.usedAt, `${path}.usedAt`)
  }

  for (const [index, event] of store.securityEvents.entries()) {
    const path = `authentication.securityEvents[${index}]`
    if (typeof event.type !== 'string' || event.type.length < 1 || event.type.length > 100) throw new Error(`${path}.type is invalid.`)
    assertDate(event.createdAt, `${path}.createdAt`)
  }

  const transactionHashes = new Set()
  for (const [index, transaction] of store.oidcTransactions.entries()) {
    const path = `authentication.oidcTransactions[${index}]`
    assertTokenHash(transaction.tokenHash, `${path}.tokenHash`)
    if (transactionHashes.has(transaction.tokenHash)) throw new Error('OIDC transaction token hashes must be unique.')
    transactionHashes.add(transaction.tokenHash)
    for (const field of ['state', 'nonce', 'codeVerifier']) {
      if (typeof transaction[field] !== 'string' || transaction[field].length < 16 || transaction[field].length > 512) throw new Error(`${path}.${field} is invalid.`)
    }
    if (typeof transaction.returnTo !== 'string' || !transaction.returnTo.startsWith('/') || transaction.returnTo.startsWith('//')) throw new Error(`${path}.returnTo is invalid.`)
    assertDate(transaction.createdAt, `${path}.createdAt`)
    assertDate(transaction.expiresAt, `${path}.expiresAt`)
    assertOptionalDate(transaction.usedAt, `${path}.usedAt`)
  }

  const roleIds = new Set(store.roles.map((role) => role.id))
  const roleKeys = new Set()
  for (const [index, role] of store.roles.entries()) {
    const path = `authentication.roles[${index}]`
    if (typeof role.key !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(role.key)) throw new Error(`${path}.key is invalid.`)
    if (roleKeys.has(role.key)) throw new Error('Authentication role keys must be unique.')
    roleKeys.add(role.key)
    if (typeof role.name !== 'string' || role.name.length < 1 || role.name.length > 80) throw new Error(`${path}.name is invalid.`)
    if (typeof role.description !== 'string' || role.description.length > 255) throw new Error(`${path}.description is invalid.`)
    if (typeof role.builtIn !== 'boolean' || typeof role.active !== 'boolean') throw new Error(`${path} flags are invalid.`)
    assertDate(role.createdAt, `${path}.createdAt`)
    assertDate(role.updatedAt, `${path}.updatedAt`)
  }
  for (const builtIn of BUILT_IN_ROLE_DEFINITIONS) {
    const role = store.roles.find((candidate) => candidate.id === builtIn.id && candidate.key === builtIn.key && candidate.builtIn === true)
    if (!role || role.active !== true) throw new Error(`Built-in role ${builtIn.key} is missing or invalid.`)
  }

  const rolePermissionKeys = new Set()
  for (const [index, relation] of store.rolePermissions.entries()) {
    const path = `authentication.rolePermissions[${index}]`
    assertPositiveId(relation.roleId, `${path}.roleId`)
    assertPositiveId(relation.permissionId, `${path}.permissionId`)
    if (!roleIds.has(relation.roleId)) throw new Error(`${path}.roleId references a missing role.`)
    if (!PERMISSION_BY_ID.has(relation.permissionId)) throw new Error(`${path}.permissionId references an unknown permission.`)
    const key = `${relation.roleId}:${relation.permissionId}`
    if (rolePermissionKeys.has(key)) throw new Error('Role permission relationships must be unique.')
    rolePermissionKeys.add(key)
  }

  const accountRoleKeys = new Set()
  for (const [index, assignment] of store.accountRoles.entries()) {
    const path = `authentication.accountRoles[${index}]`
    assertPositiveId(assignment.accountId, `${path}.accountId`)
    assertPositiveId(assignment.roleId, `${path}.roleId`)
    if (!accountIds.has(assignment.accountId)) throw new Error(`${path}.accountId references a missing account.`)
    if (!roleIds.has(assignment.roleId)) throw new Error(`${path}.roleId references a missing role.`)
    if (assignment.scopeKind !== 'global' || assignment.scopeId !== 0) throw new Error(`${path} uses an unsupported scope.`)
    const key = `${assignment.accountId}:${assignment.roleId}:${assignment.scopeKind}:${assignment.scopeId}`
    if (accountRoleKeys.has(key)) throw new Error('Account role relationships must be unique.')
    accountRoleKeys.add(key)
  }

  const protectedOwner = store.accounts.find((account) => account.protectedOwner)
  const ownerRole = store.roles.find((role) => role.key === 'owner')
  if (protectedOwner && !store.accountRoles.some((assignment) => assignment.accountId === protectedOwner.id && assignment.roleId === ownerRole?.id)) {
    throw new Error('The protected owner must retain the Owner role.')
  }

  const invitationEmails = new Set()
  for (const [index, invitation] of store.invitations.entries()) {
    const path = `authentication.invitations[${index}]`
    if (!['local', 'oidc'].includes(invitation.identityType)) throw new Error(`${path}.identityType is invalid.`)
    if (typeof invitation.email !== 'string' || invitation.email !== invitation.email.toLowerCase()) throw new Error(`${path}.email is invalid.`)
    if (!['pending', 'accepted', 'expired', 'revoked'].includes(invitation.status)) throw new Error(`${path}.status is invalid.`)
    assertTokenHash(invitation.tokenHash, `${path}.tokenHash`)
    assertPositiveId(invitation.createdByAccountId, `${path}.createdByAccountId`)
    if (!accountIds.has(invitation.createdByAccountId)) throw new Error(`${path}.createdByAccountId references a missing account.`)
    if (!Array.isArray(invitation.roleIds) || invitation.roleIds.some((roleId) => !roleIds.has(roleId))) throw new Error(`${path}.roleIds are invalid.`)
    assertDate(invitation.createdAt, `${path}.createdAt`)
    assertDate(invitation.expiresAt, `${path}.expiresAt`)
    assertOptionalDate(invitation.acceptedAt, `${path}.acceptedAt`)
    assertOptionalDate(invitation.revokedAt, `${path}.revokedAt`)
    if (invitation.accountId != null && !accountIds.has(invitation.accountId)) throw new Error(`${path}.accountId references a missing account.`)
    if (invitation.status === 'pending') {
      if (invitationEmails.has(invitation.email)) throw new Error('Pending invitation emails must be unique.')
      invitationEmails.add(invitation.email)
    }
  }

  for (const [index, request] of store.identityLinkRequests.entries()) {
    const path = `authentication.identityLinkRequests[${index}]`
    assertPositiveId(request.accountId, `${path}.accountId`)
    if (!accountIds.has(request.accountId)) throw new Error(`${path}.accountId references a missing account.`)
    if (!['local', 'oidc'].includes(request.identityType)) throw new Error(`${path}.identityType is invalid.`)
    if (!['pending', 'confirmed', 'expired', 'revoked'].includes(request.status)) throw new Error(`${path}.status is invalid.`)
    assertTokenHash(request.tokenHash, `${path}.tokenHash`)
    assertDate(request.createdAt, `${path}.createdAt`)
    assertDate(request.expiresAt, `${path}.expiresAt`)
    assertOptionalDate(request.confirmedAt, `${path}.confirmedAt`)
  }

  if (!store.configuration || typeof store.configuration !== 'object') throw new Error('authentication.configuration is invalid.')
  for (const field of ['enabled', 'localEnabled', 'oidcEnabled']) {
    if (typeof store.configuration[field] !== 'boolean') throw new Error(`authentication.configuration.${field} must be boolean.`)
  }
  if (store.configuration.enabled && !store.configuration.localEnabled && !store.configuration.oidcEnabled) {
    throw new Error('Enabled authentication requires at least one login method.')
  }
  if (!store.configuration.oidc || !Array.isArray(store.configuration.oidc.scopes)) throw new Error('authentication.configuration.oidc is invalid.')
  const oidc = store.configuration.oidc
  assertHttpsOrLocalUrl(oidc.issuer, 'authentication.configuration.oidc.issuer')
  assertHttpsOrLocalUrl(oidc.externalUrl, 'authentication.configuration.oidc.externalUrl')
  if (oidc.clientId !== null && (typeof oidc.clientId !== 'string' || oidc.clientId.length < 1 || oidc.clientId.length > 255)) throw new Error('authentication.configuration.oidc.clientId is invalid.')
  if (typeof oidc.clientSecretConfigured !== 'boolean') throw new Error('authentication.configuration.oidc.clientSecretConfigured must be boolean.')
  if (!oidc.scopes.length || oidc.scopes.some((scope) => typeof scope !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(scope))) throw new Error('authentication.configuration.oidc.scopes is invalid.')
  if (new Set(oidc.scopes).size !== oidc.scopes.length) throw new Error('authentication.configuration.oidc.scopes must be unique.')
  if (store.bootstrapState?.setupRequired !== true && store.bootstrapState?.setupRequired !== false) throw new Error('authentication.bootstrapState.setupRequired must be boolean.')
  assertOptionalDate(store.bootstrapState.completedAt, 'authentication.bootstrapState.completedAt')
}

export function createOwnerAccount(id, username, displayName) {
  const timestamp = nowIso()
  return { id, username, email: null, displayName, protectedOwner: true, active: true, createdAt: timestamp, updatedAt: timestamp }
}

export function ensureProtectedOwnerRole(store, accountId) {
  assertPositiveId(accountId, 'authentication protected owner account ID')
  const ownerRole = store.roles.find((role) => role.key === 'owner' && role.builtIn === true)
  if (!ownerRole) throw new Error('The built-in Owner role is unavailable.')
  const existing = store.accountRoles.find((assignment) => (
    assignment.accountId === accountId
    && assignment.roleId === ownerRole.id
    && assignment.scopeKind === 'global'
    && assignment.scopeId === 0
  ))
  if (existing) return existing
  const assignment = {
    id: store.nextAccountRoleId++,
    accountId,
    roleId: ownerRole.id,
    scopeKind: 'global',
    scopeId: 0,
  }
  store.accountRoles.push(assignment)
  return assignment
}

export { AUTH_STORE_VERSION }
