import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { CatalogIndex } from './catalog-index.mjs'

describe('catalog sqlite index', () => {
  it('rebuilds deterministically and filters without browser-side catalog data', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-catalog-index-'))
    const index = new CatalogIndex(path.join(directory, 'catalog.sqlite'))
    await index.rebuild({ templates: [
      { templateKey: 'cpu-one-01', revision: 1, fingerprintVersion: 3, identityHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), item: { type: 'cpu', name: 'Core Example', manufacturer: 'Intel' } },
      { templateKey: 'ram-one-01', revision: 1, fingerprintVersion: 3, identityHash: 'c'.repeat(64), contentHash: 'd'.repeat(64), item: { type: 'ram', name: 'Memory Example', manufacturer: 'Kingston' } },
    ] })
    expect(index.search({ query: 'core', type: 'cpu' })).toMatchObject({ total: 1, items: [{ templateKey: 'cpu-one-01' }] })
    expect(index.search({ manufacturer: 'kingston' })).toMatchObject({ total: 1, items: [{ type: 'ram' }] })
  })

  it('stores and searches variant metadata independently for sibling hardware', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-catalog-variants-'))
    const index = new CatalogIndex(path.join(directory, 'catalog.sqlite'))
    const shared = {
      revision: 1,
      fingerprintVersion: 3,
      item: { type: 'desktop', name: 'Dell OptiPlex Micro 7090', manufacturer: 'Dell', model: 'OptiPlex Micro 7090' },
      productFamily: { manufacturer: 'Dell', model: 'OptiPlex Micro 7090', physicalClass: 'desktop' },
    }
    await index.rebuild({ templates: [
      {
        ...shared,
        templateKey: 'dell-7090-014t59',
        identityHash: 'a'.repeat(64),
        identityAliases: [{ fingerprintVersion: 2, identityHash: 'e'.repeat(64) }],
        contentHash: 'b'.repeat(64),
        variantEvidence: {
          source: 'motherboard', completeness: 'complete', motherboardPartNumber: '014T59',
          motherboardRevision: 'A00', structuralSummary: 'Proprietary riser · PCIe Gen3 x8',
        },
      },
      {
        ...shared,
        templateKey: 'dell-7090-04frx5',
        identityHash: 'c'.repeat(64),
        contentHash: 'd'.repeat(64),
        variantEvidence: {
          source: 'motherboard', completeness: 'complete', motherboardPartNumber: '04FRX5',
          motherboardRevision: 'A00', structuralSummary: 'Standard board · no riser',
        },
      },
    ] })

    expect(index.search({ query: '014t59' })).toMatchObject({
      total: 1,
      items: [{
        templateKey: 'dell-7090-014t59',
        fingerprintVersion: 3,
        identityAliases: [{ fingerprintVersion: 2, identityHash: 'e'.repeat(64) }],
        variantEvidence: { motherboardPartNumber: '014T59', motherboardRevision: 'A00' },
      }],
    })
    expect(index.search({ query: 'no riser' })).toMatchObject({ total: 1, items: [{ templateKey: 'dell-7090-04frx5' }] })
  })

  it('indexes signed facets and combines term, range, and pagination constraints locally', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-catalog-facets-'))
    const index = new CatalogIndex(path.join(directory, 'catalog.sqlite'))
    const templates = [
      { templateKey: 'cpu-intel-01', revision: 1, fingerprintVersion: 3, identityHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), item: { type: 'cpu', name: 'Intel Six Core', manufacturer: 'Intel', specs: { cores: 6, socket: 'LGA1200' } } },
      { templateKey: 'cpu-amd-01', revision: 1, fingerprintVersion: 3, identityHash: 'c'.repeat(64), contentHash: 'd'.repeat(64), item: { type: 'cpu', name: 'AMD Eight Core', manufacturer: 'AMD', specs: { cores: 8, socket: 'AM4' } } },
      { templateKey: 'cpu-amd-02', revision: 1, fingerprintVersion: 3, identityHash: 'e'.repeat(64), contentHash: 'f'.repeat(64), item: { type: 'cpu', name: 'AMD Twelve Core', manufacturer: 'AMD', specs: { cores: 12, socket: 'AM5' } } },
    ]
    const facets = {
      schemaVersion: 1,
      catalogRevision: 7,
      generatedAt: '2026-08-03T12:00:00.000Z',
      categories: [{
        type: 'cpu', label: 'Processors', count: 3,
        facets: [
          { key: 'manufacturer', label: 'Manufacturer', kind: 'terms', values: [{ value: 'AMD', label: 'AMD', count: 2 }, { value: 'Intel', label: 'Intel', count: 1 }] },
          { key: 'specs.socket', label: 'Socket', kind: 'terms', values: [{ value: 'AM4', label: 'AM4', count: 1 }, { value: 'AM5', label: 'AM5', count: 1 }, { value: 'LGA1200', label: 'LGA1200', count: 1 }] },
          { key: 'specs.cores', label: 'Core count', kind: 'range', minimum: 6, maximum: 12, step: 1 },
        ],
      }],
    }
    await index.rebuild({ templates }, index.filePath, facets)

    expect(index.facets()).toMatchObject({ available: true, catalogRevision: 7, categories: [{ type: 'cpu', count: 3 }] })
    expect(index.search({
      type: 'cpu',
      terms: { manufacturer: ['AMD'], 'specs.socket': ['AM5'] },
      ranges: { 'specs.cores': { minimum: 10, maximum: 12 } },
      limit: 1,
    })).toMatchObject({
      total: 1,
      hasMore: false,
      nextOffset: null,
      items: [{ templateKey: 'cpu-amd-02' }],
    })
    expect(index.search({ type: 'cpu', terms: { manufacturer: ['AMD'] }, limit: 1 })).toMatchObject({
      total: 2,
      hasMore: true,
      nextOffset: 1,
      items: [{ templateKey: 'cpu-amd-01' }],
    })
  })
})
