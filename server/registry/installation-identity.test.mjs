import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installationPublicKeyId } from '../../packages/catalog-protocol/src/index.ts'
import { InstallationIdentityService, InstallationRecoveryError } from './installation-identity.mjs'
import { createRegistryStore } from './model.mjs'

const directories = []
const INSTALLATION_KEY = '22222222-2222-4222-8222-222222222222'
const RECOVERY_KEY = '33333333-4444-4555-8666-777777777777'
const FUTURE = '2099-01-01T00:00:00.000Z'

afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))))

function storeFixture() {
  let registry = createRegistryStore()
  return {
    getRegistryState: () => structuredClone(registry),
    registryTransaction(mutator) {
      const draft = structuredClone(registry)
      mutator(draft)
      registry = draft
      return this.getRegistryState()
    },
  }
}

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-installation-'))
  directories.push(dataDir)
  const requests = []
  let activation = 'success'
  let rotation = 'success'
  const fetchImpl = vi.fn(async (url, options) => {
    const pathname = new URL(url).pathname
    const body = JSON.parse(options.body)
    requests.push({ pathname, body, headers: options.headers })
    if (pathname.endsWith('/challenge')) {
      return new Response(JSON.stringify({
        challengeKey: 'aaaaaaaa-1111-4111-8111-111111111111',
        nonce: 'a'.repeat(32),
        publicKeyId: await installationPublicKeyId(body.publicKey),
        publicKey: body.publicKey,
        clientInstanceId: body.clientInstanceId,
        expiresAt: FUTURE,
      }), { status: 201 })
    }
    if (pathname.endsWith('/activate')) {
      if (activation === 'unavailable') return new Response(JSON.stringify({ message: 'Registry unavailable.' }), { status: 503 })
      if (activation === 'pending') return new Response(JSON.stringify({
        message: 'Installation key recovery requires owner approval.',
        code: 'installation-recovery-pending',
        recoveryKey: RECOVERY_KEY,
      }), { status: 409 })
      if (activation === 'rejected') return new Response(JSON.stringify({
        message: 'Installation key recovery was rejected by the owner.',
      }), { status: 409 })
      return new Response(JSON.stringify({
        installationKey: INSTALLATION_KEY,
        token: 't'.repeat(43),
        tokenScope: 'contributions:write',
        tokenExpiresAt: FUTURE,
      }), { status: 201 })
    }
    if (pathname.endsWith('/rotate')) {
      if (rotation === 'failure') return new Response(JSON.stringify({ message: 'Rotation unavailable.' }), { status: 503 })
      return new Response(JSON.stringify({
        installationKey: INSTALLATION_KEY,
        token: 'r'.repeat(43),
        tokenScope: 'contributions:write',
        tokenExpiresAt: FUTURE,
      }))
    }
    return new Response(JSON.stringify({ revoked: true }))
  })
  const service = new InstallationIdentityService({ dataDir, officialOrigin: 'http://127.0.0.1', fetchImpl })
  return {
    dataDir,
    fetchImpl,
    requests,
    service,
    store: storeFixture(),
    setActivation(value) { activation = value },
    setRotation(value) { rotation = value },
  }
}

