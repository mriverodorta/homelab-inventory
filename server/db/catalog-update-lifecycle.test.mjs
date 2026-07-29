import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { digestCatalogTemplate } from '../../packages/catalog-protocol/src/index.ts'
import { HomelabInventoryStore } from './store.mjs'

const tempDirs = []
const stores = []

async function createStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-update-lifecycle-'))
  tempDirs.push(dataDir)
  const store = new HomelabInventoryStore({
    appVersion: '1.0.0',
    dataDir,
    legacyProjectPath: path.join(dataDir, 'legacy.json'),
    saveDebounceMs: 1,
    seedEmptyData: false,
    seedDir: path.join(dataDir, 'missing-seed'),
  })
  await store.init()
  stores.push(store)
  return store
}

async function template(item, revision) {
  const projection = await digestCatalogTemplate(item)
  return {
    templateKey: 'cpu-example-core-c1',
    revision,
    identityHash: projection.identityHash,
    contentHash: projection.contentHash,
    item: projection.item,
  }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('catalog update lifecycle', () => {
  it('reviews and applies a newer revision while preserving local fields and link identity', async () => {
    const store = await createStore()
    const revision1 = await template({
      type: 'cpu',
      name: 'Example Core C1',
      manufacturer: 'Example',
      family: 'Core C',
      model: 'C1',
      specs: { cores: 6, threads: 12, socket: 'Socket-A' },
    }, 1)
    const revision2 = await template({
      ...revision1.item,
      specs: { ...revision1.item.specs, boostClockGhz: 4.2 },
      compatibility: { requirements: { cpu: { socket: 'Socket-A', tdpWatts: 35 } } },
    }, 2)

    store.registryTransaction((draft) => {
      draft.sources.push({ id: 1, kind: 'official-connected', displayName: 'Official Catalog' })
      draft.snapshot = {
        sourceId: 1,
        revision: 1,
        generatedAt: '2026-07-28T12:00:00.000Z',
        expiresAt: null,
        activatedAt: '2026-07-28T12:00:00.000Z',
        digest: 'a'.repeat(64),
        templateCount: 1,
        keyId: 'registry-test-key',
      }
    })
    store.createCatalogInventoryItems(revision1)
    store.updateInventoryItemProperties({ type: 'cpu', id: 1 }, {
      customName: 'Compute node spare',
      inventoryTag: 'local-only-001',
    })

    const originalLink = store.getRegistryState().links[0]
    store.registryTransaction((draft) => {
      const link = draft.links.find((candidate) => candidate.id === originalLink.id)
      link.state = 'update-available'
      link.availableRevision = revision2.revision
      link.availableContentHash = revision2.contentHash
    })

    expect(store.getCatalogUpdates()).toEqual([expect.objectContaining({
      linkId: originalLink.id,
      itemType: 'cpu',
      itemId: 1,
      importedRevision: 1,
      availableRevision: 2,
    })])
    expect(store.getCatalogUpdatePreview(originalLink.id, revision2)).toMatchObject({
      linkId: originalLink.id,
      changes: [
        expect.objectContaining({ field: 'specs' }),
        expect.objectContaining({ field: 'compatibility' }),
      ],
      localFieldsPreserved: expect.arrayContaining(['properties']),
    })

    store.applyCatalogUpdate(originalLink.id, revision2)

    expect(store.getProject().items['cpu:1']).toMatchObject({
      specs: expect.objectContaining({ boostClockGhz: 4.2 }),
      compatibility: { requirements: { cpu: { socket: 'Socket-A', tdpWatts: 35 } } },
      properties: {
        customName: 'Compute node spare',
        inventoryTag: 'local-only-001',
      },
    })
    expect(store.getRegistryState().links).toEqual([expect.objectContaining({
      id: originalLink.id,
      itemType: 'cpu',
      itemId: 1,
      importedRevision: 2,
      importedContentHash: revision2.contentHash,
      state: 'linked',
    })])
    expect(store.getCatalogUpdates()).toEqual([])
  })
})
