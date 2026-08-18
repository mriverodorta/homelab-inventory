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
    expect(index.getByKeys(['ram-one-01', 'missing', 'cpu-one-01', 'ram-one-01'])).toMatchObject([
      { templateKey: 'ram-one-01' },
      { templateKey: 'cpu-one-01' },
    ])
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

  it('searches motherboard aliases, chipset, socket, CPU generation, and board revision', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-catalog-motherboard-search-'))
    const index = new CatalogIndex(path.join(directory, 'catalog.sqlite'))
    await index.rebuild({ templates: [{
      templateKey: 'motherboard-asus-z690-p-d4',
      revision: 1,
      fingerprintVersion: 7,
      identityHash: '1'.repeat(64),
      contentHash: '2'.repeat(64),
      item: {
        type: 'motherboard',
        name: 'ASUS PRIME Z690-P D4',
        manufacturer: 'ASUS',
        aliases: ['PRIME Z690-P D4-CSM'],
        specs: { chipset: 'Intel Z690', boardRevision: '1.1' },
        compatibility: { host: { cpu: { sockets: ['LGA1700'], generations: ['14th Gen'] } } },
      },
    }] })

    for (const query of ['d4-csm', 'z690', 'lga1700', '14th gen', '1.1']) {
      expect(index.search({ query })).toMatchObject({
        total: 1,
        items: [{ templateKey: 'motherboard-asus-z690-p-d4' }],
      })
    }
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

  it('indexes historical measurements under canonical range facet keys', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-catalog-canonical-facets-'))
    const index = new CatalogIndex(path.join(directory, 'catalog.sqlite'))
    const templates = [
      {
        templateKey: 'ram-ddr3l-8gb', revision: 1, fingerprintVersion: 8,
        identityHash: '1'.repeat(64), contentHash: '2'.repeat(64),
        item: { type: 'ram', name: '8GB DDR3L', specs: { capacityGb: 8, generation: 'DDR3L' } },
      },
      {
        templateKey: 'ram-ddr4-16gb', revision: 1, fingerprintVersion: 8,
        identityHash: '3'.repeat(64), contentHash: '4'.repeat(64),
        item: { type: 'ram', name: '16GB DDR4', specs: { capacityGb: 16, generation: 'DDR4' } },
      },
    ]
    const facets = {
      schemaVersion: 1,
      catalogRevision: 18,
      generatedAt: '2026-08-15T12:00:00.000Z',
      categories: [{
        type: 'ram', label: 'Memory', count: 2,
        facets: [{ key: 'specs.capacityMib', label: 'Capacity', kind: 'range', minimum: 8192, maximum: 16384, step: 1024 }],
      }],
    }

    await index.rebuild({ templates }, index.filePath, facets)

    expect(index.search({
      type: 'ram',
      ranges: { 'specs.capacityMib': { minimum: 8192, maximum: 16384 } },
    })).toMatchObject({ total: 2 })
    expect(index.search({
      type: 'ram',
      ranges: { 'specs.capacityMib': { minimum: 8192, maximum: 8192 } },
    })).toMatchObject({ total: 1, items: [{ templateKey: 'ram-ddr3l-8gb', item: { specs: { capacityMib: 8192 } } }] })
    expect(index.getByKey('ram-ddr3l-8gb')).toMatchObject({
      fingerprintVersion: 8,
      runtimeCanonicalVersion: 9,
      contentHash: '2'.repeat(64),
      item: { specs: { capacityMib: 8192 } },
    })
  })

  it('projects every historical measurement-backed catalog range into canonical units', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-catalog-all-canonical-ranges-'))
    const index = new CatalogIndex(path.join(directory, 'catalog.sqlite'))
    const fixtures = [
      { type: 'cpu', specs: { tdpWatts: 35, baseClockGhz: 2.3 }, key: 'specs.tdpMw', value: 35_000 },
      { type: 'gpu', specs: { vramGb: 8 }, key: 'specs.vramMib', value: 8192 },
      { type: 'storage', specs: { capacityTb: 2 }, key: 'specs.capacityBytes', value: 2_000_000_000_000 },
      { type: 'network', specs: { speedMbps: 10_000 }, key: 'specs.maxSpeedBps', value: 10_000_000_000 },
      { type: 'switch', specs: { switchingCapacityGbps: 80 }, key: 'specs.switchingCapacityBps', value: 80_000_000_000 },
      { type: 'ups', specs: { wattageWatts: 1000 }, key: 'specs.ratedPowerMw', value: 1_000_000 },
      { type: 'powerSupply', specs: { wattageWatts: 750 }, key: 'specs.ratedPowerMw', value: 750_000 },
    ]
    const templates = fixtures.map((fixture, index) => ({
      templateKey: `${fixture.type}-${index}`,
      revision: 1,
      fingerprintVersion: 3,
      identityHash: `${String(index + 1)}`.repeat(64),
      contentHash: `${String(index + 2)}`.repeat(64),
      item: { type: fixture.type, name: `${fixture.type} fixture`, specs: fixture.specs },
    }))
    const categories = fixtures.map((fixture) => ({
      type: fixture.type,
      label: fixture.type,
      count: 1,
      facets: [{ key: fixture.key, label: fixture.key, kind: 'range', minimum: fixture.value, maximum: fixture.value, step: 1 }],
    }))

    await index.rebuild({ templates }, index.filePath, {
      schemaVersion: 1,
      catalogRevision: 18,
      generatedAt: '2026-08-15T12:00:00.000Z',
      categories,
    })

    for (const fixture of fixtures) {
      expect(index.search({
        type: fixture.type,
        ranges: { [fixture.key]: { minimum: fixture.value, maximum: fixture.value } },
      })).toMatchObject({ total: 1, items: [{ item: { specs: { [fixture.key.split('.').at(-1)]: fixture.value } } }] })
    }
  })
})
