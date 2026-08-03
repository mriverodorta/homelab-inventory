import { timingSafeEqual } from 'node:crypto'
import { createOwnerAccount, deriveAuthenticationMode, ensureProtectedOwnerRole, publicAuthenticationStatus } from './model.mjs'
import { hashPassword, normalizeUsername, verifyPassword } from './passwords.mjs'
import { createOpaqueToken, hashOpaqueToken } from './tokens.mjs'
import { removePrivateSecret, writePrivateSecret } from './config.mjs'
import { sessionTokenFromRequest } from './session-service.mjs'

const RECOVERY_LIFETIME_MS = 15 * 60 * 1000

function constantTimeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''))
  const rightBuffer = Buffer.from(String(right ?? ''))
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function cleanDisplayName(value) {
  const displayName = String(value ?? '').normalize('NFKC').trim()
  if (displayName.length < 1 || displayName.length > 100) throw new Error('Display name must contain 1-100 characters.')
  return displayName
}

function cleanUrl(value, label, { required = false } = {}) {
  const text = String(value ?? '').trim()
  if (!text && !required) return null
  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error(`${label} must be a valid URL.`)
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`${label} must use HTTPS.`)
  }
  return url.href.replace(/\/$/, '')
}

function requestMetadata(request) {
  return {
    ip: request?.ip ?? null,
    userAgent: request?.get?.('user-agent') ?? null,
  }
}

export class AuthService {
  constructor({ store, sessionService, authorization = null, runtime, now = () => new Date() }) {
    this.store = store
    this.sessions = sessionService
    this.runtime = runtime
    this.authorization = authorization
    this.now = now
  }

  state() {
    return this.store.getAuthenticationState()
  }

  status(request = null) {
    const authentication = request ? this.sessions.authenticateRequest(request) : null
    const state = this.state()
    const status = {
      ...publicAuthenticationStatus(state, { authenticatedAccountId: authentication?.account.id ?? null }),
      permissions: authentication ? this.authorization?.permissionsForSync(authentication.account.id) ?? [] : [],
      roles: authentication ? this.rolesForAccount(state, authentication.account.id) : [],
      identityMethods: authentication ? this.identityMethodsForAccount(state, authentication.account.id) : { local: false, oidc: false },
      canManage: deriveAuthenticationMode(state) === 'disabled'
        || (this.authorization?.permissionsForSync(authentication?.account.id).includes('authentication.manage') ?? authentication !== null),
      bootstrapSource: state.bootstrapState.setupRequired ? this.runtime.bootstrapSource : null,
      oidcSecretReadOnly: this.runtime.oidcSecretLocked === true,
    }
    status.oidc.clientSecretConfigured = Boolean(this.runtime.oidcClientSecret)
    status.localCredentialConfigured = state.localCredentials.some((credential) => state.accounts.some((account) => account.id === credential.accountId && account.active))
    status.oidc.identityBound = state.oidcIdentities.some((identity) => state.accounts.some((account) => account.id === identity.accountId && account.active))
    status.oidc.loginReady = !state.accounts.some((account) => account.active) || status.oidc.identityBound
    return status
  }

  statusForAccount(accountId) {
    const state = this.state()
    const status = {
      ...publicAuthenticationStatus(state, { authenticatedAccountId: accountId }),
      permissions: this.authorization?.permissionsForSync(accountId) ?? [],
      roles: this.rolesForAccount(state, accountId),
      identityMethods: this.identityMethodsForAccount(state, accountId),
      canManage: this.authorization?.permissionsForSync(accountId).includes('authentication.manage') ?? true,
      bootstrapSource: null,
      oidcSecretReadOnly: this.runtime.oidcSecretLocked === true,
    }
    status.oidc.clientSecretConfigured = Boolean(this.runtime.oidcClientSecret)
    status.localCredentialConfigured = state.localCredentials.some((credential) => state.accounts.some((account) => account.id === credential.accountId && account.active))
    status.oidc.identityBound = state.oidcIdentities.some((identity) => state.accounts.some((account) => account.id === identity.accountId && account.active))
    status.oidc.loginReady = !state.accounts.some((account) => account.active) || status.oidc.identityBound
    return status
  }

