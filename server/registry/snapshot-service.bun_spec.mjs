import { generateKeyPairSync, sign } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { canonicalJson, digestCatalogTemplate } from '../../packages/catalog-protocol/src/index.ts'
import { createRegistryStore } from './model.mjs'
import { SnapshotService } from './snapshot-service.mjs'

function base64UrlToBase64(value) {
  return `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`
}

async function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const item = { type: 'switch', name: 'Example Switch', manufacturer: 'Example', model: 'SW8' }
  const { identityHash, contentHash } = await digestCatalogTemplate(item)
  const payload = {
    schemaVersion: 1,
    catalogRevision: 2,
    generatedAt: '2026-07-26T12:00:00.000Z',
    expiresAt: '2026-08-26T12:00:00.000Z',
    manufacturerAliases: {},
    templates: [{ templateKey: 'example-switch-01', revision: 1, identityHash, contentHash, item }],
  }
  const artifact = {
    payload,
    signature: {
      algorithm: 'Ed25519',
      keyId: 'test-key',
      value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    },
  }
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-snapshot-'))
  let registry = createRegistryStore()
  const store = {
    dataDir,
    getRegistryState: () => structuredClone(registry),
    registryTransaction(mutator) {
      const draft = structuredClone(registry)
      mutator(draft)
      registry = draft
      return this.getRegistryState()
    },
  }
  const trustedKeys = [{ keyId: 'test-key', publicKey: base64UrlToBase64(publicKey.export({ format: 'jwk' }).x) }]
  return { artifact, dataDir, store, trustedKeys }
}

describe('catalog snapshot service', () => {
  it('activates only verified snapshots and rebuilds a missing cache', async () => {
    const { artifact, dataDir, store, trustedKeys } = await fixture()
    const service = new SnapshotService(store, { trustedKeys })
    await service.activate(artifact, { mode: 'offline', now: new Date('2026-07-27T00:00:00.000Z') })
    expect(store.getRegistryState().snapshot).toMatchObject({ revision: 2, templateCount: 1, keyId: 'test-key' })
    expect(await service.search({ query: 'example' })).toMatchObject({ total: 1 })
    await fs.rm(path.join(dataDir, 'cache', 'catalog.sqlite'))
    expect(await service.search({ query: 'sw8' })).toMatchObject({ total: 1 })
  })

  it('preserves the active snapshot when verification fails', async () => {
    const { artifact, store, trustedKeys } = await fixture()
    const service = new SnapshotService(store, { trustedKeys })
    await service.activate(artifact, { mode: 'offline', now: new Date('2026-07-27T00:00:00.000Z') })
    const previous = store.getRegistryState().snapshot
    await expect(service.activate({ ...artifact, payload: { ...artifact.payload, catalogRevision: 3 } }, { mode: 'offline', now: new Date('2026-07-27T00:00:00.000Z') })).rejects.toThrow(/invalid/i)
    expect(store.getRegistryState().snapshot).toEqual(previous)
  })
})
