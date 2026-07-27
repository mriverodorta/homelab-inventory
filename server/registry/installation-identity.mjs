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
  installationPublicKeyId,
  signedRequestPayload,
} from '../../packages/catalog-protocol/src/index.ts'

const DEFAULT_REGISTRY_ORIGIN = 'https://registry.homelabinventory.com'
const REQUEST_TIMEOUT_MS = 15_000

async function responseJson(response, fallback) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.message ?? `${fallback} (HTTP ${response.status}).`)
  return payload
}

export class InstallationIdentityService {
  constructor({ dataDir, officialOrigin = DEFAULT_REGISTRY_ORIGIN, fetchImpl = globalThis.fetch } = {}) {
    this.directory = path.join(dataDir, 'registry')
    this.privateKeyPath = path.join(this.directory, 'installation-ed25519.pem')
    this.credentialsPath = path.join(this.directory, 'installation-credentials.json')
    this.officialOrigin = new URL(officialOrigin).origin
    this.fetchImpl = fetchImpl
  }

  async ensureKeyPair() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    await fs.chmod(this.directory, 0o700)
    try {
      await fs.access(this.privateKeyPath)
    } catch {
      const { privateKey } = generateKeyPairSync('ed25519')
      await fs.writeFile(this.privateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
        encoding: 'utf8', mode: 0o600, flag: 'wx',
      })
    }
    await fs.chmod(this.privateKeyPath, 0o600)
    const privateKey = createPrivateKey(await fs.readFile(this.privateKeyPath, 'utf8'))
    const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
    return { privateKey, publicKey, publicKeyId: await installationPublicKeyId(publicKey) }
  }

  async readCredentials() {
    try {
      const credentials = JSON.parse(await fs.readFile(this.credentialsPath, 'utf8'))
      return credentials?.token && credentials?.tokenExpiresAt ? credentials : null
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async writeCredentials(credentials) {
    const temporary = `${this.credentialsPath}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
    await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, this.credentialsPath)
    await fs.chmod(this.credentialsPath, 0o600)
  }

  async post(pathname, body, headers = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await this.fetchImpl(new URL(pathname, this.officialOrigin), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async activate(store, now = new Date()) {
    const keys = await this.ensureKeyPair()
    const challenge = await responseJson(
      await this.post('/v1/installations/challenge', { publicKey: keys.publicKey }),
      'Registry installation challenge failed',
    )
    if (challenge.publicKey !== keys.publicKey || challenge.publicKeyId !== keys.publicKeyId) {
      throw new Error('Registry installation challenge does not match this installation key.')
    }
    const signature = sign(
      null,
      Buffer.from(activationSignaturePayload(challenge)),
      keys.privateKey,
    ).toString('base64url')
    const activation = await responseJson(
      await this.post('/v1/installations/activate', { challengeKey: challenge.challengeKey, signature }),
      'Registry installation activation failed',
    )
    const credentials = {
      installationKey: activation.installationKey,
      publicKeyId: keys.publicKeyId,
      token: activation.token,
      tokenScope: activation.tokenScope,
      tokenExpiresAt: activation.tokenExpiresAt,
    }
    await this.writeCredentials(credentials)
    store.registryTransaction((draft) => {
      draft.installationIdentity = {
        installationKey: credentials.installationKey,
        publicKeyId: credentials.publicKeyId,
        state: 'active',
        activatedAt: now.toISOString(),
        tokenExpiresAt: credentials.tokenExpiresAt,
        revokedAt: null,
      }
    })
    return credentials
  }

  async credentials(store, now = new Date()) {
    const credentials = await this.readCredentials()
    if (credentials && Date.parse(credentials.tokenExpiresAt) > now.getTime() + 30_000) return credentials
    return this.activate(store, now)
  }

  async signedPost(store, pathname, body, now = new Date()) {
    const credentials = await this.credentials(store, now)
    const { privateKey } = await this.ensureKeyPair()
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

  async revoke(store, { disable = true } = {}) {
    const credentials = await this.readCredentials()
    if (credentials) {
      await responseJson(await this.signedPost(store, '/v1/installations/revoke', {}), 'Registry revocation failed')
    }
    await fs.rm(this.credentialsPath, { force: true })
    store.registryTransaction((draft) => {
      if (draft.installationIdentity) {
        draft.installationIdentity.state = 'revoked'
        draft.installationIdentity.revokedAt = new Date().toISOString()
        draft.installationIdentity.tokenExpiresAt = null
      }
      if (disable) draft.settings.automaticContributions = false
      draft.settings.updatedAt = new Date().toISOString()
    })
  }

  async rotate(store) {
    const enabled = store.getRegistryState().settings.automaticContributions === true
    await this.revoke(store, { disable: false })
    await fs.rm(this.privateKeyPath, { force: true })
    store.registryTransaction((draft) => { draft.installationIdentity = null })
    const credentials = await this.activate(store)
    if (enabled) store.registryTransaction((draft) => { draft.settings.automaticContributions = true })
    return credentials
  }
}
