import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_SCHEMA_VERSION,
  canonicalJson,
  digestCatalogTemplate,
  validateCatalogManifest,
  validateCatalogSnapshot,
  verifySignedCatalogArtifact,
} from '../src/index'

function base64UrlToBase64(value: string): string {
  return `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`
}

describe('signed catalog snapshots', () => {
  it('verifies a canonical Ed25519 signature and rejects tampering', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const rawPublicKey = base64UrlToBase64(publicKey.export({ format: 'jwk' }).x!)
    const payload = { schemaVersion: 1, catalogRevision: 4, generatedAt: '2026-07-26T12:00:00.000Z' }
    const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64')
    const artifact = { payload, signature: { algorithm: 'Ed25519' as const, keyId: 'official-2026', value: signature } }
    await expect(verifySignedCatalogArtifact(artifact, [{ keyId: 'official-2026', publicKey: rawPublicKey }])).resolves.toEqual(payload)
    await expect(verifySignedCatalogArtifact({ ...artifact, payload: { ...payload, catalogRevision: 5 } }, [{ keyId: 'official-2026', publicKey: rawPublicKey }])).rejects.toThrow(/invalid/i)
  })

  it('validates template hashes, bounds, and expiry', async () => {
    const item = { type: 'cpu', name: 'Example CPU', manufacturer: 'Example', model: 'C1' }
    const projection = await digestCatalogTemplate(item)
    const digests = { identityHash: projection.identityHash, contentHash: projection.contentHash }
    const snapshot = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogRevision: 1,
      generatedAt: '2026-07-26T12:00:00.000Z',
      expiresAt: '2026-08-26T12:00:00.000Z',
      manufacturerAliases: {},
      templates: [{ templateKey: 'example-cpu-1', revision: 1, ...digests, item: projection.item }],
    }
    await expect(validateCatalogSnapshot(snapshot, { now: new Date('2026-07-27T00:00:00.000Z') })).resolves.toMatchObject({ catalogRevision: 1 })
    await expect(validateCatalogSnapshot({ ...snapshot, templates: [{ ...snapshot.templates[0], contentHash: 'a'.repeat(64) }] }, { now: new Date('2026-07-27T00:00:00.000Z') })).rejects.toThrow(/declared hashes/i)
    await expect(validateCatalogSnapshot(snapshot, { now: new Date('2026-09-01T00:00:00.000Z') })).rejects.toThrow(/expired/i)
  })

  it('rejects stale or insecure manifests', () => {
    const manifest = {
      schemaVersion: 1,
      catalogRevision: 1,
      generatedAt: '2026-07-26T12:00:00.000Z',
      expiresAt: '2026-08-26T12:00:00.000Z',
      snapshot: { url: 'https://registry.example/v1/releases/1/catalog.json', sha256: 'a'.repeat(64), sizeBytes: 10, expandedSizeBytes: 20 },
      digests: { url: 'https://registry.example/v1/releases/1/digests.json', sha256: 'b'.repeat(64), sizeBytes: 10, expandedSizeBytes: 20 },
    }
    expect(validateCatalogManifest(manifest, { now: new Date('2026-07-27T00:00:00.000Z') })).toEqual(manifest)
    expect(() => validateCatalogManifest({ ...manifest, snapshot: { ...manifest.snapshot, url: 'http://registry.example/catalog.json' } }, { now: new Date('2026-07-27T00:00:00.000Z') })).toThrow(/HTTPS/)
  })
})
