import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

async function template(item, revision, templateKey = 'cpu-example-core-c1') {
  const projection = await digestCatalogTemplate(item)
  return {
    templateKey,
    revision,
    identityHash: projection.identityHash,
    contentHash: projection.contentHash,
    item: projection.item,
  }
}

function activateCatalog(store) {
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
}

function storeState(store) {
  return {
    meta: structuredClone(store.databases.meta.data),
    inventory: structuredClone(store.databases.inventory.data),
    project: structuredClone(store.databases.project.data),
    registry: structuredClone(store.databases.registry.data),
    dirtyStores: [...store.dirtyStores].sort(),
    pendingProjectCommits: structuredClone(store.pendingProjectCommits),
  }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('catalog update lifecycle', () => {
  it('imports physical desktop templates as locally role-aware equipment and preserves that role on update', async () => {
    const store = await createStore()
    const revision1 = await template({
      type: 'desktop',
      name: 'Example Mini PC',
      manufacturer: 'Example',
      model: 'M1',
      specs: { formFactor: 'Mini' },
    }, 1, 'desktop-example-mini-m1')
    const revision2 = await template({
      ...revision1.item,
      specs: { ...revision1.item.specs, chipset: 'Example C1' },
    }, 2, 'desktop-example-mini-m1')

    activateCatalog(store)
    store.createCatalogInventoryItems(revision1, 1, { usageRole: 'workstation' })

    expect(store.databases.inventory.data.servers).toEqual([
      expect.objectContaining({
        id: 1,
        name: 'Example M1',
        hardwareClass: 'desktop',
        usageRole: 'workstation',
      }),
    ])
    const link = store.getRegistryState().links[0]
    expect(link).toMatchObject({ itemType: 'server', itemId: 1 })

    store.registryTransaction((draft) => {
      const current = draft.links.find((candidate) => candidate.id === link.id)
      current.state = 'update-available'
      current.availableRevision = revision2.revision
      current.availableContentHash = revision2.contentHash
    })

    expect(store.getCatalogUpdatePreview(link.id, revision2)).toMatchObject({
      changes: [expect.objectContaining({ field: 'specs' })],
      localFieldsPreserved: expect.arrayContaining(['hardwareClass', 'usageRole']),
    })
    store.applyCatalogUpdate(link.id, revision2)

    expect(store.databases.inventory.data.servers[0]).toMatchObject({
      hardwareClass: 'desktop',
      usageRole: 'workstation',
      specs: { formFactor: 'Mini', chipset: 'Example C1' },
    })
    expect(store.getRegistryState().links[0]).toMatchObject({
      itemType: 'server',
      state: 'linked',
      importedRevision: 2,
    })
  })

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

    activateCatalog(store)
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

  it('reviews and adopts a richer registry definition without silently overwriting local fields', async () => {
    const store = await createStore()
    const localItem = {
      type: 'cpu',
      name: 'Intel Core i5-10500T',
      manufacturer: 'Intel',
      family: 'Core i5',
      number: 'i5-10500T',
      specs: { cores: 6, threads: 12 },
      properties: { inventoryTag: 'local-copy-1' },
    }
    const registryTemplate = await template({
      ...localItem,
      model: 'i5-10500T',
      specs: {
        ...localItem.specs,
        socket: 'LGA1200',
        channels: 2,
        tdpWatts: 35,
        generation: '10th Gen',
      },
    }, 2)
    activateCatalog(store)
    store.createInventoryItems(localItem)
    const localProjection = await digestCatalogTemplate(localItem)
    store.registryTransaction((draft) => {
      draft.links.push({
        id: 1,
        itemType: 'cpu',
        itemId: 1,
        sourceId: 1,
        templateKey: registryTemplate.templateKey,
        importedRevision: registryTemplate.revision,
        importedContentHash: localProjection.contentHash,
        state: 'adoption-available',
        linkedAt: '2026-07-31T12:00:00.000Z',
        availableRevision: registryTemplate.revision,
        availableContentHash: registryTemplate.contentHash,
      })
    })
    await store.flush()
    const persistedProjectBefore = structuredClone(store.databases.project.data)
    const persistedMetaBefore = structuredClone(store.databases.meta.data)

    expect(store.getCatalogUpdates()).toEqual([expect.objectContaining({
      linkId: 1,
      state: 'adoption-available',
      importedRevision: 2,
      availableRevision: 2,
    })])
    expect(store.getCatalogUpdatePreview(1, registryTemplate)).toMatchObject({
      state: 'adoption-available',
      changes: expect.arrayContaining([
        expect.objectContaining({ field: 'model' }),
        expect.objectContaining({ field: 'specs' }),
      ]),
      localFieldsPreserved: expect.arrayContaining(['properties']),
    })

    store.applyCatalogUpdate(1, registryTemplate)

    expect(store.getProject().items['cpu:1']).toMatchObject({
      model: 'i5-10500T',
      specs: expect.objectContaining({ socket: 'LGA1200', channels: 2, tdpWatts: 35 }),
      properties: { inventoryTag: 'local-copy-1' },
    })
    expect(store.getRegistryState().links).toEqual([expect.objectContaining({
      id: 1,
      state: 'linked',
      importedRevision: 2,
      importedContentHash: registryTemplate.contentHash,
    })])
    expect(store.databases.project.data).toEqual(persistedProjectBefore)
    expect(store.databases.meta.data).toEqual(persistedMetaBefore)
    expect(store.dirtyStores).toEqual(new Set(['inventory', 'registry']))
  })

  it('rolls back inventory creation when catalog link creation fails', async () => {
    const store = await createStore()
    const revision1 = await template({
      type: 'cpu',
      name: 'Example Core C1',
      manufacturer: 'Example',
      family: 'Core C',
      model: 'C1',
      specs: { cores: 6, threads: 12, socket: 'Socket-A' },
    }, 1)
    activateCatalog(store)
    const before = storeState(store)
    const transaction = vi.spyOn(store, 'registryTransaction')
      .mockImplementationOnce(() => { throw new Error('Injected registry failure.') })

    expect(() => store.createCatalogInventoryItems(revision1)).toThrow('Injected registry failure.')

    expect(storeState(store)).toEqual(before)
    transaction.mockRestore()
  })

  it('rolls back catalog updates and linked-item deletion when registry mutation fails', async () => {
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
    }, 2)
    activateCatalog(store)
    store.createCatalogInventoryItems(revision1)
    const link = store.getRegistryState().links[0]
    store.registryTransaction((draft) => {
      const target = draft.links.find((candidate) => candidate.id === link.id)
      target.state = 'update-available'
      target.availableRevision = revision2.revision
      target.availableContentHash = revision2.contentHash
    })
    await store.flush()

    let before = storeState(store)
    let transaction = vi.spyOn(store, 'registryTransaction')
      .mockImplementationOnce(() => { throw new Error('Injected update failure.') })
    expect(() => store.applyCatalogUpdate(link.id, revision2)).toThrow('Injected update failure.')
    expect(storeState(store)).toEqual(before)
    transaction.mockRestore()

    store.archiveInventoryItems([{ type: 'cpu', id: 1 }])
    await store.flush()
    before = storeState(store)
    transaction = vi.spyOn(store, 'registryTransaction')
      .mockImplementationOnce(() => { throw new Error('Injected delete failure.') })
    expect(() => store.deleteInventoryItems([{ type: 'cpu', id: 1 }])).toThrow('Injected delete failure.')
    expect(storeState(store)).toEqual(before)
    transaction.mockRestore()
  })

  it('rolls back a full inventory edit when catalog-link reconciliation fails', async () => {
    const store = await createStore()
    const revision1 = await template({
      type: 'cpu',
      name: 'Example Core C1',
      manufacturer: 'Example',
      family: 'Core C',
      model: 'C1',
      specs: { cores: 6, threads: 12, socket: 'Socket-A' },
    }, 1)
    activateCatalog(store)
    store.createCatalogInventoryItems(revision1)
    await store.flush()
    const before = storeState(store)
    const transaction = vi.spyOn(store, 'registryTransaction')
      .mockImplementationOnce(() => { throw new Error('Injected reconciliation failure.') })

    expect(() => store.updateInventoryItemAndReconcileCatalog(
      { type: 'cpu', id: 1 },
      { ...revision1.item, name: 'Locally edited CPU' },
      'local-content-hash',
    )).toThrow('Injected reconciliation failure.')

    expect(storeState(store)).toEqual(before)
    transaction.mockRestore()
  })
})
