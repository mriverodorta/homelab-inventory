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
      { templateKey: 'cpu-one-01', revision: 1, identityHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), item: { type: 'cpu', name: 'Core Example', manufacturer: 'Intel' } },
      { templateKey: 'ram-one-01', revision: 1, identityHash: 'c'.repeat(64), contentHash: 'd'.repeat(64), item: { type: 'ram', name: 'Memory Example', manufacturer: 'Kingston' } },
    ] })
    expect(index.search({ query: 'core', type: 'cpu' })).toMatchObject({ total: 1, items: [{ templateKey: 'cpu-one-01' }] })
    expect(index.search({ manufacturer: 'kingston' })).toMatchObject({ total: 1, items: [{ type: 'ram' }] })
  })
})
