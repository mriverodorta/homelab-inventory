import { afterEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalJson,
  digestCatalogTemplate,
  FINGERPRINT_VERSION,
} from '../../../packages/catalog-protocol/src/index.ts'
import { CatalogIndex } from '../../registry/catalog-index.mjs'
import { rebuildVerifiedCatalog } from './catalog-rebuilder.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function base64UrlToBase64(value: string) {
  return `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`
}

function signed(payload: unknown, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']) {
  return {
    payload,
    signature: {
      algorithm: 'Ed25519',
      keyId: 'test-key',
      value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    },
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hli-catalog-rebuild-'))
  roots.push(root)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const item = {
    type: 'cpu',
    name: 'Example CPU 1000T',
    manufacturer: 'Example',
    family: 'Example Core',
    model: '1000T',
    number: '1000T',
    specs: { cores: 8, threads: 16, socket: 'EX1', generation: 'Example Gen 1' },
  }
  const hashes = await digestCatalogTemplate(item, { fingerprintVersion: FINGERPRINT_VERSION })
  const generatedAt = '2026-08-11T12:00:00.000Z'
  const snapshot = {
    schemaVersion: 1,
    fingerprintVersion: FINGERPRINT_VERSION,
    catalogRevision: 9,
    generatedAt,
    expiresAt: '2027-08-11T12:00:00.000Z',
    manufacturerAliases: {},
    templates: [{
      templateKey: 'cpu-example-1000t',
      revision: 1,
      fingerprintVersion: FINGERPRINT_VERSION,
      identityHash: hashes.identityHash,
      contentHash: hashes.contentHash,
      item,
    }],
  }
  const facets = {
    schemaVersion: 1,
    catalogRevision: 9,
    generatedAt,
    categories: [{
      type: 'cpu', label: 'Processors', count: 1,
      facets: [
        { key: 'manufacturer', label: 'Manufacturer', kind: 'terms', values: [{ value: 'Example', label: 'Example', count: 1 }] },
        { key: 'specs.cores', label: 'Core count', kind: 'range', minimum: 8, maximum: 8, step: 1 },
      ],
    }],
  }
  const snapshotPath = join(root, 'snapshot.json')
  const facetsPath = join(root, 'facets.json')
  await writeFile(snapshotPath, JSON.stringify(signed(snapshot, privateKey)))
  await writeFile(facetsPath, JSON.stringify(signed(facets, privateKey)))
  const trustedKeys = [{
    keyId: 'test-key',
    publicKey: base64UrlToBase64(String(publicKey.export({ format: 'jwk' }).x)),
  }]
  const snapshotService = {
    trustedKeys,
    resolveActivePaths: async () => ({ snapshot: snapshotPath, facets: facetsPath }),
  }
  return { root, snapshotPath, targetPath: join(root, 'catalog.sqlite'), snapshotService }
}

describe('verified catalog rebuild', () => {
  test('builds a private searchable index from signed snapshot and facets', async () => {
    const { targetPath, snapshotService } = await fixture()
    const result = await rebuildVerifiedCatalog({ snapshotService, targetPath })

    expect(result).toMatchObject({ catalogRevision: 9, templateCount: 1, facetCategoryCount: 1 })
    expect((await stat(targetPath)).mode & 0o777).toBe(0o600)
    const index = new CatalogIndex(targetPath)
    expect(index.search({ query: '1000T', type: 'cpu' })).toMatchObject({ total: 1, items: [{ templateKey: 'cpu-example-1000t' }] })
    expect(index.facets()).toMatchObject({ available: true, catalogRevision: 9, categories: [{ type: 'cpu', count: 1 }] })
  })

  test('preserves an existing catalog when signed artifact verification fails', async () => {
    const { snapshotPath, targetPath, snapshotService } = await fixture()
    const original = Buffer.from('existing-catalog')
    await writeFile(targetPath, original)
    const artifact = JSON.parse(await readFile(snapshotPath, 'utf8'))
    artifact.payload.templates[0].item.name = 'Tampered CPU'
    await writeFile(snapshotPath, JSON.stringify(artifact))

    await expect(rebuildVerifiedCatalog({ snapshotService, targetPath })).rejects.toThrow()
    expect(await readFile(targetPath)).toEqual(original)
  })
})
