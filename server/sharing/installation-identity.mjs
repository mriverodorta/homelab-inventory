import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SHARE_CONTRACT_VERSION } from '../../packages/share-contract/src/index.ts'
import {
  activationSignature,
  LEGACY_SHARING_TOKEN_SCOPES,
  sharingIdentityHash,
  sharingPublicKeyId,
  SHARING_TOKEN_SCOPES,
  signedRequestHeaders,
} from './installation-auth.mjs'
import { ensureSharingInstance } from './installation-instance.mjs'
import { normalizeLabGdCapabilities } from './remote-capabilities.mjs'

const DEFAULT_LABGD_ORIGIN = 'https://lab.gd'
const REQUEST_TIMEOUT_MS = 15_000
const TOKEN_REFRESH_MARGIN_MS = 90_000

export class SharingRecoveryPendingError extends Error {
  constructor(message = 'Sharing installation recovery requires owner approval.') {
    super(message)
    this.name = 'SharingRecoveryPendingError'
    this.code = 'sharing-recovery-pending'
  }
}

export class SharingUnsupportedError extends Error {
  constructor(message = 'lab.gd does not support this sharing contract.') {
    super(message)
    this.name = 'SharingUnsupportedError'
    this.code = 'sharing-contract-unsupported'
  }
}

export function normalizeSharingCredentials(value, clientInstanceId) {
  const scopes = normalizeCredentialScopeSet(value?.scopes)
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1
    || value.clientInstanceId !== clientInstanceId
    || !Number.isSafeInteger(value.installationId) || value.installationId <= 0
    || typeof value.token !== 'string' || value.token.length < 16 || value.token.length > 4096
    || !scopes
    || typeof value.tokenExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.tokenExpiresAt))
  ) return null
  return {
    version: 1,
    clientInstanceId,
    installationId: value.installationId,
    token: value.token,
    scopes: [...scopes],
    tokenExpiresAt: value.tokenExpiresAt,
    renewalRequired: sameScopeSet(scopes, LEGACY_SHARING_TOKEN_SCOPES),
  }
}

export class SharingInstallationIdentityService {
  constructor({
    dataDir,
    repository,
    labGdOrigin = DEFAULT_LABGD_ORIGIN,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
  }) {
    if (!dataDir || !repository) throw new Error('Sharing identity requires a data directory and repository.')
    this.dataDir = dataDir
    this.repository = repository
    this.directory = path.join(dataDir, 'sharing')
    this.privateKeyPath = path.join(this.directory, 'installation-ed25519.pem')
    this.credentialsPath = path.join(this.directory, 'installation-credentials.json')
    this.recoveryKeyPath = path.join(this.directory, 'installation-recovery-ed25519.pem')
    this.labGdOrigin = new URL(labGdOrigin).origin
    this.fetchImpl = fetchImpl
    this.now = now
    this.inFlight = null
    this.remoteCapabilities = null
  }

  async ensureKeyPair(filePath = this.privateKeyPath) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    await fs.chmod(this.directory, 0o700)
    try {
      await fs.access(filePath)
    } catch {
      const { privateKey } = generateKeyPairSync('ed25519')
      const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
      await fs.writeFile(filePath, pem, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    }
    await fs.chmod(filePath, 0o600)
    const privateKey = createPrivateKey(await fs.readFile(filePath, 'utf8'))
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Sharing installation key must be Ed25519.')
    const publicKeySpki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
    return { privateKey, publicKeySpki, keyId: sharingPublicKeyId(publicKeySpki) }
  }