  rolesForAccount(state, accountId) {
    const ids = new Set(state.accountRoles.filter((assignment) => assignment.accountId === accountId && assignment.scopeKind === 'global' && assignment.scopeId === 0).map((assignment) => assignment.roleId))
    return state.roles.filter((role) => ids.has(role.id) && role.active).map(({ id, key, name, builtIn }) => ({ id, key, name, builtIn }))
  }

  identityMethodsForAccount(state, accountId) {
    return {
      local: state.localCredentials.some((credential) => credential.accountId === accountId),
      oidc: state.oidcIdentities.some((identity) => identity.accountId === accountId),
    }
  }

  async persist(mutator, { rebuildAuthorization = false } = {}) {
    const previous = this.state()
    const result = this.store.updateAuthentication(mutator)
    try {
      await this.store.flush(['authentication'])
      if (rebuildAuthorization && this.authorization) await this.authorization.rebuild(this.state())
      return result
    } catch (error) {
      this.store.updateAuthentication((draft) => {
        for (const key of Object.keys(draft)) delete draft[key]
        Object.assign(draft, structuredClone(previous))
      })
      await this.store.flush(['authentication']).catch(() => {})
      if (rebuildAuthorization && this.authorization) await this.authorization.rebuild(previous).catch(() => {})
      throw error
    }
  }

  async recordEvent(type, { accountId = null, request = null, detail = null } = {}) {
    const metadata = requestMetadata(request)
    await this.persist((draft) => {
      draft.securityEvents.push({
        id: draft.nextSecurityEventId++,
        accountId,
        type,
        detail: detail == null ? null : String(detail).slice(0, 255),
        ip: metadata.ip == null ? null : String(metadata.ip).slice(0, 64),
        userAgent: metadata.userAgent == null ? null : String(metadata.userAgent).slice(0, 255),
        createdAt: this.now().toISOString(),
      })
      if (draft.securityEvents.length > 500) draft.securityEvents.splice(0, draft.securityEvents.length - 500)
    })
  }

  async bootstrap({ bootstrapCode, username, displayName, password }, request = null) {
    const state = this.state()
    if (!state.bootstrapState.setupRequired || state.bootstrapState.completedAt) throw new Error('First-run setup is already complete.')
    if (!constantTimeTextEqual(bootstrapCode, this.runtime.bootstrapCode)) throw new Error('Bootstrap code is invalid.')
    const normalizedUsername = normalizeUsername(username)
    const normalizedDisplayName = cleanDisplayName(displayName)
    const passwordHash = await hashPassword(password)
    const timestamp = this.now().toISOString()
    let accountId
    await this.persist((draft) => {
      accountId = draft.nextAccountId++
      const account = createOwnerAccount(accountId, normalizedUsername, normalizedDisplayName)
      account.createdAt = timestamp
      account.updatedAt = timestamp
      draft.accounts.push(account)
      ensureProtectedOwnerRole(draft, accountId)
      draft.localCredentials.push({
        id: draft.nextLocalCredentialId++, accountId, passwordHash, createdAt: timestamp, updatedAt: timestamp,
      })
      draft.configuration.enabled = true
      draft.configuration.localEnabled = true
      draft.configuration.updatedAt = timestamp
      draft.bootstrapState.setupRequired = false
      draft.bootstrapState.completedAt = timestamp
    }, { rebuildAuthorization: true })
    await this.recordEvent('bootstrap-completed', { accountId, request })
    return this.createSession(accountId, { remember: false, request })
  }

  async loginLocal({ username, password, remember = false }, request = null) {
    const state = this.state()
    if (state.configuration.enabled !== true || state.configuration.localEnabled !== true) throw new Error('Local authentication is not enabled.')
    let normalizedUsername = null
    try { normalizedUsername = normalizeUsername(username) } catch {}
    const account = state.accounts.find((candidate) => candidate.username === normalizedUsername && candidate.active)
    const credential = account ? state.localCredentials.find((candidate) => candidate.accountId === account.id) : null
    const valid = credential ? await verifyPassword(password, credential.passwordHash) : false
    if (!valid) {
      await this.recordEvent('local-login-failed', { accountId: account?.id ?? null, request })
      throw new Error('Username or password is incorrect.')
    }
    await this.recordEvent('local-login-succeeded', { accountId: account.id, request })
    return this.createSession(account.id, { remember, request })
  }

