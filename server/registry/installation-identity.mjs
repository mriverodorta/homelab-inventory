import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto'
import {
  activationSignaturePayload,
  CONTRIBUTION_TOKEN_SCOPE,
  installationPublicKeyId,
  signedRequestPayload,
} from '../../packages/catalog-protocol/src/index.ts'
import { ensureInstallationInstance } from './installation-instance.mjs'
import { readRegistryJson, registryErrorMessage } from './response-json.mjs'

const DEFAULT_REGISTRY_ORIGIN = 'https://registry.homelabinventory.com'
const REQUEST_TIMEOUT_MS = 15_000
const CREDENTIAL_REFRESH_MARGIN_MS = 30_000

function validCredentialString(value, maximum = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

export function normalizeInstallationCredentials(value, { clientInstanceId = null, allowLegacy = true } = {}) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !validCredentialString(value.installationKey, 256)
    || typeof value.publicKeyId !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.publicKeyId)
    || !validCredentialString(value.token)
    || value.tokenScope !== CONTRIBUTION_TOKEN_SCOPE
    || !validCredentialString(value.tokenExpiresAt, 128)
    || !Number.isFinite(Date.parse(value.tokenExpiresAt))
    || (!allowLegacy && !validCredentialString(value.clientInstanceId, 64))
  ) return null
  if (value.clientInstanceId !== undefined && value.clientInstanceId !== clientInstanceId) {
    throw new Error('Registry credentials belong to a different installation instance.')
  }
  return {
    installationKey: value.installationKey,
    publicKeyId: value.publicKeyId,
    token: value.token,
    tokenScope: value.tokenScope,
    tokenExpiresAt: value.tokenExpiresAt,
    ...(value.clientInstanceId ? { clientInstanceId: value.clientInstanceId } : {}),
  }
}