  async ensure() {
    const instance = await ensureSharingInstance(this.dataDir)
    const keys = await this.ensureKeyPair()
    const projection = {
      clientInstanceId: instance.clientInstanceId,
      keyId: keys.keyId,
      publicKeySpki: keys.publicKeySpki,
      identityHash: sharingIdentityHash(instance.clientInstanceId, keys.publicKeySpki),
      remoteInstallationId: null,
      credentialExpiresAtMs: null,
      state: 'local',
      recoveryPublicKeySpki: null,
    }
    const existing = this.repository.getInstallationProjection()
    if (existing) {
      if (existing.clientInstanceId !== projection.clientInstanceId || existing.identityHash !== projection.identityHash) {
        throw new Error('Sharing identity files do not match the persisted installation projection.')
      }
      return { instance, keys, projection: existing }
    }
    return { instance, keys, projection: this.repository.saveInstallationProjection(projection) }
  }

  async readCredentials(instance) {
    try {
      const credentials = normalizeSharingCredentials(JSON.parse(await fs.readFile(this.credentialsPath, 'utf8')), instance.clientInstanceId)
      if (!credentials) throw new Error('Sharing installation credentials are invalid.')
      await fs.chmod(this.credentialsPath, 0o600)
      return credentials
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async writeCredentials(credentials) {
    const temporary = `${this.credentialsPath}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      await fs.chmod(temporary, 0o600)
      await fs.rename(temporary, this.credentialsPath)
      await fs.chmod(this.credentialsPath, 0o600)
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {})
    }
  }

  async request(pathname, { method = 'GET', body = null, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (typeof pathname !== 'string' || !pathname.startsWith('/')) throw new Error('lab.gd request path is invalid.')
    const url = new URL(pathname, this.labGdOrigin)
    if (url.origin !== this.labGdOrigin) throw new Error('lab.gd request origin is invalid.')
    const controller = new AbortController()
    const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      return await this.fetchImpl(url, {
        method,
        headers: { accept: 'application/json', ...headers },
        ...(body == null ? {} : { body }),
        signal: controller.signal,
      })
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async readiness() {
    const response = await this.request('/readyz')
    const body = await boundedJson(response)
    if (body.contractMode !== 'packages-enabled') throw new SharingUnsupportedError()
    if (body.status !== 'ready') {
      const error = new Error('lab.gd is not ready for publication.')
      error.code = 'labgd-unavailable'
      error.retryAfterMs = retryAfterMs(response)
      throw error
    }
    if (typeof body.publicationReady !== 'boolean') throw new SharingUnsupportedError('lab.gd publication readiness is invalid.')
    const capabilityResponse = await this.request('/v1/capabilities')
    const capabilityDocument = await boundedJson(capabilityResponse)
    if (!capabilityResponse.ok) throw httpError(capabilityResponse, capabilityDocument, 'labgd-capabilities-failed')
    try {
      this.remoteCapabilities = normalizeLabGdCapabilities(capabilityDocument)
    } catch (error) {
      throw new SharingUnsupportedError(error instanceof Error ? error.message : undefined)
    }
    return { shareContractVersion: SHARE_CONTRACT_VERSION, capabilities: this.remoteCapabilities }
  }

  async publicationReadiness() {
    const response = await this.request('/readyz')
    const body = await boundedJson(response)
    if (body.contractMode !== 'packages-enabled') throw new SharingUnsupportedError()
    if (body.status !== 'ready' || body.publicationReady !== true) {
      const error = new Error('lab.gd is not ready for publication.')
      error.code = 'labgd-unavailable'
      error.retryAfterMs = retryAfterMs(response)
      throw error
    }
  }

  getCapabilities() {
    return this.remoteCapabilities ?? {}
  }

  async activateInternal({ keyPath = this.privateKeyPath, promoteRecovery = false, forceRefresh = false } = {}) {
    await this.readiness()
    const current = await this.ensure()
    const { instance } = current
    const keys = keyPath === this.privateKeyPath ? current.keys : await this.ensureKeyPair(keyPath)
    const existing = await this.readCredentials(instance)
    if (existing && current.projection.remoteInstallationId != null && current.projection.remoteInstallationId !== existing.installationId) {
      throw installationIdentityMismatch()
    }
    if (!promoteRecovery && existing) {
      const expiresAtMs = Date.parse(existing.tokenExpiresAt)
      if (expiresAtMs <= this.now().getTime()) {
        return this.challengeActivate(current, keys, { keyPath, promoteRecovery, expectedInstallationId: existing.installationId })
      }
      if (forceRefresh || existing.renewalRequired || expiresAtMs <= this.now().getTime() + TOKEN_REFRESH_MARGIN_MS) {
        try {
          return await this.renewCredentials(current, existing)
        } catch (error) {
          if (error?.code !== 'authentication-failed') throw error
          return this.challengeActivate(current, keys, { keyPath, promoteRecovery, expectedInstallationId: existing.installationId })
        }
      }
      this.repository.saveInstallationProjection({
        clientInstanceId: instance.clientInstanceId,
        keyId: keys.keyId,
        publicKeySpki: keys.publicKeySpki,
        identityHash: sharingIdentityHash(instance.clientInstanceId, keys.publicKeySpki),
        remoteInstallationId: existing.installationId,
        credentialExpiresAtMs: Date.parse(existing.tokenExpiresAt),
        state: 'active',
        recoveryPublicKeySpki: null,
      })
      return existing
    }
    return this.challengeActivate(current, keys, {
      keyPath,
      promoteRecovery,
      expectedInstallationId: existing?.installationId ?? current.projection.remoteInstallationId,
    })
  }

  async challengeActivate(current, keys, { keyPath, promoteRecovery, expectedInstallationId = null }) {
    const { instance } = current
    const challengeResponse = await this.request('/v1/installations/challenge', {
      method: 'POST',
      body: JSON.stringify({ clientInstanceId: instance.clientInstanceId }),
      headers: { 'content-type': 'application/json' },
    })
    const challenge = await boundedJson(challengeResponse)
    if (!challengeResponse.ok || typeof challenge.value !== 'string') throw httpError(challengeResponse, challenge, 'labgd-challenge-failed')
    const activationResponse = await this.request('/v1/installations/activate', {
      method: 'POST',
      body: JSON.stringify({
        challenge: challenge.value,
        clientInstanceId: instance.clientInstanceId,
        publicKeySpki: keys.publicKeySpki,
        signature: activationSignature(challenge.value, instance.clientInstanceId, keys.privateKey),
      }),
      headers: { 'content-type': 'application/json' },
    })
    const activation = await boundedJson(activationResponse)
    if (activationResponse.status === 409 && activation.status === 'recovery-pending') {
      assertExpectedInstallation(expectedInstallationId, activation.installationId)
      this.repository.saveInstallationProjection({
        clientInstanceId: instance.clientInstanceId,
        keyId: keys.keyId,
        publicKeySpki: keys.publicKeySpki,
        identityHash: sharingIdentityHash(instance.clientInstanceId, keys.publicKeySpki),
        remoteInstallationId: Number.isSafeInteger(activation.installationId) ? activation.installationId : null,
        credentialExpiresAtMs: null,
        state: 'recovery-pending',
        recoveryPublicKeySpki: keys.publicKeySpki,
      })
      throw new SharingRecoveryPendingError()
    }
    if (!activationResponse.ok || activation.status !== 'active' || !Number.isSafeInteger(activation.installationId) || typeof activation.token !== 'string') {
      throw httpError(activationResponse, activation, 'labgd-activation-failed')
    }
    assertExpectedInstallation(expectedInstallationId, activation.installationId)
    let scopes
    let tokenExpiresAt
    try {
      scopes = normalizeGrantedScopes(activation.scopes)
      tokenExpiresAt = normalizeTokenExpiry(activation.tokenExpiresAt, this.now())
    } catch (error) {
      throw error instanceof SharingUnsupportedError ? error : new SharingUnsupportedError()
    }
    const credentials = {
      version: 1,
      clientInstanceId: instance.clientInstanceId,
      installationId: activation.installationId,
      token: activation.token,
      scopes,
      tokenExpiresAt,
    }
    await this.writeCredentials(credentials)
    if (promoteRecovery) {
      await fs.rename(keyPath, this.privateKeyPath)
      await fs.chmod(this.privateKeyPath, 0o600)
    }
    this.repository.saveInstallationProjection({
      clientInstanceId: instance.clientInstanceId,
      keyId: keys.keyId,
      publicKeySpki: keys.publicKeySpki,
      identityHash: sharingIdentityHash(instance.clientInstanceId, keys.publicKeySpki),
      remoteInstallationId: credentials.installationId,
      credentialExpiresAtMs: Date.parse(credentials.tokenExpiresAt),
      state: 'active',
      recoveryPublicKeySpki: null,
    })
    return credentials
  }

  async renewCredentials(current, existing) {
    if (!existing.scopes.includes('token:renew')) throw new SharingUnsupportedError('Legacy lab.gd credentials cannot be renewed.')
    const body = new TextEncoder().encode(JSON.stringify({ scopes: [...SHARING_TOKEN_SCOPES] }))
    const response = await this.request('/v1/installations/renew', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        ...signedRequestHeaders({ token: existing.token, body, scope: 'token:renew', privateKey: current.keys.privateKey, now: this.now() }),
      },
    })
    const result = await boundedJson(response)
    if (!response.ok || typeof result.token !== 'string' || result.token.length < 16 || result.token.length > 4096) throw httpError(response, result, 'labgd-renewal-failed')
    let scopes
    let tokenExpiresAt
    try {
      scopes = normalizeGrantedScopes(result.scopes)
      tokenExpiresAt = normalizeTokenExpiry(result.tokenExpiresAt, this.now())
    } catch (error) {
      throw error instanceof SharingUnsupportedError ? error : new SharingUnsupportedError()
    }
    const credentials = {
      version: 1,
      clientInstanceId: current.instance.clientInstanceId,
      installationId: existing.installationId,
      token: result.token,
      scopes,
      tokenExpiresAt,
    }
    await this.writeCredentials(credentials)
    this.repository.saveInstallationProjection({
      clientInstanceId: current.instance.clientInstanceId,
      keyId: current.keys.keyId,
      publicKeySpki: current.keys.publicKeySpki,
      identityHash: sharingIdentityHash(current.instance.clientInstanceId, current.keys.publicKeySpki),
      remoteInstallationId: existing.installationId,
      credentialExpiresAtMs: Date.parse(tokenExpiresAt),
      state: 'active',
      recoveryPublicKeySpki: null,
    })
    return credentials
  }

  activate() {
    if (!this.inFlight) {
      const operation = this.activateInternal()
      const tracked = operation.finally(() => {
        if (this.inFlight === tracked) this.inFlight = null
      })
      this.inFlight = tracked
    }
    return this.inFlight
  }

  async signedFetch(pathname, { method = 'POST', body = new Uint8Array(), scope = 'publication:write', headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (scope === 'publication:write') await this.publicationReadiness()
    const { instance, keys } = await this.ensure()
    let credentials = await this.readCredentials(instance)
    if (!credentials) credentials = await this.activate()
    if (credentials.renewalRequired || Date.parse(credentials.tokenExpiresAt) <= this.now().getTime() + TOKEN_REFRESH_MARGIN_MS || !credentials.scopes.includes(scope)) credentials = await this.activateInternal({ forceRefresh: true })
    if (!credentials.scopes.includes(scope)) {
      const error = new Error(`lab.gd did not grant the required ${scope} scope.`)
      error.code = 'sharing-scope-unavailable'
      throw error
    }
    const bytes = ArrayBuffer.isView(body)
      ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
      : body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : new TextEncoder().encode(body)
    return this.request(pathname, {
      method,
      body: bytes,
      headers: { ...headers, ...signedRequestHeaders({ token: credentials.token, body: bytes, scope, privateKey: keys.privateKey, now: this.now() }) },
      timeoutMs,
    })
  }

  async rotateKey() {
    await this.activate()
    const current = await this.ensure()
    const credentials = await this.readCredentials(current.instance)
    const candidatePath = `${this.privateKeyPath}.${process.pid}.${Date.now()}.candidate`
    const replacement = await this.ensureKeyPair(candidatePath)
    const body = new TextEncoder().encode(JSON.stringify({ publicKeySpki: replacement.publicKeySpki }))
    let retainCandidate = false
    try {
      const response = await this.signedFetch('/v1/installations/rotate', {
        body,
        headers: { 'content-type': 'application/json' },
        scope: 'key:rotate',
      })
      const result = await boundedJson(response)
      if (response.status === 409 && result.status === 'recovery-pending') {
        await fs.rm(this.recoveryKeyPath, { force: true })
        await fs.rename(candidatePath, this.recoveryKeyPath)
        await fs.chmod(this.recoveryKeyPath, 0o600)
        retainCandidate = true
        this.repository.saveInstallationProjection({
          clientInstanceId: current.instance.clientInstanceId,
          keyId: current.keys.keyId,
          publicKeySpki: current.keys.publicKeySpki,
          identityHash: sharingIdentityHash(current.instance.clientInstanceId, current.keys.publicKeySpki),
          remoteInstallationId: credentials?.installationId ?? current.projection.remoteInstallationId,
          credentialExpiresAtMs: credentials ? Date.parse(credentials.tokenExpiresAt) : null,
          state: 'recovery-pending',
          recoveryPublicKeySpki: replacement.publicKeySpki,
        })
        throw new SharingRecoveryPendingError()
      }
      if (!response.ok || result.status !== 'active' || result.installationId !== current.projection.remoteInstallationId) {
        throw httpError(response, result, 'labgd-rotation-failed')
      }
      await fs.rename(candidatePath, this.privateKeyPath)
      await fs.chmod(this.privateKeyPath, 0o600)
      this.repository.saveInstallationProjection({
        clientInstanceId: current.instance.clientInstanceId,
        keyId: replacement.keyId,
        publicKeySpki: replacement.publicKeySpki,
        identityHash: sharingIdentityHash(current.instance.clientInstanceId, replacement.publicKeySpki),
        remoteInstallationId: current.projection.remoteInstallationId,
        credentialExpiresAtMs: credentials ? Date.parse(credentials.tokenExpiresAt) : null,
        state: 'active',
        recoveryPublicKeySpki: null,
      })
      return credentials
    } finally {
      const candidates = retainCandidate
        ? []
        : (await fs.readdir(this.directory).catch(() => [])).filter((name) => name.startsWith('installation-ed25519.pem.') && name.endsWith('.candidate'))
      await Promise.all(candidates.map((name) => fs.rm(path.join(this.directory, name), { force: true })))
    }
  }

  async resumeRecovery() {
    try {
      await fs.access(this.recoveryKeyPath)
      return await this.activateInternal({ keyPath: this.recoveryKeyPath, promoteRecovery: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      return this.activate()
    }
  }

  async createClaimDevice() {
    const body = new Uint8Array()
    const response = await this.signedFetch('/v1/installations/claim-device', {
      body,
      scope: 'claim:create',
    })
    const result = await boundedJson(response)
    if (response.status === 409 && result.code === 'installation-already-claimed') {
      const account = await this.reconcileAccountStatus()
      return { state: 'claimed', account }
    }
    if (
      !response.ok || result.state !== 'pending'
      || !hasExactKeys(result, ['claimId', 'userCode', 'verificationUrl', 'expiresAt', 'state'])
      || typeof result.claimId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(result.claimId)
      || typeof result.userCode !== 'string' || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u.test(result.userCode)
      || !validClaimUrl(result.verificationUrl)
      || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= this.now().getTime()
    ) {
      const error = new Error('lab.gd returned an invalid account claim response.')
      error.code = 'labgd-claim-device-failed'
      throw error
    }
    return { claimId: result.claimId, userCode: result.userCode, verificationUrl: result.verificationUrl, expiresAt: result.expiresAt, state: result.state }
  }

  async accountStatus() {
    if (this.getCapabilities().installationAccountStatus !== true) return null
    const response = await this.signedFetch('/v1/installations/account-status', {
      method: 'GET',
      body: new Uint8Array(),
      scope: 'claim:create',
    })
    const result = await boundedJson(response)
    const usernameIsValid = result.githubUsername === null
      || (typeof result.githubUsername === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(result.githubUsername))
    const claimedAtIsValid = result.claimedAt === null
      || (typeof result.claimedAt === 'string' && Number.isFinite(Date.parse(result.claimedAt)) && new Date(result.claimedAt).toISOString() === result.claimedAt)
    const unclaimedIsEmpty = result.claimed !== false || (result.githubUsername === null && result.claimedAt === null)
    if (!response.ok || !hasExactKeys(result, ['claimed', 'githubUsername', 'claimedAt']) || typeof result.claimed !== 'boolean' || !usernameIsValid || !claimedAtIsValid || !unclaimedIsEmpty) {
      const error = new Error('lab.gd returned an invalid installation account status.')
      error.code = 'labgd-account-status-failed'
      throw error
    }
    return {
      claimed: result.claimed,
      githubUsername: result.githubUsername,
      accountClaimedAtMs: result.claimedAt === null ? null : Date.parse(result.claimedAt),
    }
  }

  async reconcileAccountStatus(eventCursor) {
    const status = await this.accountStatus()
    if (status) this.repository.reconcileInstallationAccount(status, eventCursor)
    return status
  }
}

function validClaimUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.href === 'https://app.lab.gd/claim'
  } catch {
    return false
  }
}

function normalizeGrantedScopes(value) {
  const scopes = normalizeCredentialScopeSet(value)
  if (!scopes || !sameScopeSet(scopes, SHARING_TOKEN_SCOPES)) {
    throw new SharingUnsupportedError('lab.gd returned unsupported installation token scopes.')
  }
  return [...scopes]
}

function normalizeCredentialScopeSet(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > SHARING_TOKEN_SCOPES.length || value.some((scope) => typeof scope !== 'string' || !SHARING_TOKEN_SCOPES.includes(scope)) || new Set(value).size !== value.length) return null
  if (!sameScopeSet(value, SHARING_TOKEN_SCOPES) && !sameScopeSet(value, LEGACY_SHARING_TOKEN_SCOPES)) return null
  return value
}

function sameScopeSet(actual, expected) {
  return actual.length === expected.length && expected.every((scope) => actual.includes(scope))
}

function normalizeTokenExpiry(value, now) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now.getTime()) throw new SharingUnsupportedError('lab.gd returned an invalid token expiry.')
  return value
}

function assertExpectedInstallation(expectedInstallationId, actualInstallationId) {
  if (expectedInstallationId == null || expectedInstallationId === actualInstallationId) return
  throw installationIdentityMismatch()
}

function installationIdentityMismatch() {
  const error = new Error('lab.gd returned a different logical installation during credential recovery.')
  error.code = 'sharing-installation-identity-mismatch'
  return error
}

function hasExactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

async function boundedJson(response, maximumBytes = 64 * 1024) {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > maximumBytes) throw new Error('lab.gd response exceeded the allowed size.')
  const text = await response.text()
  if (Buffer.byteLength(text) > maximumBytes) throw new Error('lab.gd response exceeded the allowed size.')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error('lab.gd returned invalid JSON.')
  }
}

function retryAfterMs(response) {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 60 * 60_000) : null
}

function httpError(response, body, fallbackCode) {
  const error = new Error(typeof body?.message === 'string' ? body.message : `lab.gd request failed with HTTP ${response.status}.`)
  error.code = typeof body?.code === 'string' ? body.code : typeof body?.error === 'string' ? body.error : fallbackCode
  error.retryAfterMs = retryAfterMs(response)
  return error
}
