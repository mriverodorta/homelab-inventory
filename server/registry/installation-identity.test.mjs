import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installationPublicKeyId } from '../../packages/catalog-protocol/src/index.ts'
import { InstallationIdentityService } from './installation-identity.mjs'
import { createRegistryStore } from './model.mjs'

const directories = []
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
  const now = new Date('2026-07-30T12:00:00.000Z')
  const activationRequests = []
  const fetchImpl = vi.fn(async (url, options) => {
    const pathname = new URL(url).pathname
    const body = JSON.parse(options.body)
    if (pathname.endsWith('/challenge')) {
      return new Response(JSON.stringify({
        challengeKey: '11111111-1111-4111-8111-111111111111',
        nonce: 'a'.repeat(32),
        publicKeyId: await installationPublicKeyId(body.publicKey),
        publicKey: body.publicKey,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      }), { status: 201 })
    }
    activationRequests.push(body)
    return new Response(JSON.stringify({
      installationKey: '22222222-2222-4222-8222-222222222222',
      token: 't'.repeat(43),
      tokenScope: 'contributions:write',
      tokenExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    }), { status: 201 })
  })
  return {
    activationRequests,
    now,
    options: { dataDir, officialOrigin: 'http://127.0.0.1', fetchImpl },
    store: storeFixture(),
  }
}

describe('installation identity', () => {
  it('stores private key and token only in mode-0600 backend files', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-installation-'))
    directories.push(dataDir)
    const fetchImpl = vi.fn(async (url, options) => {
      const body = JSON.parse(options.body)
      if (String(url).endsWith('/challenge')) {
        return new Response(JSON.stringify({
          challengeKey: '11111111-1111-4111-8111-111111111111',
          nonce: 'a'.repeat(32),
          publicKeyId: await installationPublicKeyId(body.publicKey),
          publicKey: body.publicKey,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }), { status: 201 })
      }
      return new Response(JSON.stringify({
        installationKey: '22222222-2222-4222-8222-222222222222',
        token: 't'.repeat(43),
        tokenScope: 'contributions:write',
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 201 })
    })
    const store = storeFixture()
    const service = new InstallationIdentityService({ dataDir, officialOrigin: 'http://127.0.0.1', fetchImpl })
    await service.activate(store)

    const keyPath = path.join(dataDir, 'registry', 'installation-ed25519.pem')
    const credentialsPath = path.join(dataDir, 'registry', 'installation-credentials.json')
    expect((await fs.stat(keyPath)).mode & 0o777).toBe(0o600)
    expect((await fs.stat(credentialsPath)).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(store.getRegistryState())).not.toContain('t'.repeat(43))
    expect(store.getRegistryState().installationIdentity).toMatchObject({ state: 'active' })
  })

  it('shares one activation handshake across concurrent credential requests', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-installation-'))
    directories.push(dataDir)
    let releaseChallenge
    const challengeReady = new Promise((resolve) => { releaseChallenge = resolve })
    const fetchImpl = vi.fn(async (url, options) => {
      const body = JSON.parse(options.body)
      if (String(url).endsWith('/challenge')) {
        await challengeReady
        return new Response(JSON.stringify({
          challengeKey: '11111111-1111-4111-8111-111111111111',
          nonce: 'a'.repeat(32),
          publicKeyId: await installationPublicKeyId(body.publicKey),
          publicKey: body.publicKey,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }), { status: 201 })
      }
      return new Response(JSON.stringify({
        installationKey: '22222222-2222-4222-8222-222222222222',
        token: 't'.repeat(43),
        tokenScope: 'contributions:write',
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 201 })
    })
    const service = new InstallationIdentityService({ dataDir, officialOrigin: 'http://127.0.0.1', fetchImpl })
    const store = storeFixture()
    const first = service.credentials(store)
    const second = service.credentials(store)
    releaseChallenge()

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('serializes key rotation with credential requests', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-installation-'))
    directories.push(dataDir)
    let activation = 0
    const fetchImpl = vi.fn(async (url, options) => {
      const pathname = new URL(url).pathname
      const body = JSON.parse(options.body)
      if (pathname.endsWith('/challenge')) {
        return new Response(JSON.stringify({
          challengeKey: `${String(activation + 1).padStart(8, '1')}-1111-4111-8111-111111111111`,
          nonce: 'a'.repeat(32),
          publicKeyId: await installationPublicKeyId(body.publicKey),
          publicKey: body.publicKey,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }), { status: 201 })
      }
      if (pathname.endsWith('/activate')) {
        activation += 1
        return new Response(JSON.stringify({
          installationKey: `${String(activation).padStart(8, '2')}-2222-4222-8222-222222222222`,
          token: String(activation).repeat(43),
          tokenScope: 'contributions:write',
          tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        }), { status: 201 })
      }
      return new Response(JSON.stringify({ revoked: true }))
    })
    const store = storeFixture()
    const service = new InstallationIdentityService({ dataDir, officialOrigin: 'http://127.0.0.1', fetchImpl })
    const first = await service.credentials(store)

    const rotating = service.rotate(store)
    const requestedDuringRotation = service.credentials(store)
    const [rotated, concurrent] = await Promise.all([rotating, requestedDuringRotation])

    expect(rotated.publicKeyId).not.toBe(first.publicKeyId)
    expect(concurrent.publicKeyId).toBe(rotated.publicKeyId)
    expect((await service.readCredentials()).publicKeyId).toBe(rotated.publicKeyId)
  })

  it('repairs missing registry metadata from a valid persisted credential', async () => {
    const setup = await fixture()
    const service = new InstallationIdentityService(setup.options)
    const credentials = await service.activate(setup.store, setup.now)
    setup.store.registryTransaction((draft) => { draft.installationIdentity = null })

    expect(await service.credentials(setup.store, setup.now)).toEqual(credentials)
    expect(setup.store.getRegistryState().installationIdentity).toMatchObject({
      installationKey: credentials.installationKey,
      publicKeyId: credentials.publicKeyId,
      state: 'active',
      tokenExpiresAt: credentials.tokenExpiresAt,
    })
  })

  it('re-enrolls instead of using credentials that belong to another key', async () => {
    const setup = await fixture()
    const service = new InstallationIdentityService(setup.options)
    const first = await service.activate(setup.store, setup.now)
    await fs.rm(service.privateKeyPath)

    const replacement = await service.credentials(setup.store, setup.now)

    expect(replacement.publicKeyId).not.toBe(first.publicKeyId)
    expect(setup.activationRequests).toHaveLength(2)
    expect(setup.store.getRegistryState().installationIdentity.publicKeyId).toBe(replacement.publicKeyId)
  })

  it('rejects paths outside the registry API namespace', async () => {
    const setup = await fixture()
    const service = new InstallationIdentityService(setup.options)

    await expect(service.post('https://attacker.example/token', {}))
      .rejects.toThrow('Registry request path is invalid.')
  })
})
