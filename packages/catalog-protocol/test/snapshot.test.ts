import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_SCHEMA_VERSION,
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  canonicalJson,
  digestCatalogTemplate,
  validateCatalogFacetIndex,
  validateCatalogManifest,
  validateCatalogSnapshot,
  verifySignedCatalogArtifact,
} from '../src/index'
import nasV10Fixture from './fixtures/server-specs-inventory-nas-v10.json'

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
      templates: [{ templateKey: 'example-cpu-1', revision: 1, fingerprintVersion: FINGERPRINT_VERSION, ...digests, item: projection.item }],
    }
    await expect(validateCatalogSnapshot(snapshot, { now: new Date('2026-07-27T00:00:00.000Z') })).resolves.toMatchObject({ catalogRevision: 1 })
    await expect(validateCatalogSnapshot({ ...snapshot, templates: [{ ...snapshot.templates[0], contentHash: 'a'.repeat(64) }] }, { now: new Date('2026-07-27T00:00:00.000Z') })).rejects.toThrow(/declared hashes/i)
    await expect(validateCatalogSnapshot(snapshot, { now: new Date('2026-09-01T00:00:00.000Z') })).rejects.toThrow(/expired/i)
  })

  it('validates the frozen NAS v10 fixture in a signed catalog snapshot', async () => {
    const snapshot = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogRevision: 10,
      generatedAt: '2026-08-14T12:00:00.000Z',
      expiresAt: '2026-09-14T12:00:00.000Z',
      manufacturerAliases: {},
      templates: [{
        templateKey: 'nas-synology-diskstation-ds620slim',
        revision: 1,
        fingerprintVersion: NAS_FINGERPRINT_VERSION,
        identityHash: nasV10Fixture.identityHash,
        contentHash: nasV10Fixture.contentHash,
        item: nasV10Fixture.item,
      }],
    }

    await expect(validateCatalogSnapshot(snapshot, {
      now: new Date('2026-08-15T00:00:00.000Z'),
    })).resolves.toMatchObject({
      catalogRevision: 10,
      templates: [{ fingerprintVersion: NAS_FINGERPRINT_VERSION, item: nasV10Fixture.item }],
    })
  })

  it('accepts legacy v2 templates and rejects canonical or alias collisions', async () => {
    const item = { type: 'cpu', name: 'Example CPU', manufacturer: 'Example', model: 'C1' }
    const legacy = await digestCatalogTemplate(item, { fingerprintVersion: LEGACY_FINGERPRINT_VERSION })
    const modern = await digestCatalogTemplate({ ...item, model: 'C2' })
    const snapshot = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogRevision: 2,
      generatedAt: '2026-07-26T12:00:00.000Z',
      manufacturerAliases: {},
      templates: [
        { templateKey: 'example-cpu-v2', revision: 1, ...legacy, item: legacy.item },
        {
          templateKey: 'example-cpu-v3', revision: 1, fingerprintVersion: FINGERPRINT_VERSION,
          identityAliases: [{ fingerprintVersion: LEGACY_FINGERPRINT_VERSION, identityHash: 'a'.repeat(64) }],
          identityHash: modern.identityHash, contentHash: modern.contentHash, item: modern.item,
        },
      ],
    }
    await expect(validateCatalogSnapshot(snapshot, { now: new Date('2026-07-27T00:00:00.000Z') })).resolves.toMatchObject({
      templates: [
        { fingerprintVersion: LEGACY_FINGERPRINT_VERSION },
        { fingerprintVersion: FINGERPRINT_VERSION },
      ],
    })
    const collision = structuredClone(snapshot)
    collision.templates[1].identityAliases = [{ fingerprintVersion: LEGACY_FINGERPRINT_VERSION, identityHash: legacy.identityHash }]
    await expect(validateCatalogSnapshot(collision, { now: new Date('2026-07-27T00:00:00.000Z') })).rejects.toThrow(/collides/i)
  })

  it('rejects templates that require a newer unsupported catalog contract', async () => {
    const projection = await digestCatalogTemplate({
      type: 'server',
      name: 'Future Server',
      manufacturer: 'Example',
      model: 'S7',
    })
    const snapshot = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogRevision: 7,
      generatedAt: '2026-07-26T12:00:00.000Z',
      manufacturerAliases: {},
      templates: [{
        templateKey: 'future-server-v7',
        revision: 1,
        fingerprintVersion: 11,
        identityHash: projection.identityHash,
        contentHash: projection.contentHash,
        item: projection.item,
      }],
    }

    await expect(validateCatalogSnapshot(snapshot, {
      now: new Date('2026-07-27T00:00:00.000Z'),
    })).rejects.toThrow(/fingerprint version is unsupported/i)
  })

  it('rejects stale or insecure manifests', () => {
    const manifest = {
      schemaVersion: 1,
      catalogRevision: 1,
      generatedAt: '2026-07-26T12:00:00.000Z',
      expiresAt: '2026-08-26T12:00:00.000Z',
      snapshot: { url: 'https://registry.example/v1/releases/1/catalog.json', sha256: 'a'.repeat(64), sizeBytes: 10, expandedSizeBytes: 20 },
      digests: { url: 'https://registry.example/v1/releases/1/digests.json', sha256: 'b'.repeat(64), sizeBytes: 10, expandedSizeBytes: 20 },
      facets: { url: 'https://registry.example/v1/releases/1/facets.json', sha256: 'c'.repeat(64), sizeBytes: 10, expandedSizeBytes: 20 },
    }
    expect(validateCatalogManifest(manifest, { now: new Date('2026-07-27T00:00:00.000Z') })).toEqual(manifest)
    expect(() => validateCatalogManifest({ ...manifest, snapshot: { ...manifest.snapshot, url: 'http://registry.example/catalog.json' } }, { now: new Date('2026-07-27T00:00:00.000Z') })).toThrow(/HTTPS/)
  })

  it('validates revision-bound category and facet metadata', () => {
    const facets = {
      schemaVersion: 1,
      catalogRevision: 4,
      generatedAt: '2026-08-03T12:00:00.000Z',
      categories: [{
        type: 'cpu',
        label: 'Processors',
        count: 2,
        facets: [
          { key: 'manufacturer', label: 'Manufacturer', kind: 'terms', values: [{ value: 'Intel', label: 'Intel', count: 2 }] },
          { key: 'specs.cores', label: 'Core count', kind: 'range', minimum: 2, maximum: 64, step: 1 },
        ],
      }],
    }

    expect(validateCatalogFacetIndex(facets)).toEqual(facets)
    expect(() => validateCatalogFacetIndex({ ...facets, categories: [{ ...facets.categories[0], count: -1 }] })).toThrow(/count/i)
    expect(() => validateCatalogFacetIndex({ ...facets, categories: [{ ...facets.categories[0], facets: [{ key: 'specs.cores', label: 'Core count', kind: 'range', minimum: 64, maximum: 2, step: 1 }] }] })).toThrow(/range/i)
  })
})
