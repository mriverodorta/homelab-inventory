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
  it('imports each v8 RAM quantity as an independent linked physical stick and survives restart', async () => {
    const store = await createStore()
    const fixture = JSON.parse(await fs.readFile(path.resolve(
      'packages/catalog-protocol/test/fixtures/ram/server-specs-inventory-ram-v8.json',
    ), 'utf8'))
    activateCatalog(store)

    store.createCatalogInventoryItems({
      templateKey: fixture.templateKey,
      revision: 1,
      fingerprintVersion: fixture.fingerprintVersion,
      identityHash: fixture.identityHash,
      contentHash: fixture.contentHash,
      item: fixture.item,
    }, 2)
    await store.flush()
    const { type: _type, ...storedItem } = fixture.item

    expect(store.databases.inventory.data.ram).toEqual([
      expect.objectContaining({ id: 1, ...storedItem }),
      expect.objectContaining({ id: 2, ...storedItem }),
    ])
    expect(store.getRegistryState().links).toEqual([
      expect.objectContaining({ id: 1, itemType: 'ram', itemId: 1, importedFingerprintVersion: 8, state: 'linked' }),
      expect.objectContaining({ id: 2, itemType: 'ram', itemId: 2, importedFingerprintVersion: 8, state: 'linked' }),
    ])

    const restarted = new HomelabInventoryStore({
      appVersion: '1.0.0',
      dataDir: store.dataDir,
      legacyProjectPath: path.join(store.dataDir, 'legacy.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(store.dataDir, 'missing-seed'),
    })
    await restarted.init()
    stores.push(restarted)

    expect(restarted.databases.inventory.data.ram).toEqual(store.databases.inventory.data.ram)
    expect(restarted.getRegistryState().links).toEqual(store.getRegistryState().links)
  })

  it('imports and restarts every frozen v7 motherboard without changing its catalog identity', async () => {
    const store = await createStore()
    const fixture = JSON.parse(await fs.readFile(path.resolve(
      'packages/catalog-protocol/test/fixtures/motherboard/server-specs-inventory-motherboard-v7.json',
    ), 'utf8'))
    activateCatalog(store)

    for (const [index, fixtureCase] of fixture.cases.entries()) {
      store.createCatalogInventoryItems({
        templateKey: `motherboard-fixture-${String(index + 1)}`,
        revision: 1,
        fingerprintVersion: fixtureCase.fingerprintVersion,
        identityHash: fixtureCase.identityHash,
        contentHash: fixtureCase.contentHash,
        productFamily: fixtureCase.productFamily,
        variantEvidence: fixtureCase.variantEvidence,
        item: fixtureCase.item,
      })
    }
    await store.flush()
    const preservedStores = Object.fromEntries(await Promise.all(
      ['inventory', 'project', 'registry', 'routingCache'].map(async (name) => [
        name,
        await fs.readFile(store.paths[name], 'utf8'),
      ]),
    ))
    const meta = JSON.parse(await fs.readFile(store.paths.meta, 'utf8'))
    meta.schemaVersion = 26
    await fs.writeFile(store.paths.meta, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 })

    const restarted = new HomelabInventoryStore({
      appVersion: '1.0.0',
      dataDir: store.dataDir,
      legacyProjectPath: path.join(store.dataDir, 'legacy.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(store.dataDir, 'missing-seed'),
    })
    await restarted.init()
    stores.push(restarted)

    expect(restarted.databases.meta.data).toMatchObject({
      schemaVersion: 29,
      lastMigration: {
        from: 28,
        to: 29,
        summary: {
          migratedSpeeds: 0,
          normalizedRamFormFactors: 0,
          migratedHostMemoryDefinitions: 0,
          preservedRamRecords: 0,
          preservedAssignments: 0,
          preservedPlacements: 0,
          preservedConnections: 0,
          preservedRegistryLinks: fixture.cases.length,
          preservedRoutingEntries: 0,
        },
      },
    })
    for (const [name, contents] of Object.entries(preservedStores)) {
      expect(await fs.readFile(restarted.paths[name], 'utf8')).toBe(contents)
    }
    const backupEntries = await fs.readdir(restarted.backupDir)
    expect(backupEntries.filter((entry) => entry.endsWith('-schema-26-to-29'))).toHaveLength(1)
    expect(restarted.databases.inventory.data.motherboards).toHaveLength(fixture.cases.length)
    expect(restarted.getRegistryState().links).toHaveLength(fixture.cases.length)
    for (const [index, fixtureCase] of fixture.cases.entries()) {
      const item = restarted.getProject().items[`motherboard:${String(index + 1)}`]
      const projection = await digestCatalogTemplate(item, {
        fingerprintVersion: fixtureCase.fingerprintVersion,
      })
      expect(projection).toMatchObject({
        item: fixtureCase.item,
        identityHash: fixtureCase.identityHash,
        contentHash: fixtureCase.contentHash,
        productFamily: fixtureCase.productFamily,
        variantEvidence: fixtureCase.variantEvidence,
      })
      expect(restarted.getRegistryState().links[index]).toMatchObject({
        itemType: 'motherboard',
        itemId: index + 1,
        productFamily: fixtureCase.productFamily,
        variantEvidence: fixtureCase.variantEvidence,
      })
    }

    await restarted.flush()
    const secondRestart = new HomelabInventoryStore({
      appVersion: '1.0.0',
      dataDir: store.dataDir,
      legacyProjectPath: path.join(store.dataDir, 'legacy.json'),
      saveDebounceMs: 1,
      seedEmptyData: false,
      seedDir: path.join(store.dataDir, 'missing-seed'),
    })
    await secondRestart.init()
    stores.push(secondRestart)
    expect((await fs.readdir(secondRestart.backupDir))
      .filter((entry) => entry.endsWith('-schema-26-to-29'))).toHaveLength(1)
  })

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

  it('blocks motherboard catalog revisions that would invalidate assigned PC Build components', async () => {
    const store = await createStore()
    const revision1 = await template({
      type: 'motherboard',
      name: 'Example Z690 Board',
      manufacturer: 'Example',
      model: 'Z690-A',
      compatibility: {
        host: {
          cpu: { sockets: ['LGA1700'], socketCount: 1 },
          memory: { generations: ['DDR4'], slots: 2 },
        },
      },
    }, 1, 'motherboard-example-z690-a')
    const revision2 = await template({
      ...revision1.item,
      compatibility: {
        ...revision1.item.compatibility,
        host: {
          ...revision1.item.compatibility.host,
          cpu: { sockets: ['AM5'], socketCount: 1 },
        },
      },
    }, 2, 'motherboard-example-z690-a')

    activateCatalog(store)
    store.createCatalogInventoryItems(revision1)
    store.createInventoryItems({ type: 'pcBuild', name: 'Workstation' })
    store.createInventoryItems({
      type: 'cpu',
      name: 'Example LGA1700 CPU',
      compatibility: { requirements: { cpu: { socket: 'LGA1700' } } },
    })
    store.databases.project.data.assignments.push(
      {
        id: 1, hostType: 'pcBuild', hostId: 1, itemType: 'motherboard', itemId: 1,
        type: 'motherboard', assignedAt: '2026-08-09T00:00:00.000Z',
      },
      {
        id: 2, hostType: 'pcBuild', hostId: 1, itemType: 'cpu', itemId: 1,
        type: 'cpu', assignedAt: '2026-08-09T00:00:01.000Z',
      },
    )
    const link = store.getRegistryState().links[0]
    store.registryTransaction((draft) => {
      const current = draft.links.find((candidate) => candidate.id === link.id)
      current.state = 'update-available'
      current.availableRevision = revision2.revision
      current.availableContentHash = revision2.contentHash
    })

    expect(store.getCatalogUpdatePreview(link.id, revision2)).toMatchObject({
      dependencyConflicts: [{
        hostId: 'pcBuild:1',
        assignmentId: 2,
        itemId: 'cpu:1',
        findings: [expect.objectContaining({ severity: 'error' })],
      }],
    })
    expect(() => store.applyCatalogUpdate(link.id, revision2)).toThrow(
      'Resolve incompatible PC Build assignments',
    )
    expect(store.databases.inventory.data.motherboards[0].compatibility.host.cpu.sockets)
      .toEqual(['LGA1700'])
    expect(store.getRegistryState().links[0]).toMatchObject({
      state: 'update-available',
      importedRevision: 1,
    })
  })

  it('applies compatible motherboard metadata revisions without disturbing assignments', async () => {
    const store = await createStore()
    const revision1 = await template({
      type: 'motherboard',
      name: 'Example Z690 Board',
      manufacturer: 'Example',
      model: 'Z690-A',
      specs: { chipset: 'Z690' },
      compatibility: { host: { cpu: { sockets: ['LGA1700'], socketCount: 1 } } },
    }, 1, 'motherboard-example-z690-a')
    const revision2 = await template({
      ...revision1.item,
      specs: { ...revision1.item.specs, boardRevision: '1.1' },
    }, 2, 'motherboard-example-z690-a')

    activateCatalog(store)
    store.createCatalogInventoryItems(revision1)
    store.createInventoryItems({ type: 'pcBuild', name: 'Workstation' })
    store.databases.project.data.assignments.push({
      id: 1, hostType: 'pcBuild', hostId: 1, itemType: 'motherboard', itemId: 1,
      type: 'motherboard', assignedAt: '2026-08-09T00:00:00.000Z',
    })
    const assignmentsBefore = structuredClone(store.databases.project.data.assignments)
    const link = store.getRegistryState().links[0]
    store.registryTransaction((draft) => {
      const current = draft.links.find((candidate) => candidate.id === link.id)
      current.state = 'update-available'
      current.availableRevision = revision2.revision
      current.availableContentHash = revision2.contentHash
    })

    expect(store.getCatalogUpdatePreview(link.id, revision2).dependencyConflicts).toEqual([])
    store.applyCatalogUpdate(link.id, revision2)

    expect(store.databases.inventory.data.motherboards[0].specs).toMatchObject({
      chipset: 'Z690',
      boardRevision: '1.1',
    })
    expect(store.databases.project.data.assignments).toEqual(assignmentsBefore)
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
