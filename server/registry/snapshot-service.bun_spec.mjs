import { generateKeyPairSync, sign } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  canonicalJson,
  digestCatalogTemplate,
  FINGERPRINT_VERSION,
  sha256Hex,
} from '../../packages/catalog-protocol/src/index.ts'
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
    getProject: () => ({ items: {} }),
    registryTransaction(mutator) {
      const draft = structuredClone(registry)
      mutator(draft)
      registry = draft
      return this.getRegistryState()
    },
    flush: async () => {},
  }
  const trustedKeys = [{ keyId: 'test-key', publicKey: base64UrlToBase64(publicKey.export({ format: 'jwk' }).x) }]
  return { artifact, dataDir, privateKey, store, trustedKeys }
}

function signedArtifact(payload, privateKey) {
  return {
    payload,
    signature: {
      algorithm: 'Ed25519',
      keyId: 'test-key',
      value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    },
  }
}

async function connectedArtifacts({ artifact, privateKey }) {
  const digestPayload = {
    schemaVersion: artifact.payload.schemaVersion,
    fingerprintVersion: FINGERPRINT_VERSION,
    manufacturerAliasVersion: 1,
    catalogRevision: artifact.payload.catalogRevision,
    generatedAt: artifact.payload.generatedAt,
    entries: artifact.payload.templates.map((template) => ({
      identityHash: template.identityHash,
      templateKey: template.templateKey,
      contentHashes: [{ hash: template.contentHash, state: 'published', revision: template.revision }],
    })),
  }
  const digestArtifact = signedArtifact(digestPayload, privateKey)
  const snapshotText = JSON.stringify(artifact)
  const digestText = JSON.stringify(digestArtifact)
  const manifest = signedArtifact({
    schemaVersion: artifact.payload.schemaVersion,
    catalogRevision: artifact.payload.catalogRevision,
    generatedAt: artifact.payload.generatedAt,
    expiresAt: '2026-08-26T12:00:00.000Z',
    snapshot: {
      url: 'https://registry.example/v1/releases/2/catalog.json',
      sha256: await sha256Hex(snapshotText),
      sizeBytes: new TextEncoder().encode(snapshotText).byteLength,
      expandedSizeBytes: new TextEncoder().encode(snapshotText).byteLength,
    },
    digests: {
      url: 'https://registry.example/v1/releases/2/digests.json',
      sha256: await sha256Hex(digestText),
      sizeBytes: new TextEncoder().encode(digestText).byteLength,
      expandedSizeBytes: new TextEncoder().encode(digestText).byteLength,
    },
  }, privateKey)
  return { manifest, snapshotText, digestText }
}

