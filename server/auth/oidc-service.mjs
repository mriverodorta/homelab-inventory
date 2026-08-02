import * as oidc from 'openid-client'
import { createOwnerAccount } from './model.mjs'
import { normalizeUsername } from './passwords.mjs'
import { createOpaqueToken, hashOpaqueToken } from './tokens.mjs'

export const OIDC_TRANSACTION_COOKIE = 'hli_oidc'
const TRANSACTION_LIFETIME_MS = 10 * 60 * 1000

function normalizeIssuer(value) {
  const url = new URL(String(value))
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('OIDC issuer must use HTTPS.')
  }
  return url.href.replace(/\/$/, '')
}

function safeReturnPath(value) {
  const path = String(value ?? '/')
  return path.startsWith('/') && !path.startsWith('//') ? path : '/'
}

function ownerIdentityFromClaims(claims) {
  const displayName = String(claims.name || claims.preferred_username || claims.email || 'OIDC Owner')
    .normalize('NFKC').trim().slice(0, 100) || 'OIDC Owner'
  const source = String(claims.preferred_username || claims.email?.split('@')[0] || 'owner')
    .normalize('NFKC').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  let username = source.length >= 3 ? source.slice(0, 64) : 'owner'
  try { username = normalizeUsername(username) } catch { username = 'owner' }
  return { username, displayName }
}

export class OidcService {
  constructor({ store, authService, runtime, now = () => new Date(), client = oidc }) {
    this.store = store
    this.authService = authService
    this.runtime = runtime
    this.now = now
    this.client = client
    this.discoveryCache = null
  }

  settings() {
    const state = this.store.getAuthenticationState()
    const configuration = state.configuration.oidc
    if (!state.configuration.oidcEnabled) throw new Error('OIDC authentication is not enabled.')
    if (!configuration.issuer || !configuration.clientId || !configuration.externalUrl || !this.runtime.oidcClientSecret) {
      throw new Error('OIDC authentication is not fully configured.')
    }
    return { ...configuration, issuer: normalizeIssuer(configuration.issuer) }
  }

  async configuration() {
    const settings = this.settings()
    const cacheKey = `${settings.issuer}\u0000${settings.clientId}\u0000${this.runtime.oidcClientSecret}`
    if (this.discoveryCache?.key === cacheKey) return this.discoveryCache.configuration
    const configuration = await this.client.discovery(
      new URL(settings.issuer),
      settings.clientId,
      this.runtime.oidcClientSecret,
    )
    this.discoveryCache = { key: cacheKey, configuration }
    return configuration
  }

  cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.settings().externalUrl.startsWith('https://'),
      path: '/api/auth/oidc',
      maxAge: TRANSACTION_LIFETIME_MS,
    }
  }

  async start({ returnTo = '/', bindAccountId = null } = {}) {
    const settings = this.settings()
    const authentication = this.store.getAuthenticationState()
    const activeOwner = authentication.accounts.find((account) => account.role === 'owner' && account.active)
    const ownerIdentityBound = activeOwner
      ? authentication.oidcIdentities.some((identity) => identity.accountId === activeOwner.id)
      : false
    if (!bindAccountId && activeOwner && !ownerIdentityBound) {
      throw new Error('Sign in locally and link the identity provider before using OIDC login.')
    }
    if (bindAccountId && (!activeOwner || bindAccountId !== activeOwner.id)) {
      throw new Error('OIDC can only be linked to the active owner account.')
    }
    const configuration = await this.configuration()
    const codeVerifier = this.client.randomPKCECodeVerifier()
    const codeChallenge = await this.client.calculatePKCECodeChallenge(codeVerifier)
    const state = this.client.randomState()
    const nonce = this.client.randomNonce()
    const { token, hash } = createOpaqueToken()
    const now = this.now()
    await this.authService.persist((draft) => {
      for (const transaction of draft.oidcTransactions) {
        if (!transaction.usedAt && Date.parse(transaction.expiresAt) <= now.getTime()) transaction.usedAt = now.toISOString()
      }
      draft.oidcTransactions.push({
        id: draft.nextOidcTransactionId++,
        accountId: bindAccountId,
        tokenHash: hash,
        state,
        nonce,
        codeVerifier,
        returnTo: safeReturnPath(returnTo),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + TRANSACTION_LIFETIME_MS).toISOString(),
        usedAt: null,
      })
    })
    const redirectUri = `${settings.externalUrl}/api/auth/oidc/callback`
    const url = this.client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: settings.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    return { url: url.href, transactionToken: token }
  }

  async callback(currentUrl, transactionToken) {
    const tokenHash = hashOpaqueToken(transactionToken)
    const state = this.store.getAuthenticationState()
    const transaction = state.oidcTransactions.find((candidate) => (
      candidate.tokenHash === tokenHash && !candidate.usedAt && Date.parse(candidate.expiresAt) > this.now().getTime()
    ))
    if (!transaction) throw new Error('OIDC login transaction is invalid or expired.')
    const settings = this.settings()
    const configuration = await this.configuration()
    const tokens = await this.client.authorizationCodeGrant(configuration, new URL(currentUrl), {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    })
    const claims = tokens.claims()
    if (!claims?.sub || !claims.iss) throw new Error('OIDC provider did not return a valid identity token.')
    const issuer = normalizeIssuer(claims.iss)
    if (issuer !== settings.issuer) throw new Error('OIDC identity issuer does not match the configured provider.')
    const subject = String(claims.sub)
    const timestamp = this.now().toISOString()
    let accountId = transaction.accountId
    await this.authService.persist((draft) => {
      const currentTransaction = draft.oidcTransactions.find((candidate) => candidate.id === transaction.id)
      if (!currentTransaction || currentTransaction.usedAt) throw new Error('OIDC login transaction was already used.')
      currentTransaction.usedAt = timestamp
      const existingIdentity = draft.oidcIdentities.find((identity) => identity.issuer === issuer && identity.subject === subject)
      if (existingIdentity) {
        if (accountId && existingIdentity.accountId !== accountId) throw new Error('OIDC identity is already bound to another account.')
        accountId = existingIdentity.accountId
        existingIdentity.email = typeof claims.email === 'string' ? claims.email : existingIdentity.email
        existingIdentity.displayName = typeof claims.name === 'string' ? claims.name : existingIdentity.displayName
        existingIdentity.lastLoginAt = timestamp
        return
      }
      if (!accountId && draft.accounts.some((account) => account.role === 'owner' && account.active)) {
        throw new Error('OIDC identity is not linked to the owner account.')
      }
      if (!accountId) {
        const owner = draft.accounts.find((account) => account.role === 'owner' && account.active)
        if (owner) accountId = owner.id
        else {
          const identity = ownerIdentityFromClaims(claims)
          accountId = draft.nextAccountId++
          const account = createOwnerAccount(accountId, identity.username, identity.displayName)
          account.createdAt = timestamp
          account.updatedAt = timestamp
          draft.accounts.push(account)
        }
      }
      draft.oidcIdentities.push({
        id: draft.nextOidcIdentityId++, accountId, issuer, subject,
        email: typeof claims.email === 'string' ? claims.email : null,
        displayName: typeof claims.name === 'string' ? claims.name : null,
        createdAt: timestamp, lastLoginAt: timestamp,
      })
    })
    await this.authService.recordEvent('oidc-login-succeeded', { accountId, detail: issuer })
    return { accountId, issuer, subject, returnTo: transaction.returnTo }
  }
}
