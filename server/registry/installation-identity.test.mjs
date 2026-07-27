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
})