  async createSession(accountId, { remember = false, request = null } = {}) {
    const metadata = requestMetadata(request)
    const created = this.sessions.create(accountId, { remember, ...metadata })
    await this.store.flush(['authentication'])
    return created
  }

  async logout(request) {
    const token = sessionTokenFromRequest(request)
    const authentication = this.sessions.authenticateRequest(request)
    this.sessions.revoke(token)
    await this.store.flush(['authentication'])
    if (authentication) await this.recordEvent('session-logged-out', { accountId: authentication.account.id, request })
  }

  requireAuthenticated(request) {
    const authentication = this.sessions.authenticateRequest(request)
    if (!authentication) throw new Error('Authentication is required.')
    return authentication
  }

  async updateMethods(input, request = null) {
    const state = this.state()
    const existingMode = deriveAuthenticationMode(state)
    const authentication = existingMode === 'disabled' ? null : this.requireAuthenticated(request)
    const localEnabled = input.localEnabled === true
    const oidcEnabled = input.oidcEnabled === true
    const enabled = input.enabled === true
    if (enabled && !localEnabled && !oidcEnabled) throw new Error('Enable at least one login method.')
    if (enabled && this.store.getBackupManagementState?.().schedule?.enabled && !this.runtime.backupEncryptionConfigured) {
      throw new Error('Configure BACKUP_ENCRYPTION_PASSPHRASE before enabling owner authentication while scheduled backups are active.')
    }

    let owner = state.accounts[0] ?? null
    const ownerHasOidcIdentity = owner
      ? state.oidcIdentities.some((identity) => identity.accountId === owner.id)
      : false
    if (enabled && oidcEnabled && !localEnabled && owner && !ownerHasOidcIdentity) {
      throw new Error('Link the owner identity through OIDC before disabling local login.')
    }
    let passwordHash = null
    if (localEnabled && !state.localCredentials.some((credential) => credential.accountId === owner?.id)) {
      passwordHash = await hashPassword(input.password)
      if (!owner) {
        owner = { username: normalizeUsername(input.username), displayName: cleanDisplayName(input.displayName) }
      }
    }
    const oidcSecret = String(input.oidc?.clientSecret ?? '').trim()
    const clearOidcSecret = !oidcEnabled && input.clearOidcSecret === true
    const normalizedOidc = input.oidc ? {
      issuer: cleanUrl(input.oidc.issuer ?? state.configuration.oidc.issuer, 'OIDC issuer'),
      clientId: String(input.oidc.clientId ?? state.configuration.oidc.clientId ?? '').trim() || null,
      scopes: Array.isArray(input.oidc.scopes) && input.oidc.scopes.length
        ? [...new Set(input.oidc.scopes.map((scope) => String(scope).trim()).filter(Boolean))]
        : state.configuration.oidc.scopes,
      externalUrl: cleanUrl(input.oidc.externalUrl ?? state.configuration.oidc.externalUrl ?? this.runtime.externalUrl, 'External URL'),
    } : null
    if (oidcEnabled) {
      if (!normalizedOidc?.issuer) throw new Error('OIDC issuer is required.')
      if (!normalizedOidc.clientId) throw new Error('OIDC client ID is required.')
      if (!normalizedOidc.externalUrl) throw new Error('External URL is required.')
      const hasSecret = Boolean(oidcSecret || this.runtime.oidcClientSecret)
      if (!hasSecret) throw new Error('OIDC client secret is required.')
    }
    if (oidcSecret && this.runtime.oidcSecretLocked) {
      throw new Error('OIDC client secret is managed by the environment and is read-only.')
    }
    if (clearOidcSecret && this.runtime.oidcSecretLocked) {
      throw new Error('OIDC client secret is managed by the environment and cannot be removed.')
    }

    const timestamp = this.now().toISOString()
    let ownerId = owner?.id ?? null
    const previousSecret = this.runtime.oidcClientSecret
    const restoreState = async () => {
      this.store.updateAuthentication((draft) => {
        for (const key of Object.keys(draft)) delete draft[key]
        Object.assign(draft, structuredClone(state))
      })
      await this.store.flush(['authentication'])
    }
    const restoreSecret = async () => {
      if (previousSecret) await writePrivateSecret(this.runtime.oidcClientSecretFile, previousSecret)
      else await removePrivateSecret(this.runtime.oidcClientSecretFile)
      this.runtime.oidcClientSecret = previousSecret
    }

    try {
      if (oidcSecret) {
        await writePrivateSecret(this.runtime.oidcClientSecretFile, oidcSecret)
        this.runtime.oidcClientSecret = oidcSecret
      } else if (clearOidcSecret) {
        await removePrivateSecret(this.runtime.oidcClientSecretFile)
        this.runtime.oidcClientSecret = null
      }
      await this.persist((draft) => {
        if (!draft.accounts.length && owner) {
          ownerId = draft.nextAccountId++
          const account = createOwnerAccount(ownerId, owner.username, owner.displayName)
          account.createdAt = timestamp
          account.updatedAt = timestamp
          draft.accounts.push(account)
          ensureProtectedOwnerRole(draft, ownerId)
        }
        if (passwordHash && ownerId && !draft.localCredentials.some((credential) => credential.accountId === ownerId)) {
          draft.localCredentials.push({ id: draft.nextLocalCredentialId++, accountId: ownerId, passwordHash, createdAt: timestamp, updatedAt: timestamp })
        }
        draft.configuration.enabled = enabled
        draft.configuration.localEnabled = enabled && localEnabled
        draft.configuration.oidcEnabled = enabled && oidcEnabled
        draft.configuration.updatedAt = timestamp
        if (normalizedOidc) {
          draft.configuration.oidc.issuer = normalizedOidc.issuer
          draft.configuration.oidc.clientId = normalizedOidc.clientId
          draft.configuration.oidc.scopes = normalizedOidc.scopes
          draft.configuration.oidc.externalUrl = normalizedOidc.externalUrl
        }
        draft.configuration.oidc.clientSecretConfigured = Boolean(this.runtime.oidcClientSecret)
      }, { rebuildAuthorization: true })
    } catch (error) {
      await Promise.allSettled([restoreSecret(), restoreState()])
      throw error
    }
    if (!enabled && ownerId) {
      this.sessions.revokeAllForAccount(ownerId)
      await this.store.flush(['authentication'])
    }
    this.sessions.externalUrl = this.state().configuration.oidc.externalUrl || this.runtime.externalUrl
    await this.recordEvent('authentication-settings-updated', { accountId: authentication?.account.id ?? ownerId, request, detail: deriveAuthenticationMode(this.state()) })
    return this.status(request)
  }

