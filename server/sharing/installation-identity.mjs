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
const TOKEN_LIFETIME_MS = 10 * 60_000
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
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1
    || value.clientInstanceId !== clientInstanceId
    || !Number.isSafeInteger(value.installationId) || value.installationId <= 0
    || typeof value.token !== 'string' || value.token.length < 16 || value.token.length > 4096
    || !Array.isArray(value.scopes) || value.scopes.some((scope) => !SHARING_TOKEN_SCOPES.includes(scope))
    || typeof value.tokenExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.tokenExpiresAt))
  ) return null
  return {
    version: 1,
    clientInstanceId,
    installationId: value.installationId,
    token: value.token,
    scopes: [...value.scopes],
    tokenExpiresAt: value.tokenExpiresAt,
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
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await this.fetchImpl(url, {
        method,
        headers: { accept: 'application/json', ...headers },
        ...(body == null ? {} : { body }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async readiness() {
    const response = await this.request('/readyz')
    const body = await boundedJson(response)
    if (body.contractMode !== 'packages-enabled') throw new SharingUnsupportedError()
    if (body.status !== 'ready' || body.publicationReady !== true) {
      const error = new Error('lab.gd is not ready for publication.')
      error.code = 'labgd-unavailable'
      error.retryAfterMs = retryAfterMs(response)
      throw error
    }
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

  getCapabilities() {
    return this.remoteCapabilities ?? {}
  }

  async activateInternal({ keyPath = this.privateKeyPath, promoteRecovery = false, forceRefresh = false } = {}) {
    await this.readiness()
    const current = await this.ensure()
    const { instance } = current
    const keys = keyPath === this.privateKeyPath ? current.keys : await this.ensureKeyPair(keyPath)
    const existing = await this.readCredentials(instance)
    if (!promoteRecovery && !forceRefresh && existing && Date.parse(existing.tokenExpiresAt) > this.now().getTime() + TOKEN_REFRESH_MARGIN_MS) {
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
    const issuedAt = this.now()
    const scopes = activation.scopes == null ? [...LEGACY_SHARING_TOKEN_SCOPES] : normalizeGrantedScopes(activation.scopes)
    const tokenExpiresAt = typeof activation.tokenExpiresAt === 'string' && Number.isFinite(Date.parse(activation.tokenExpiresAt))
      ? activation.tokenExpiresAt
      : new Date(issuedAt.getTime() + TOKEN_LIFETIME_MS).toISOString()
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
    const { instance, keys } = await this.ensure()
    let credentials = await this.readCredentials(instance)
    if (!credentials || Date.parse(credentials.tokenExpiresAt) <= this.now().getTime() + TOKEN_REFRESH_MARGIN_MS) credentials = await this.activate()
    if (!credentials.scopes.includes(scope)) credentials = await this.activateInternal({ forceRefresh: true })
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
    if (
      !response.ok || result.state !== 'pending'
      || typeof result.claimId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(result.claimId)
      || typeof result.userCode !== 'string' || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u.test(result.userCode)
      || !validClaimUrl(result.verificationUrl, this.labGdOrigin)
      || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))
    ) {
      throw httpError(response, result, 'labgd-claim-device-failed')
    }
    return result
  }
}

function validClaimUrl(value, labGdOrigin) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && new URL(labGdOrigin).hostname === 'localhost' && url.hostname === 'localhost'
  } catch {
    return false
  }
}

function normalizeGrantedScopes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((scope) => typeof scope !== 'string' || !SHARING_TOKEN_SCOPES.includes(scope))) {
    throw new SharingUnsupportedError('lab.gd returned unsupported installation token scopes.')
  }
  return [...new Set(value)]
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
