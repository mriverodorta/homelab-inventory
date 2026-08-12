import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { CatalogIndex, CATALOG_INDEX_SCHEMA_VERSION } from './catalog-index.mjs'
import {
  CATALOG_RECEIPT_VERSION,
  verifyCatalogGenerationReceipt,
  writeCatalogGenerationReceipt,
} from './catalog-generation-receipt.mjs'

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-catalog-receipt-'))
  const paths = {
    snapshot: path.join(directory, 'snapshot.json'),
    digest: path.join(directory, 'digests.json'),
    facets: path.join(directory, 'facets.json'),
    index: path.join(directory, 'catalog.sqlite'),
    receipt: path.join(directory, 'verification.json'),
  }
  const facets = { schemaVersion: 1, catalogRevision: 12, generatedAt: '2026-08-12T00:00:00.000Z', categories: [] }
  await fs.writeFile(paths.snapshot, '{"signed":"snapshot"}', { mode: 0o600 })
  await fs.writeFile(paths.digest, '{"signed":"digests"}', { mode: 0o600 })
  await fs.writeFile(paths.facets, '{"signed":"facets"}', { mode: 0o600 })
  await new CatalogIndex(paths.index).rebuild({ templates: [] }, paths.index, facets)
  const identity = {
    revision: 12,
    digest: 'a'.repeat(64),
    catalogContractVersion: 9,
    fingerprintVersion: 9,
    templateCount: 0,
    facetCategoryCount: 0,
  }
  return { directory, paths, identity }
}

describe('catalog generation verification receipt', () => {
  it('writes a private atomic receipt and verifies immutable files plus SQLite', async () => {
    const { paths, identity } = await fixture()
    const receipt = await writeCatalogGenerationReceipt(paths, identity, { now: new Date('2026-08-12T12:00:00.000Z') })
    expect(receipt).toMatchObject({
      version: CATALOG_RECEIPT_VERSION,
      indexSchemaVersion: CATALOG_INDEX_SCHEMA_VERSION,
      revision: 12,
      verifiedAt: '2026-08-12T12:00:00.000Z',
    })
    expect(Object.keys(receipt.files)).toEqual(['snapshot', 'digest', 'facets', 'index'])
    expect((await fs.stat(paths.receipt)).mode & 0o777).toBe(0o600)
    await expect(verifyCatalogGenerationReceipt(paths, identity)).resolves.toMatchObject({
      index: { schemaVersion: CATALOG_INDEX_SCHEMA_VERSION, templateCount: 0, facetCategoryCount: 0 },
    })
  })

  it('rejects changed artifacts, identity, receipt versions, and non-regular files', async () => {
    const { paths, identity } = await fixture()
    await writeCatalogGenerationReceipt(paths, identity)
    await fs.appendFile(paths.snapshot, 'changed')
    await expect(verifyCatalogGenerationReceipt(paths, identity)).rejects.toThrow(/do not match/)

    const second = await fixture()
    await writeCatalogGenerationReceipt(second.paths, second.identity)
    await expect(verifyCatalogGenerationReceipt(second.paths, { ...second.identity, revision: 13 })).rejects.toThrow(/revision/)

    const receipt = JSON.parse(await fs.readFile(second.paths.receipt, 'utf8'))
    await fs.writeFile(second.paths.receipt, JSON.stringify({ ...receipt, version: 99 }))
    await expect(verifyCatalogGenerationReceipt(second.paths, second.identity)).rejects.toThrow(/version/)

    const third = await fixture()
    await fs.rm(third.paths.snapshot)
    await fs.mkdir(third.paths.snapshot)
    await expect(writeCatalogGenerationReceipt(third.paths, third.identity)).rejects.toThrow(/non-regular/)
  })

  it('rejects unsupported or corrupt SQLite indexes', async () => {
    const { paths, identity } = await fixture()
    await writeCatalogGenerationReceipt(paths, identity)
    const sqlite = ['bun', 'sqlite'].join(':')
    const { Database } = await import(sqlite)
    const database = new Database(paths.index)
    database.exec('PRAGMA user_version = 999')
    database.close()
    const receipt = await writeCatalogGenerationReceipt(paths, identity)
    expect(receipt.indexSchemaVersion).toBe(CATALOG_INDEX_SCHEMA_VERSION)
    await expect(verifyCatalogGenerationReceipt(paths, identity)).rejects.toThrow(/schema version/)

    const corrupt = await fixture()
    await writeCatalogGenerationReceipt(corrupt.paths, corrupt.identity)
    await fs.writeFile(corrupt.paths.index, 'not sqlite')
    const updated = JSON.parse(await fs.readFile(corrupt.paths.receipt, 'utf8'))
    const bytes = await fs.readFile(corrupt.paths.index)
    const { createHash } = await import('node:crypto')
    updated.files.index = { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    await fs.writeFile(corrupt.paths.receipt, JSON.stringify(updated))
    await expect(verifyCatalogGenerationReceipt(corrupt.paths, corrupt.identity)).rejects.toThrow()
  })
})