  async changePassword({ currentPassword, newPassword }, request) {
    const { account, session } = this.requireAuthenticated(request)
    const state = this.state()
    const credential = state.localCredentials.find((candidate) => candidate.accountId === account.id)
    if (!credential || !await verifyPassword(currentPassword, credential.passwordHash)) throw new Error('Current password is incorrect.')
    const passwordHash = await hashPassword(newPassword)
    const timestamp = this.now().toISOString()
    await this.persist((draft) => {
      const current = draft.localCredentials.find((candidate) => candidate.accountId === account.id)
      current.passwordHash = passwordHash
      current.updatedAt = timestamp
    })
    this.sessions.revokeAllForAccount(account.id, { exceptSessionId: session.id })
    await this.store.flush(['authentication'])
    await this.recordEvent('password-changed', { accountId: account.id, request })
  }

  async addLocalIdentity({ username, password }, request) {
    const { account } = this.requireAuthenticated(request)
    const state = this.state()
    if (!state.oidcIdentities.some((identity) => identity.accountId === account.id)) {
      throw new Error('An authenticated OIDC identity is required before adding local sign-in.')
    }
    if (state.localCredentials.some((credential) => credential.accountId === account.id)) {
      throw new Error('This account already has local sign-in.')
    }
    const normalizedUsername = normalizeUsername(username)
    if (state.accounts.some((candidate) => candidate.id !== account.id && candidate.username === normalizedUsername)) {
      throw new Error('Username is already in use.')
    }
    const passwordHash = await hashPassword(password)
    const timestamp = this.now().toISOString()
    await this.persist((draft) => {
      const current = draft.accounts.find((candidate) => candidate.id === account.id)
      if (!current?.active) throw new Error('Account is unavailable.')
      current.username = normalizedUsername
      current.updatedAt = timestamp
      draft.localCredentials.push({
        id: draft.nextLocalCredentialId++, accountId: current.id, passwordHash,
        createdAt: timestamp, updatedAt: timestamp,
      })
    })
    await this.recordEvent('local-identity-linked', { accountId: account.id, request })
    return this.statusForAccount(account.id)
  }

