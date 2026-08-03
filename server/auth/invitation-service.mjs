import { hashPassword, normalizeUsername } from './passwords.mjs'
import { createOpaqueToken, hashOpaqueToken } from './tokens.mjs'

const INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000

function normalizeEmail(value) {
  const email = String(value ?? '').normalize('NFKC').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Email address is invalid.')
  return email
}

function cleanDisplayName(value) {
  const name = String(value ?? '').normalize('NFKC').trim()
  if (!name || name.length > 100) throw new Error('Display name must contain 1-100 characters.')
  return name
}

function publicInvitation(invitation) {
  const { tokenHash: _tokenHash, ...safe } = invitation
  return structuredClone(safe)
}

function activeRoleIds(state, roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) throw new Error('Select at least one role.')
  const ids = [...new Set(roleIds.map(Number))]
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Role IDs are invalid.')
  for (const id of ids) {
    if (!state.roles.some((role) => role.id === id && role.active)) throw new Error(`Role ${id} is unavailable.`)
  }
  return ids.sort((left, right) => left - right)
}

function findPendingByToken(state, token, now) {
  const hash = hashOpaqueToken(token)
  const invitation = state.invitations.find((candidate) => candidate.tokenHash === hash)
  if (!invitation || invitation.status !== 'pending' || invitation.revokedAt) throw new Error('Invitation is invalid or no longer available.')
  if (Date.parse(invitation.expiresAt) <= now.getTime()) throw new Error('Invitation has expired.')
  return invitation
}