async function hash(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

describe('stable registry installation identity', () => {
  it('creates one UUID and Ed25519 key with private permissions', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    const instance = JSON.parse(await fs.readFile(setup.service.instancePath, 'utf8'))
    const credentials = JSON.parse(await fs.readFile(setup.service.credentialsPath, 'utf8'))

    expect(instance).toMatchObject({ version: 1, clientInstanceId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(credentials.clientInstanceId).toBe(instance.clientInstanceId)
    expect((await fs.stat(path.dirname(setup.service.instancePath))).mode & 0o777).toBe(0o700)
    for (const filePath of [setup.service.instancePath, setup.service.privateKeyPath, setup.service.credentialsPath]) {
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600)
    }
    expect(setup.requests[0].body.clientInstanceId).toBe(instance.clientInstanceId)
    expect(JSON.stringify(setup.store.getRegistryState())).not.toContain('t'.repeat(43))
  })

  it('preserves UUID, key, and logical installation across restart', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    const instanceHash = await hash(setup.service.instancePath)
    const keyHash = await hash(setup.service.privateKeyPath)
    const restartedStore = storeFixture()
    setup.fetchImpl.mockClear()
    const restarted = new InstallationIdentityService(setup.service)
    restarted.dataDir = setup.dataDir
    restarted.directory = setup.service.directory
    restarted.instancePath = setup.service.instancePath
    restarted.privateKeyPath = setup.service.privateKeyPath
    restarted.credentialsPath = setup.service.credentialsPath
    restarted.rotationKeyBackupPath = setup.service.rotationKeyBackupPath
    restarted.rotationCredentialsBackupPath = setup.service.rotationCredentialsBackupPath

    await restarted.initialize(restartedStore)

    expect(await hash(restarted.instancePath)).toBe(instanceHash)
    expect(await hash(restarted.privateKeyPath)).toBe(keyHash)
    expect(setup.fetchImpl).not.toHaveBeenCalled()
    expect(restartedStore.getRegistryState().installationIdentity).toMatchObject({ state: 'active', installationKey: INSTALLATION_KEY })
  })

  it('adopts a stable UUID for a legacy installation using the existing key', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    const keyHash = await hash(setup.service.privateKeyPath)
    const legacy = JSON.parse(await fs.readFile(setup.service.credentialsPath, 'utf8'))
    delete legacy.clientInstanceId
    await fs.writeFile(setup.service.credentialsPath, `${JSON.stringify(legacy)}\n`, { mode: 0o600 })
    await fs.rm(setup.service.instancePath)
    setup.fetchImpl.mockClear()

    await setup.service.initialize(setup.store)

    expect(await hash(setup.service.privateKeyPath)).toBe(keyHash)
    expect(setup.fetchImpl).toHaveBeenCalledTimes(2)
    const migrated = JSON.parse(await fs.readFile(setup.service.credentialsPath, 'utf8'))
    expect(migrated.clientInstanceId).toBe(JSON.parse(await fs.readFile(setup.service.instancePath, 'utf8')).clientInstanceId)
    expect(migrated.installationKey).toBe(INSTALLATION_KEY)
  })

  it('rebuilds deleted registry public state from persisted identity without a remote request', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    const emptyStore = storeFixture()
    setup.fetchImpl.mockClear()

    await setup.service.initialize(emptyStore)

    expect(setup.fetchImpl).not.toHaveBeenCalled()
    expect(emptyStore.getRegistryState().installationIdentity).toMatchObject({ state: 'active', installationKey: INSTALLATION_KEY })
  })

  it('renews deleted credentials with the same UUID and key', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    const uuidHash = await hash(setup.service.instancePath)
    const keyHash = await hash(setup.service.privateKeyPath)
    await fs.rm(setup.service.credentialsPath)
    setup.fetchImpl.mockClear()

    await setup.service.initialize(setup.store)

    expect(setup.fetchImpl).toHaveBeenCalledTimes(2)
    expect(await hash(setup.service.instancePath)).toBe(uuidHash)
    expect(await hash(setup.service.privateKeyPath)).toBe(keyHash)
  })

  it('creates one retained replacement key and stops retries when recovery is pending', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    await fs.rm(setup.service.privateKeyPath)
    setup.setActivation('pending')
    setup.fetchImpl.mockClear()

    await setup.service.initialize(setup.store)
    const replacementHash = await hash(setup.service.privateKeyPath)
    expect(setup.store.getRegistryState().installationIdentity).toMatchObject({
      state: 'recovery-pending', recoveryKey: RECOVERY_KEY,
    })
    expect(setup.fetchImpl).toHaveBeenCalledTimes(2)

    setup.fetchImpl.mockClear()
    await expect(setup.service.credentials(setup.store)).rejects.toBeInstanceOf(InstallationRecoveryError)
    await setup.service.initialize(setup.store)
    expect(setup.fetchImpl).not.toHaveBeenCalled()
    expect(await hash(setup.service.privateKeyPath)).toBe(replacementHash)
  })

  it('stops retries and retains the replacement key when recovery cannot reach the registry', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    await fs.rm(setup.service.privateKeyPath)
    setup.setActivation('unavailable')
    setup.fetchImpl.mockClear()

    await setup.service.initialize(setup.store)
    const replacementHash = await hash(setup.service.privateKeyPath)

    expect(setup.store.getRegistryState().installationIdentity).toMatchObject({
      state: 'recovery-pending',
      recoveryKey: null,
      lastError: 'Registry unavailable.',
    })
    expect(setup.fetchImpl).toHaveBeenCalledTimes(2)

    setup.fetchImpl.mockClear()
    await setup.service.initialize(setup.store)

    expect(setup.fetchImpl).not.toHaveBeenCalled()
    expect(await hash(setup.service.privateKeyPath)).toBe(replacementHash)
  })

  it('activates the retained replacement key after owner approval', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    await fs.rm(setup.service.privateKeyPath)
    setup.setActivation('pending')
    await setup.service.initialize(setup.store)
    const replacementHash = await hash(setup.service.privateKeyPath)
    setup.setActivation('success')

    await setup.service.resumeRecovery(setup.store)

    expect(await hash(setup.service.privateKeyPath)).toBe(replacementHash)
    expect(setup.store.getRegistryState().installationIdentity).toMatchObject({ state: 'active', recoveryKey: null })
  })

  it('keeps rejected recovery visible without retrying', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    await fs.rm(setup.service.privateKeyPath)
    setup.setActivation('pending')
    await setup.service.initialize(setup.store)
    setup.setActivation('rejected')
    await expect(setup.service.resumeRecovery(setup.store)).rejects.toMatchObject({ state: 'rejected' })
    setup.fetchImpl.mockClear()

    await expect(setup.service.credentials(setup.store)).rejects.toMatchObject({ state: 'rejected' })
    await setup.service.initialize(setup.store)

    expect(setup.fetchImpl).not.toHaveBeenCalled()
    expect(setup.store.getRegistryState().installationIdentity).toMatchObject({ state: 'rejected', recoveryKey: RECOVERY_KEY })
  })

  it('rotates through the authenticated endpoint without revocation and keeps the logical installation', async () => {
    const setup = await fixture()
    const first = await setup.service.activate(setup.store)
    const uuidHash = await hash(setup.service.instancePath)
    setup.requests.splice(0)

    const rotated = await setup.service.rotate(setup.store)

    expect(rotated.installationKey).toBe(first.installationKey)
    expect(rotated.publicKeyId).not.toBe(first.publicKeyId)
    expect(await hash(setup.service.instancePath)).toBe(uuidHash)
    expect(setup.requests.map((request) => request.pathname)).toEqual(['/v1/installations/rotate'])
    expect(setup.requests[0].body).toMatchObject({ clientInstanceId: JSON.parse(await fs.readFile(setup.service.instancePath, 'utf8')).clientInstanceId })
  })

  it('leaves current key and credentials byte-identical when rotation fails', async () => {
    const setup = await fixture()
    await setup.service.activate(setup.store)
    const key = await fs.readFile(setup.service.privateKeyPath)
    const credentials = await fs.readFile(setup.service.credentialsPath)
    setup.setRotation('failure')

    await expect(setup.service.rotate(setup.store)).rejects.toThrow('Rotation unavailable.')

    expect(await fs.readFile(setup.service.privateKeyPath)).toEqual(key)
    expect(await fs.readFile(setup.service.credentialsPath)).toEqual(credentials)
  })

  it('rejects malformed stable instance data instead of replacing it', async () => {
    const setup = await fixture()
    await fs.mkdir(setup.service.directory, { recursive: true })
    await fs.writeFile(setup.service.instancePath, '{"version":1,"clientInstanceId":"not-a-uuid"}')
    await expect(setup.service.initialize(setup.store)).rejects.toThrow('Restore installation-instance.json')
    expect(setup.fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects paths outside the registry API namespace', async () => {
    const setup = await fixture()
    await expect(setup.service.post('https://attacker.example/token', {})).rejects.toThrow('Registry request path is invalid.')
  })
})