  async createRecoveryGrant() {
    const state = this.state()
    const account = state.accounts.find((candidate) => candidate.protectedOwner === true && candidate.active)
    if (!account) throw new Error('No active owner account exists.')
    const { token, hash } = createOpaqueToken()
    const now = this.now()
    await this.persist((draft) => {
      draft.recoveryTokens.push({
        id: draft.nextRecoveryTokenId++, accountId: account.id, tokenHash: hash,
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + RECOVERY_LIFETIME_MS).toISOString(), usedAt: null,
      })
    })
    return { token, expiresAt: new Date(now.getTime() + RECOVERY_LIFETIME_MS).toISOString() }
  }

  async resetOwnerWithGrant({ token, username, displayName, password }, request = null) {
    const tokenHash = hashOpaqueToken(token)
    const state = this.state()
    const grant = state.recoveryTokens.find((candidate) => candidate.tokenHash === tokenHash && !candidate.usedAt && Date.parse(candidate.expiresAt) > this.now().getTime())
    if (!grant) throw new Error('Recovery link is invalid or expired.')
    const passwordHash = await hashPassword(password)
    const normalizedUsername = normalizeUsername(username)
    const normalizedDisplayName = cleanDisplayName(displayName)
    const timestamp = this.now().toISOString()
    await this.persist((draft) => {
      const account = draft.accounts.find((candidate) => candidate.id === grant.accountId)
      account.username = normalizedUsername
      account.displayName = normalizedDisplayName
      account.updatedAt = timestamp
      account.active = true
      ensureProtectedOwnerRole(draft, account.id)
      let credential = draft.localCredentials.find((candidate) => candidate.accountId === account.id)
      if (!credential) {
        credential = { id: draft.nextLocalCredentialId++, accountId: account.id, createdAt: timestamp }
        draft.localCredentials.push(credential)
      }
      credential.passwordHash = passwordHash
      credential.updatedAt = timestamp
      const currentGrant = draft.recoveryTokens.find((candidate) => candidate.id === grant.id)
      currentGrant.usedAt = timestamp
      draft.configuration.enabled = true
      draft.configuration.localEnabled = true
      draft.configuration.updatedAt = timestamp
    }, { rebuildAuthorization: true })
    this.sessions.revokeAllForAccount(grant.accountId)
    await this.store.flush(['authentication'])
    await this.recordEvent('owner-recovered', { accountId: grant.accountId, request })
    return this.createSession(grant.accountId, { request })
  }

  sessionsFor(request) {
    const authentication = this.requireAuthenticated(request)
    const now = this.now().getTime()
    return this.state().sessions
      .filter((session) => session.accountId === authentication.account.id && !session.revokedAt && Date.parse(session.absoluteExpiresAt) > now)
      .map((session) => ({
        id: session.id, remember: session.remember, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt,
        idleExpiresAt: session.idleExpiresAt, absoluteExpiresAt: session.absoluteExpiresAt,
        userAgent: session.userAgent, ip: session.ip, current: session.id === authentication.session.id,
      }))
  }

  eventsFor(request) {
    const authentication = this.requireAuthenticated(request)
    const canViewAll = this.authorization?.permissionsForSync(authentication.account.id).includes('security.events.view') === true
    return this.state().securityEvents
      .filter((event) => canViewAll || event.accountId === null || event.accountId === authentication.account.id)
      .slice(-100).reverse()
      .map(({ id, type, detail, ip, userAgent, createdAt }) => ({ id, type, detail, ip, userAgent, createdAt }))
  }
}