function uniqueUsername(state, preferred, email) {
  const source = preferred || email.split('@')[0]
  let base
  try { base = normalizeUsername(source) } catch { base = 'user' }
  if (!state.accounts.some((account) => account.username === base)) return base
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(3, 63 - String(suffix).length))}-${suffix}`
    if (!state.accounts.some((account) => account.username === candidate)) return candidate
  }
  throw new Error('Unable to allocate a unique username.')
}

export class InvitationService {
  constructor({ accessService, sessionService, now = () => new Date() }) {
    this.access = accessService
    this.sessions = sessionService
    this.now = now
  }

  list() {
    const now = this.now().getTime()
    return this.access.state().invitations.map((invitation) => ({
      ...publicInvitation(invitation),
      status: invitation.status === 'pending' && Date.parse(invitation.expiresAt) <= now ? 'expired' : invitation.status,
    }))
  }

  inspect(token) {
    const invitation = findPendingByToken(this.access.state(), token, this.now())
    return publicInvitation(invitation)
  }

  async create(actorId, input) {
    const email = normalizeEmail(input?.email)
    const identityType = input?.identityType
    if (!['local', 'oidc'].includes(identityType)) throw new Error('Invitation login method must be local or OIDC.')
    const { token, hash } = createOpaqueToken()
    const now = this.now()
    let created
    await this.access.mutate(actorId, 'invitation-created', email, (draft) => {
      if (draft.accounts.some((account) => account.email === email)) throw new Error('An account already uses this email address.')
      if (draft.invitations.some((invitation) => invitation.email === email && invitation.status === 'pending' && Date.parse(invitation.expiresAt) > now.getTime())) {
        throw new Error('A pending invitation already exists for this email address.')
      }
      const invitation = {
        id: draft.nextInvitationId++,
        email,
        identityType,
        roleIds: this.access.assertAssignableRoleIds(actorId, draft, activeRoleIds(draft, input?.roleIds)),
        tokenHash: hash,
        status: 'pending',
        createdByAccountId: actorId,
        accountId: null,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString(),
        acceptedAt: null,
        revokedAt: null,
      }
      draft.invitations.push(invitation)
      created = publicInvitation(invitation)
    })
    return { invitation: created, token }
  }

  async resend(actorId, invitationId) {
    const id = Number(invitationId)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invitation ID is invalid.')
    const { token, hash } = createOpaqueToken()
    const now = this.now()
    let updated
    await this.access.mutate(actorId, 'invitation-resent', id, (draft) => {
      const invitation = draft.invitations.find((candidate) => candidate.id === id)
      if (!invitation || !['pending', 'expired'].includes(invitation.status)) throw new Error('Invitation cannot be resent.')
      invitation.roleIds = this.access.assertAssignableRoleIds(actorId, draft, activeRoleIds(draft, invitation.roleIds))
      invitation.tokenHash = hash
      invitation.status = 'pending'
      invitation.createdAt = now.toISOString()
      invitation.expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString()
      invitation.revokedAt = null
      updated = publicInvitation(invitation)
    })
    return { invitation: updated, token }
  }

  async revoke(actorId, invitationId) {
    const id = Number(invitationId)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invitation ID is invalid.')
    const timestamp = this.now().toISOString()
    await this.access.mutate(actorId, 'invitation-revoked', id, (draft) => {
      const invitation = draft.invitations.find((candidate) => candidate.id === id)
      if (!invitation || invitation.status !== 'pending') throw new Error('Invitation is not pending.')
      invitation.status = 'revoked'
      invitation.revokedAt = timestamp
    })
    return { id }
  }

  async activateLocal(token, input, request = null) {
    const state = this.access.state()
    const invitation = findPendingByToken(state, token, this.now())
    if (invitation.identityType !== 'local') throw new Error('This invitation requires OIDC login.')
    const passwordHash = await hashPassword(input?.password)
    const displayName = cleanDisplayName(input?.displayName)
    const now = this.now()
    let accountId
    await this.access.mutate(null, 'invitation-accepted-local', invitation.email, (draft) => {
      const current = findPendingByToken(draft, token, now)
      if (draft.accounts.some((account) => account.email === current.email)) throw new Error('An account already uses this email address. Sign in and link the other login method instead.')
      accountId = draft.nextAccountId++
      draft.accounts.push({
        id: accountId,
        username: uniqueUsername(draft, input?.username, current.email),
        email: current.email,
        displayName,
        protectedOwner: false,
        active: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      draft.localCredentials.push({
        id: draft.nextLocalCredentialId++, accountId, passwordHash,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      })
      for (const roleId of activeRoleIds(draft, current.roleIds)) {
        draft.accountRoles.push({ id: draft.nextAccountRoleId++, accountId, roleId, scopeKind: 'global', scopeId: 0 })
      }
      current.accountId = accountId
      current.status = 'accepted'
      current.acceptedAt = now.toISOString()
    })
    return this.sessions.create(accountId, {
      remember: input?.remember === true,
      ip: request?.ip ?? null,
      userAgent: request?.get?.('user-agent') ?? null,
    })
  }

  async activateOidc(invitationId, transactionId, claims, issuer, subject) {
    const state = this.access.state()
    const invitation = state.invitations.find((candidate) => candidate.id === invitationId)
    if (!invitation || invitation.status !== 'pending' || Date.parse(invitation.expiresAt) <= this.now().getTime()) throw new Error('Invitation is invalid or expired.')
    if (invitation.identityType !== 'oidc') throw new Error('This invitation requires local account activation.')
    if (claims.email_verified !== true || normalizeEmail(claims.email) !== invitation.email) throw new Error('OIDC returned an unverified or different email address.')
    const now = this.now()
    let accountId
    await this.access.mutate(null, 'invitation-accepted-oidc', invitation.email, (draft) => {
      const current = draft.invitations.find((candidate) => candidate.id === invitationId)
      if (!current || current.status !== 'pending' || Date.parse(current.expiresAt) <= now.getTime()) throw new Error('Invitation is invalid or expired.')
      const transaction = draft.oidcTransactions.find((candidate) => candidate.id === transactionId)
      if (!transaction || transaction.usedAt) throw new Error('OIDC login transaction was already used.')
      transaction.usedAt = now.toISOString()
      if (draft.accounts.some((account) => account.email === current.email)) throw new Error('An account already uses this email address. Sign in and link the OIDC identity instead.')
      if (draft.oidcIdentities.some((identity) => identity.issuer === issuer && identity.subject === subject)) throw new Error('OIDC identity is already linked.')
      accountId = draft.nextAccountId++
      const displayName = cleanDisplayName(claims.name || claims.preferred_username || current.email)
      draft.accounts.push({
        id: accountId,
        username: uniqueUsername(draft, claims.preferred_username, current.email),
        email: current.email,
        displayName,
        protectedOwner: false,
        active: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      draft.oidcIdentities.push({
        id: draft.nextOidcIdentityId++, accountId, issuer, subject,
        email: current.email, displayName, createdAt: now.toISOString(), lastLoginAt: now.toISOString(),
      })
      for (const roleId of activeRoleIds(draft, current.roleIds)) {
        draft.accountRoles.push({ id: draft.nextAccountRoleId++, accountId, roleId, scopeKind: 'global', scopeId: 0 })
      }
      current.accountId = accountId
      current.status = 'accepted'
      current.acceptedAt = now.toISOString()
    })
    return accountId
  }
}