describe('catalog snapshot service', () => {
  it('activates only verified snapshots and rebuilds a missing cache', async () => {
    const { artifact, store, trustedKeys } = await fixture()
    const service = new SnapshotService(store, { trustedKeys })
    await service.activate(artifact, { mode: 'offline', now: new Date('2026-07-27T00:00:00.000Z') })
    expect(store.getRegistryState().snapshot).toMatchObject({ revision: 2, templateCount: 1, keyId: 'test-key' })
    expect(await service.search({ query: 'example' })).toMatchObject({ total: 1 })
    const activePaths = await service.resolveActivePaths()
    await fs.rm(activePaths.index)
    expect(await service.search({ query: 'sw8' })).toMatchObject({ total: 1 })
  })

  it('recovers a valid catalog generation when the active pointer is missing', async () => {
    const { artifact, dataDir, store, trustedKeys } = await fixture()
    const service = new SnapshotService(store, { trustedKeys })
    await service.activate(artifact, { mode: 'offline', now: new Date('2026-07-27T00:00:00.000Z') })
    await fs.rm(path.join(dataDir, 'catalog', 'active-generation.json'))

    const restarted = new SnapshotService(store, { trustedKeys })
    expect(await restarted.search({ query: 'example' })).toMatchObject({ total: 1 })
    const pointer = JSON.parse(await fs.readFile(path.join(dataDir, 'catalog', 'active-generation.json'), 'utf8'))
    expect(pointer).toMatchObject({
      version: 1,
      revision: 2,
      digest: store.getRegistryState().snapshot.digest,
    })
  })

  it('preserves the active snapshot when verification fails', async () => {
    const { artifact, store, trustedKeys } = await fixture()
    const service = new SnapshotService(store, { trustedKeys })
    await service.activate(artifact, { mode: 'offline', now: new Date('2026-07-27T00:00:00.000Z') })
    const previous = store.getRegistryState().snapshot
    await expect(service.activate({ ...artifact, payload: { ...artifact.payload, catalogRevision: 3 } }, { mode: 'offline', now: new Date('2026-07-27T00:00:00.000Z') })).rejects.toThrow(/invalid/i)
    expect(store.getRegistryState().snapshot).toEqual(previous)
  })

  it('records a sanitized connected refresh failure without replacing the last-known-good snapshot', async () => {
    const { artifact, store, trustedKeys } = await fixture()
    const now = new Date('2026-07-27T00:00:00.000Z')
    const service = new SnapshotService(store, { trustedKeys })
    await service.activate(artifact, { mode: 'offline', now })
    store.registryTransaction((draft) => {
      draft.settings.mode = 'connected'
    })
    const previous = store.getRegistryState()
    const failingService = new SnapshotService(store, {
      trustedKeys,
      officialOrigin: 'https://registry.example',
      fetchImpl: async () => ({ ok: false, status: 503 }),
    })

    await expect(failingService.refreshConnected({ now })).rejects.toThrow('Catalog manifest request failed with HTTP 503.')

    const current = store.getRegistryState()
    expect(current.snapshot).toEqual(previous.snapshot)
    expect(current.sources[0]).toMatchObject({
      activeRevision: previous.sources[0].activeRevision,
      lastSuccessAt: previous.sources[0].lastSuccessAt,
      lastCheckedAt: now.toISOString(),
      lastErrorAt: now.toISOString(),
      lastError: 'Catalog manifest request failed with HTTP 503.',
    })
  })

  it('clears a previous refresh error after a successful connected refresh', async () => {
    const setup = await fixture()
    const { artifact, store, trustedKeys } = setup
    const now = new Date('2026-07-27T00:00:00.000Z')
    store.registryTransaction((draft) => {
      draft.settings.mode = 'connected'
    })
    const failingService = new SnapshotService(store, {
      trustedKeys,
      officialOrigin: 'https://registry.example',
      fetchImpl: async () => ({ ok: false, status: 503 }),
    })
    await expect(failingService.refreshConnected({ now })).rejects.toThrow()

    const responses = await connectedArtifacts(setup)
    const successfulService = new SnapshotService(store, {
      trustedKeys,
      officialOrigin: 'https://registry.example',
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname
        if (pathname === '/v1/manifest') return { ok: true, json: async () => responses.manifest }
        if (pathname.endsWith('/catalog.json')) return { ok: true, text: async () => responses.snapshotText }
        return { ok: true, text: async () => responses.digestText }
      },
    })
    await successfulService.refreshConnected({ now })

    expect(store.getRegistryState().sources[0]).toMatchObject({
      activeRevision: artifact.payload.catalogRevision,
      lastErrorAt: null,
      lastError: null,
    })
  })

  it('refuses activation when connected mode is disabled during download', async () => {
    const setup = await fixture()
    const { store, trustedKeys } = setup
    const now = new Date('2026-07-27T00:00:00.000Z')
    store.registryTransaction((draft) => {
      draft.settings.mode = 'connected'
    })
    const responses = await connectedArtifacts(setup)
    const service = new SnapshotService(store, {
      trustedKeys,
      officialOrigin: 'https://registry.example',
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname
        if (pathname === '/v1/manifest') return { ok: true, json: async () => responses.manifest }
        store.registryTransaction((draft) => {
          draft.settings.mode = 'offline'
        })
        if (pathname.endsWith('/catalog.json')) return { ok: true, text: async () => responses.snapshotText }
        return { ok: true, text: async () => responses.digestText }
      },
    })

    await expect(service.refreshConnected({ now })).rejects.toThrow('Connected catalog mode was disabled before activation.')
    expect(store.getRegistryState().snapshot).toBeNull()
  })

  it('rejects a signed rollback below the active catalog revision', async () => {
    const { artifact, privateKey, store, trustedKeys } = await fixture()
    const service = new SnapshotService(store, { trustedKeys })
    const now = new Date('2026-07-27T00:00:00.000Z')
    await service.activate(artifact, { mode: 'offline', now })
    const older = signedArtifact({ ...artifact.payload, catalogRevision: 1 }, privateKey)

    await expect(service.activate(older, { mode: 'offline', now }))
      .rejects.toThrow('Catalog snapshot revision is older than the active snapshot.')
    expect(store.getRegistryState().snapshot.revision).toBe(2)
  })

  it('rejects a digest index that does not describe the signed snapshot', async () => {
    const { artifact, privateKey, store, trustedKeys } = await fixture()
    const digestArtifact = signedArtifact({
      schemaVersion: artifact.payload.schemaVersion,
      fingerprintVersion: FINGERPRINT_VERSION,
      manufacturerAliasVersion: 1,
      catalogRevision: artifact.payload.catalogRevision,
      generatedAt: artifact.payload.generatedAt,
      entries: [{
        identityHash: 'a'.repeat(64),
        templateKey: artifact.payload.templates[0].templateKey,
        contentHashes: [{
          hash: artifact.payload.templates[0].contentHash,
          state: 'published',
          revision: artifact.payload.templates[0].revision,
        }],
      }],
    }, privateKey)

    await expect(new SnapshotService(store, { trustedKeys }).activate(artifact, {
      mode: 'connected',
      now: new Date('2026-07-27T00:00:00.000Z'),
      digestArtifact,
    })).rejects.toThrow(/does not match its snapshot/)
    expect(store.getRegistryState().snapshot).toBeNull()
  })

  it('rejects a connected manifest before reading a body larger than the hard limit', async () => {
    const { store, trustedKeys } = await fixture()
    store.registryTransaction((draft) => {
      draft.settings.mode = 'connected'
    })
    const service = new SnapshotService(store, {
      trustedKeys,
      officialOrigin: 'https://registry.example',
      fetchImpl: async () => ({
        ok: true,
        headers: { get: () => String(2 * 1024 * 1024) },
        text: async () => { throw new Error('body should not be read') },
      }),
    })

    await expect(service.refreshConnected({ now: new Date('2026-07-27T00:00:00.000Z') }))
      .rejects.toThrow('Catalog manifest exceeds the maximum allowed size.')
    expect(store.getRegistryState().snapshot).toBeNull()
  })
})