function generatedKeyPair() {
  const { privateKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
  return { privateKey, privateKeyPem, publicKey }
}

async function writePrivateTemporary(filePath, body) {
  await fs.writeFile(filePath, body, { mode: 0o600, flag: 'wx' })
  await fs.chmod(filePath, 0o600)
}

export class InstallationRecoveryError extends Error {
  constructor(message, { state, recoveryKey = null } = {}) {
    super(message)
    this.name = 'InstallationRecoveryError'
    this.code = state === 'recovery-pending' ? 'installation-recovery-pending' : 'installation-recovery-rejected'
    this.state = state
    this.recoveryKey = recoveryKey
  }
}

export class InstallationIdentityService {
  constructor({ dataDir, officialOrigin = DEFAULT_REGISTRY_ORIGIN, fetchImpl = globalThis.fetch } = {}) {
    this.dataDir = dataDir
    this.directory = path.join(dataDir, 'registry')
    this.instancePath = path.join(this.directory, 'installation-instance.json')
    this.privateKeyPath = path.join(this.directory, 'installation-ed25519.pem')
    this.credentialsPath = path.join(this.directory, 'installation-credentials.json')
    this.rotationKeyBackupPath = path.join(this.directory, '.installation-ed25519.rotation-backup.pem')
    this.rotationCredentialsBackupPath = path.join(this.directory, '.installation-credentials.rotation-backup.json')
    this.officialOrigin = new URL(officialOrigin).origin
    this.fetchImpl = fetchImpl
    this.credentialsInFlight = null
    this.identityMutation = null
  }

  async ensureInstance() {
    return ensureInstallationInstance(this.dataDir)
  }

  async recoverInterruptedRotation() {
    const exists = async (filePath) => fs.access(filePath).then(() => true, () => false)
    const keyBackup = await exists(this.rotationKeyBackupPath)
    const credentialsBackup = await exists(this.rotationCredentialsBackupPath)
    if (!keyBackup && !credentialsBackup) return
    if (!keyBackup || !credentialsBackup) {
      throw new Error('Registry key rotation recovery files are incomplete.')
    }
    const currentKey = await exists(this.privateKeyPath)
    const currentCredentials = await exists(this.credentialsPath)
    if (currentKey && currentCredentials) {
      await fs.rm(this.rotationKeyBackupPath, { force: true })
      await fs.rm(this.rotationCredentialsBackupPath, { force: true })
      return
    }
    await fs.rm(this.privateKeyPath, { force: true })
    await fs.rm(this.credentialsPath, { force: true })
    await fs.rename(this.rotationKeyBackupPath, this.privateKeyPath)
    await fs.rename(this.rotationCredentialsBackupPath, this.credentialsPath)
    await fs.chmod(this.privateKeyPath, 0o600)
    await fs.chmod(this.credentialsPath, 0o600)
  }

  async ensureKeyPair() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    await fs.chmod(this.directory, 0o700)
    await this.recoverInterruptedRotation()
    try {
      await fs.access(this.privateKeyPath)
    } catch {
      const keys = generatedKeyPair()
      await fs.writeFile(this.privateKeyPath, keys.privateKeyPem, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    }
    await fs.chmod(this.privateKeyPath, 0o600)
    const privateKey = createPrivateKey(await fs.readFile(this.privateKeyPath, 'utf8'))
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Registry installation key must be Ed25519.')
    const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
    return { privateKey, publicKey, publicKeyId: await installationPublicKeyId(publicKey) }
  }

  async readCredentials(instance = null) {
    const expected = instance ?? await this.ensureInstance()
    try {
      const credentials = normalizeInstallationCredentials(
        JSON.parse(await fs.readFile(this.credentialsPath, 'utf8')),
        { clientInstanceId: expected.clientInstanceId },
      )
      if (!credentials) throw new Error('Registry installation credentials are invalid.')
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
      await writePrivateTemporary(temporary, `${JSON.stringify(credentials, null, 2)}\n`)
      await fs.rename(temporary, this.credentialsPath)
      await fs.chmod(this.credentialsPath, 0o600)
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {})
    }
  }

  async post(pathname, body, headers = {}) {
    if (typeof pathname !== 'string' || !pathname.startsWith('/v1/')) {
      throw new Error('Registry request path is invalid.')
    }
    const target = new URL(pathname, this.officialOrigin)
    if (target.origin !== this.officialOrigin) throw new Error('Registry request origin is invalid.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await this.fetchImpl(target, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  publicIdentity(credentials, instance, now, previous = null) {
    return {
      installationKey: credentials.installationKey,
      publicKeyId: credentials.publicKeyId,
      clientInstanceId: instance.clientInstanceId,
      state: 'active',
      activatedAt: previous?.activatedAt ?? now.toISOString(),
      tokenExpiresAt: credentials.tokenExpiresAt,
      recoveryKey: null,
      lastError: null,
      revokedAt: null,
    }
  }

  reconcileActive(store, credentials, instance, now = new Date()) {
    const previous = store.getRegistryState().installationIdentity
    store.registryTransaction((draft) => {
      draft.installationIdentity = this.publicIdentity(credentials, instance, now, previous)
    })
  }

  recordRecovery(store, { instance, keys, credentials, payload }) {
    const previous = store.getRegistryState().installationIdentity
    const pending = payload?.code === 'installation-recovery-pending' && validCredentialString(payload.recoveryKey, 128)
    const state = pending ? 'recovery-pending' : 'rejected'
    const message = registryErrorMessage(payload, 'Registry installation recovery failed', 409)
    store.registryTransaction((draft) => {
      draft.installationIdentity = {
        installationKey: credentials?.installationKey ?? previous?.installationKey ?? instance.clientInstanceId,
        publicKeyId: keys.publicKeyId,
        clientInstanceId: instance.clientInstanceId,
        state,
        activatedAt: previous?.activatedAt ?? null,
        tokenExpiresAt: null,
        recoveryKey: pending ? payload.recoveryKey : previous?.recoveryKey ?? null,
        lastError: message,
        revokedAt: null,
      }
    })
    throw new InstallationRecoveryError(message, {
      state,
      recoveryKey: pending ? payload.recoveryKey : previous?.recoveryKey ?? null,
    })
  }

  async activateInternal(store, now = new Date()) {
    const instance = await this.ensureInstance()
    const keys = await this.ensureKeyPair()
    const existingCredentials = await this.readCredentials(instance)
    const challengeResponse = await this.post('/v1/installations/challenge', {
      publicKey: keys.publicKey,
      clientInstanceId: instance.clientInstanceId,
    })
    const challenge = await readRegistryJson(challengeResponse)
    if (!challengeResponse.ok) {
      throw new Error(registryErrorMessage(challenge, 'Registry installation challenge failed', challengeResponse.status))
    }
    if (
      challenge.publicKey !== keys.publicKey
      || challenge.publicKeyId !== keys.publicKeyId
      || challenge.clientInstanceId !== instance.clientInstanceId
    ) {
      throw new Error('Registry installation challenge does not match this installation identity.')
    }
    const signature = sign(null, Buffer.from(activationSignaturePayload(challenge)), keys.privateKey).toString('base64url')
    const activationResponse = await this.post('/v1/installations/activate', {
      challengeKey: challenge.challengeKey,
      signature,
    })
    const activation = await readRegistryJson(activationResponse)
    if (!activationResponse.ok) {
      if (activationResponse.status === 409) {
        this.recordRecovery(store, { instance, keys, credentials: existingCredentials, payload: activation })
      }
      throw new Error(registryErrorMessage(activation, 'Registry installation activation failed', activationResponse.status))
    }
    const credentials = normalizeInstallationCredentials({
      ...activation,
      publicKeyId: keys.publicKeyId,
      clientInstanceId: instance.clientInstanceId,
    }, { clientInstanceId: instance.clientInstanceId, allowLegacy: false })
    if (!credentials) throw new Error('Registry returned invalid installation credentials.')
    await this.writeCredentials(credentials)
    this.reconcileActive(store, credentials, instance, now)
    return credentials
  }

  runIdentityMutation(operation) {
    const previous = this.identityMutation
    const running = (async () => {
      await previous?.catch(() => {})
      await this.credentialsInFlight?.catch(() => {})
      return operation()
    })()
    const tracked = running.finally(() => {
      if (this.identityMutation === tracked) this.identityMutation = null
    })
    this.identityMutation = tracked
    return tracked
  }

  activate(store, now = new Date()) {
    return this.runIdentityMutation(() => this.activateInternal(store, now))
  }

  async initialize(store, now = new Date()) {
    const instance = await this.ensureInstance()
    const keys = await this.ensureKeyPair()
    const credentials = await this.readCredentials(instance)
    const identity = store.getRegistryState().installationIdentity
    if (['recovery-pending', 'rejected'].includes(identity?.state) && identity.publicKeyId === keys.publicKeyId) return identity
    if (credentials?.publicKeyId === keys.publicKeyId && credentials.clientInstanceId === instance.clientInstanceId) {
      this.reconcileActive(store, credentials, instance, now)
      return store.getRegistryState().installationIdentity
    }
    const shouldAdoptLegacy = credentials?.publicKeyId === keys.publicKeyId && credentials?.clientInstanceId === undefined
    const shouldRecoverKey = credentials && credentials.publicKeyId !== keys.publicKeyId
    const shouldRenewCredentials = !credentials && identity?.installationKey
    if (!shouldAdoptLegacy && !shouldRecoverKey && !shouldRenewCredentials) return identity
    try {
      await this.activate(store, now)
    } catch (error) {
      if (error instanceof InstallationRecoveryError) return store.getRegistryState().installationIdentity
      if (credentials) {
        store.registryTransaction((draft) => {
          draft.installationIdentity = {
            installationKey: credentials.installationKey,
            publicKeyId: keys.publicKeyId,
            clientInstanceId: instance.clientInstanceId,
            state: shouldRecoverKey ? 'recovery-pending' : 'active',
            activatedAt: identity?.activatedAt ?? now.toISOString(),
            tokenExpiresAt: credentials.tokenExpiresAt,
            recoveryKey: null,
            lastError: error instanceof Error ? error.message : 'Registry identity migration failed.',
            revokedAt: null,
          }
        })
        return store.getRegistryState().installationIdentity
      }
      throw error
    }
    return store.getRegistryState().installationIdentity
  }

  async credentials(store, now = new Date()) {
    await this.identityMutation?.catch(() => {})
    return this.resolveCredentials(store, now)
  }

  async resolveCredentials(store, now = new Date()) {
    const identity = store.getRegistryState().installationIdentity
    if (['recovery-pending', 'rejected'].includes(identity?.state)) {
      throw new InstallationRecoveryError(identity.lastError ?? 'Registry installation recovery requires owner action.', {
        state: identity.state,
        recoveryKey: identity.recoveryKey,
      })
    }
    if (!this.credentialsInFlight) {
      const operation = (async () => {
        const instance = await this.ensureInstance()
        const credentials = await this.readCredentials(instance)
        const keys = await this.ensureKeyPair()
        if (
          credentials
          && credentials.publicKeyId === keys.publicKeyId
          && credentials.clientInstanceId === instance.clientInstanceId
          && Date.parse(credentials.tokenExpiresAt) > now.getTime() + CREDENTIAL_REFRESH_MARGIN_MS
        ) {
          this.reconcileActive(store, credentials, instance, now)
          return credentials
        }
        return this.activateInternal(store, now)
      })()
      const inFlight = operation.finally(() => {
        if (this.credentialsInFlight === inFlight) this.credentialsInFlight = null
      })
      this.credentialsInFlight = inFlight
    }
    return this.credentialsInFlight
  }

  resumeRecovery(store) {
    return this.runIdentityMutation(() => this.activateInternal(store, new Date()))
  }

  resetRecovery(store) {
    return this.runIdentityMutation(async () => {
      const identity = store.getRegistryState().installationIdentity
      if (!['recovery-pending', 'rejected'].includes(identity?.state)) {
        throw new Error('Registry enrollment is not awaiting recovery.')
      }
      await fs.rm(this.credentialsPath, { force: true })
      await fs.rm(this.privateKeyPath, { force: true })
      store.registryTransaction((draft) => {
        draft.installationIdentity = null
        draft.settings.automaticContributions = false
        draft.settings.updatedAt = new Date().toISOString()
      })
    })
  }

  async signedPost(store, pathname, body, now = new Date(), providedCredentials = null, providedPrivateKey = null) {
    const credentials = providedCredentials ?? await this.credentials(store, now)
    const privateKey = providedPrivateKey ?? (await this.ensureKeyPair()).privateKey
    const timestamp = now.toISOString()
    const nonce = randomBytes(24).toString('base64url')
    const signature = sign(null, Buffer.from(await signedRequestPayload({
      method: 'POST', path: pathname, timestamp, nonce, body,
    })), privateKey).toString('base64url')
    return this.post(pathname, body, {
      authorization: `Bearer ${credentials.token}`,
      'x-hli-key-id': credentials.publicKeyId,
      'x-hli-timestamp': timestamp,
      'x-hli-nonce': nonce,
      'x-hli-signature': signature,
    })
  }

  async revokeInternal(store, { disable = true } = {}) {
    const instance = await this.ensureInstance()
    const credentials = await this.readCredentials(instance)
    if (credentials) {
      const current = await this.resolveCredentials(store, new Date())
      const response = await this.signedPost(store, '/v1/installations/revoke', {}, new Date(), current)
      const payload = await readRegistryJson(response)
      if (!response.ok) throw new Error(registryErrorMessage(payload, 'Registry revocation failed', response.status))
    }
    await fs.rm(this.credentialsPath, { force: true })
    store.registryTransaction((draft) => {
      if (draft.installationIdentity) {
        draft.installationIdentity.state = 'revoked'
        draft.installationIdentity.revokedAt = new Date().toISOString()
        draft.installationIdentity.tokenExpiresAt = null
        draft.installationIdentity.recoveryKey = null
        draft.installationIdentity.lastError = null
      }
      if (disable) draft.settings.automaticContributions = false
      draft.settings.updatedAt = new Date().toISOString()
    })
  }

  revoke(store, options) {
    return this.runIdentityMutation(() => this.revokeInternal(store, options))
  }

  async commitRotatedFiles(privateKeyPem, credentials) {
    const keyTemporary = `${this.privateKeyPath}.${process.pid}.${Date.now()}.rotate.tmp`
    const credentialsTemporary = `${this.credentialsPath}.${process.pid}.${Date.now()}.rotate.tmp`
    try {
      await writePrivateTemporary(keyTemporary, privateKeyPem)
      await writePrivateTemporary(credentialsTemporary, `${JSON.stringify(credentials, null, 2)}\n`)
      await fs.rename(this.privateKeyPath, this.rotationKeyBackupPath)
      try {
        await fs.rename(this.credentialsPath, this.rotationCredentialsBackupPath)
      } catch (error) {
        await fs.rename(this.rotationKeyBackupPath, this.privateKeyPath)
        throw error
      }
      try {
        await fs.rename(keyTemporary, this.privateKeyPath)
        await fs.rename(credentialsTemporary, this.credentialsPath)
        await fs.chmod(this.privateKeyPath, 0o600)
        await fs.chmod(this.credentialsPath, 0o600)
      } catch (error) {
        await fs.rm(this.privateKeyPath, { force: true })
        await fs.rm(this.credentialsPath, { force: true })
        await fs.rename(this.rotationKeyBackupPath, this.privateKeyPath)
        await fs.rename(this.rotationCredentialsBackupPath, this.credentialsPath)
        throw error
      }
      await fs.rm(this.rotationKeyBackupPath, { force: true })
      await fs.rm(this.rotationCredentialsBackupPath, { force: true })
    } finally {
      await fs.rm(keyTemporary, { force: true }).catch(() => {})
      await fs.rm(credentialsTemporary, { force: true }).catch(() => {})
    }
  }

  rotate(store) {
    return this.runIdentityMutation(async () => {
      const now = new Date()
      const instance = await this.ensureInstance()
      const credentials = await this.resolveCredentials(store, now)
      const currentKeys = await this.ensureKeyPair()
      const replacement = generatedKeyPair()
      const replacementPublicKeyId = await installationPublicKeyId(replacement.publicKey)
      const candidatePath = path.join(this.directory, `.installation-ed25519.${process.pid}.${Date.now()}.candidate.pem`)
      try {
        await writePrivateTemporary(candidatePath, replacement.privateKeyPem)
        const body = { clientInstanceId: instance.clientInstanceId, publicKey: replacement.publicKey }
        const response = await this.signedPost(store, '/v1/installations/rotate', body, now, credentials, currentKeys.privateKey)
        const payload = await readRegistryJson(response)
        if (!response.ok) throw new Error(registryErrorMessage(payload, 'Registry key rotation failed', response.status))
        if (payload?.installationKey !== credentials.installationKey) {
          throw new Error('Registry key rotation changed the logical installation unexpectedly.')
        }
        if (payload?.publicKeyId !== undefined && payload.publicKeyId !== replacementPublicKeyId) {
          throw new Error('Registry key rotation returned a different replacement key.')
        }
        const rotated = normalizeInstallationCredentials({
          ...payload,
          publicKeyId: replacementPublicKeyId,
          clientInstanceId: instance.clientInstanceId,
        }, { clientInstanceId: instance.clientInstanceId, allowLegacy: false })
        if (!rotated) throw new Error('Registry returned invalid rotated credentials.')
        await this.commitRotatedFiles(replacement.privateKeyPem, rotated)
        this.reconcileActive(store, rotated, instance, now)
        return rotated
      } finally {
        await fs.rm(candidatePath, { force: true }).catch(() => {})
      }
    })
  }
}
