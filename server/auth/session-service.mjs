import { createOpaqueToken, hashOpaqueToken } from './tokens.mjs'

export const SESSION_COOKIE_NAME = 'hli_session'
const IDLE_MS = 24 * 60 * 60 * 1000
const REMEMBERED_IDLE_MS = 7 * 24 * 60 * 60 * 1000
const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export class SessionService {
  constructor({ store, externalUrl = null, now = () => new Date() }) {
    this.store = store
    this.externalUrl = externalUrl
    this.now = now
  }

  cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: String(this.externalUrl ?? '').startsWith('https://'),
      path: '/',
    }
  }

  create(accountId, { remember = false, userAgent = null, ip = null } = {}) {
    const { token, hash } = createOpaqueToken()
    const now = this.now()
    const idleMs = remember ? REMEMBERED_IDLE_MS : IDLE_MS
    let session
    this.store.updateAuthentication((draft) => {
      session = {
        id: draft.nextSessionId++,
        accountId,
        tokenHash: hash,
        remember: remember === true,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        idleExpiresAt: new Date(now.getTime() + idleMs).toISOString(),
        absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_MS).toISOString(),
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
        ip: typeof ip === 'string' ? ip.slice(0, 64) : null,
        revokedAt: null,
      }
      draft.sessions.push(session)
    })
    return { token, session: structuredClone(session) }
  }

  authenticateToken(token) {
    if (!token) return null
    const tokenHash = hashOpaqueToken(token)
    const state = this.store.getAuthenticationState()
    const session = state.sessions.find((candidate) => candidate.tokenHash === tokenHash)
    if (!session || session.revokedAt) return null
    const now = this.now()
    if (Date.parse(session.idleExpiresAt) <= now.getTime() || Date.parse(session.absoluteExpiresAt) <= now.getTime()) {
      this.revoke(token)
      return null
    }
    const account = state.accounts.find((candidate) => candidate.id === session.accountId && candidate.active)
    if (!account) return null
    if (now.getTime() - Date.parse(session.lastSeenAt) >= TOUCH_INTERVAL_MS) {
      this.store.updateAuthentication((draft) => {
        const current = draft.sessions.find((candidate) => candidate.id === session.id)
        if (!current || current.revokedAt) return
        const idleMs = current.remember ? REMEMBERED_IDLE_MS : IDLE_MS
        current.lastSeenAt = now.toISOString()
        current.idleExpiresAt = new Date(Math.min(
          now.getTime() + idleMs,
          Date.parse(current.absoluteExpiresAt),
        )).toISOString()
      })
    }
    return { account, session }
  }

  authenticateRequest(request) {
    return this.authenticateToken(cookieValue(request.get?.('cookie') ?? request.headers?.cookie, SESSION_COOKIE_NAME))
  }

  revoke(token) {
    if (!token) return false
    const tokenHash = hashOpaqueToken(token)
    let revoked = false
    this.store.updateAuthentication((draft) => {
      const session = draft.sessions.find((candidate) => candidate.tokenHash === tokenHash && !candidate.revokedAt)
      if (!session) return
      session.revokedAt = this.now().toISOString()
      revoked = true
    })
    return revoked
  }

  revokeById(id, accountId) {
    let revoked = false
    this.store.updateAuthentication((draft) => {
      const session = draft.sessions.find((candidate) => candidate.id === id && candidate.accountId === accountId && !candidate.revokedAt)
      if (!session) return
      session.revokedAt = this.now().toISOString()
      revoked = true
    })
    return revoked
  }

  revokeAllForAccount(accountId, { exceptSessionId = null } = {}) {
    this.store.updateAuthentication((draft) => {
      const timestamp = this.now().toISOString()
      for (const session of draft.sessions) {
        if (session.accountId === accountId && session.id !== exceptSessionId && !session.revokedAt) session.revokedAt = timestamp
      }
    })
  }
}

export function sessionTokenFromRequest(request) {
  return cookieValue(request.get?.('cookie') ?? request.headers?.cookie, SESSION_COOKIE_NAME)
}
