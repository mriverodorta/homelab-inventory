const AUTH_STORE_VERSION = 1

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
  return {
    version: AUTH_STORE_VERSION,
    nextAccountId: 1,
    nextLocalCredentialId: 1,
    nextOidcIdentityId: 1,
    nextSessionId: 1,
    nextRecoveryTokenId: 1,
    nextSecurityEventId: 1,
    nextOidcTransactionId: 1,
    accounts: [],
    localCredentials: [],
    oidcIdentities: [],
    sessions: [],
    recoveryTokens: [],
    securityEvents: [],
    oidcTransactions: [],
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
    account: account ? { id: account.id, username: account.username, displayName: account.displayName } : null,
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

  const arrays = ['accounts', 'localCredentials', 'oidcIdentities', 'sessions', 'recoveryTokens', 'securityEvents', 'oidcTransactions']
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
  ]
  for (const [next, records] of nextIds) assertNextId(store[next], store[records], `authentication.${next}`)

  const accountIds = new Set(store.accounts.map((account) => account.id))
  if (store.accounts.length > 1) throw new Error('Authentication currently supports exactly one owner account.')
  const usernames = new Set()
  for (const [index, account] of store.accounts.entries()) {
    const path = `authentication.accounts[${index}]`
    if (typeof account.username !== 'string' || !/^[a-z0-9._-]{3,64}$/.test(account.username)) throw new Error(`${path}.username is invalid.`)
    if (usernames.has(account.username)) throw new Error('Authentication usernames must be unique.')
    usernames.add(account.username)
    if (typeof account.displayName !== 'string' || account.displayName.length < 1 || account.displayName.length > 100) throw new Error(`${path}.displayName is invalid.`)
    if (account.role !== 'owner') throw new Error(`${path}.role is unsupported.`)
    if (typeof account.active !== 'boolean') throw new Error(`${path}.active must be boolean.`)
    assertOptionalDate(account.createdAt, `${path}.createdAt`)
    assertOptionalDate(account.updatedAt, `${path}.updatedAt`)
  }

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
  return { id, username, displayName, role: 'owner', active: true, createdAt: timestamp, updatedAt: timestamp }
}

export { AUTH_STORE_VERSION }
