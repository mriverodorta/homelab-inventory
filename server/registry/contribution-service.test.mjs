import { describe, expect, it } from 'vitest'
import { createRegistryStore } from './model.mjs'
import { discoverContributionCandidates } from './contribution-service.mjs'

function fixture(input) {
  const items = Array.isArray(input) ? input : [input]
  let registry = createRegistryStore()
  registry.settings.mode = 'connected'
  registry.settings.automaticContributions = true
  const store = {
    getRegistryState: () => structuredClone(registry),
    getProject: () => ({ items: Object.fromEntries(items.map((item) => [`${item.type}:${String(item.id)}`, item])) }),
    registryTransaction(mutator) {
      const draft = structuredClone(registry)
      mutator(draft)
      registry = draft
      return this.getRegistryState()
    },
  }
  return store
}

describe('contribution discovery', () => {
  it('queues only sanitized reusable hardware fields and deduplicates subsequent scans', async () => {
    const store = fixture({
      id: 1,
      key: 'server:1',
      type: 'server',
      name: 'Example Mini Server',
      manufacturer: 'Example',
      model: 'M1',
      specs: { formFactor: 'Mini' },
      properties: { customName: 'secret-host', lanIp: '192.168.1.20', tailscaleIp: '100.64.0.2' },
      notes: 'serial ABC123',
      smart: { macAddress: 'aa:bb:cc:dd:ee:ff' },
    })
    expect(await discoverContributionCandidates(store, new Date('2026-07-26T12:00:00.000Z'))).toMatchObject({ queued: 1 })
    const record = store.getRegistryState().contributionOutbox[0]
    expect(JSON.stringify(record.payload)).not.toMatch(/secret-host|192\.168|100\.64|ABC123|aa:bb/i)
    expect(record.itemType).toBe('server')
    expect(record.itemId).toBe(1)
    expect(await discoverContributionCandidates(store)).toMatchObject({ queued: 0 })
  })

  it('does nothing when explicit connected contribution consent is absent', async () => {
    const store = fixture({ id: 1, type: 'cpu', name: 'Example CPU' })
    store.registryTransaction((draft) => { draft.settings.automaticContributions = false })
    expect(await discoverContributionCandidates(store)).toEqual({ queued: 0, skipped: 0 })
  })

  it('does not queue content already present in the signed registry digest index', async () => {
    const store = fixture({ id: 1, type: 'cpu', name: 'Example CPU', manufacturer: 'Example', model: 'C1' })
    const { contentHash } = await import('../../packages/catalog-protocol/src/index.ts')
      .then(({ projectCatalogItem }) => projectCatalogItem(store.getProject().items['cpu:1']))
    expect(await discoverContributionCandidates(store, new Date(), new Set([contentHash]))).toMatchObject({ queued: 0 })
  })

  it('collapses identical physical switches into one candidate while retaining local sources', async () => {
    const store = fixture([1, 2, 3].map((id) => ({
      id,
      type: 'switch',
      name: `Rack switch ${String(id)}`,
      manufacturer: 'NETGEAR',
      model: 'GS108T',
      specs: { management: 'Smart managed' },
      ports: [{ id: 1, type: 'rj45', speed: '1G', slotNumber: 1 }],
    })))

    expect(await discoverContributionCandidates(store)).toMatchObject({ queued: 1 })
    const registry = store.getRegistryState()
    expect(registry.contributionOutbox).toHaveLength(1)
    expect(registry.contributionOutbox[0].sources).toEqual([
      { itemType: 'switch', itemId: 1 },
      { itemType: 'switch', itemId: 2 },
      { itemType: 'switch', itemId: 3 },
    ])
    expect(registry.contributionGroups[0].sources).toHaveLength(3)
  })

  it('reconciles stale pending groups when explicit PCIe topology reveals a host variant', async () => {
    const standardSlot = {
      id: 1, key: 'm2-ae-slot', count: 1, label: 'M.2 2230 A/E network slot',
      interfaceFamily: 'm2-ae', maxPowerWatts: 5,
    }
    const servers = [1, 2].map((id) => ({
      id, type: 'server', hardwareClass: 'desktop', name: `7090 ${String(id)}`,
      manufacturer: 'Dell', model: 'OptiPlex Micro 7090',
      compatibility: { host: { expansionSlots: [standardSlot] } },
    }))
    const store = fixture(servers)

    expect(await discoverContributionCandidates(store)).toMatchObject({ queued: 1 })
    expect(store.getRegistryState().contributionOutbox[0].sources).toHaveLength(2)

    servers[1].compatibility.host.expansionSlots = [{
      id: 1, key: 'custom-pcie-slot', count: 1, label: 'Custom low-profile PCIe adapter',
      interfaceFamily: 'pcie', pcieGeneration: 4, mechanicalLanes: 8, electricalLanes: 8,
      acceptedHeights: ['low-profile'], maxSlotWidth: 1, maxPowerWatts: 75,
    }, standardSlot]

    expect(await discoverContributionCandidates(store)).toMatchObject({ queued: 1 })
    const outbox = store.getRegistryState().contributionOutbox
    expect(outbox).toHaveLength(2)
    expect(outbox.map((record) => record.sources)).toEqual([
      [{ itemType: 'server', itemId: 1 }],
      [{ itemType: 'server', itemId: 2 }],
    ])
    expect(new Set(outbox.map((record) => record.identityHash)).size).toBe(2)
  })

  it('auto-links every physical copy only for an exact published registry digest', async () => {
    const switches = [1, 2].map((id) => ({
      id,
      type: 'switch',
      name: `Private rack name ${String(id)}`,
      manufacturer: 'NETGEAR',
      model: 'GS108T',
      specs: { management: 'Smart managed' },
      ports: [{ id: 1, type: 'rj45', speed: '1G', slotNumber: 1 }],
    }))
    const store = fixture(switches)
    store.registryTransaction((draft) => {
      draft.sources.push({ id: 1, name: 'Official', origin: 'https://registry.example', enabled: true })
      draft.snapshot = { sourceId: 1, revision: 4 }
    })
    const projection = await import('../../packages/catalog-protocol/src/index.ts')
      .then(({ projectCatalogItem }) => projectCatalogItem(switches[0]))
    const known = new Map([[projection.contentHash, {
      identityHash: projection.identityHash,
      templateKey: 'netgear-gs108t',
      revision: 4,
      state: 'published',
    }]])

    expect(await discoverContributionCandidates(store, new Date('2026-07-27T12:00:00.000Z'), known))
      .toMatchObject({ queued: 0 })
    expect(store.getRegistryState().links).toEqual([
      expect.objectContaining({ itemType: 'switch', itemId: 1, templateKey: 'netgear-gs108t', importedContentHash: projection.contentHash }),
      expect.objectContaining({ itemType: 'switch', itemId: 2, templateKey: 'netgear-gs108t', importedContentHash: projection.contentHash }),
    ])
  })

  it('offers every physical copy for identity-based adoption without enabling contributions', async () => {
    const cpus = [1, 2, 3, 4].map((id) => ({
      id,
      type: 'cpu',
      name: 'Intel Core i5-10500T',
      manufacturer: 'Intel',
      family: 'Core i5',
      number: 'i5-10500T',
      specs: { cores: 6, threads: 12, baseClockGhz: 2.3, boostClockGhz: 3.8 },
    }))
    const store = fixture(cpus)
    store.registryTransaction((draft) => {
      draft.settings.automaticContributions = false
      draft.sources.push({ id: 1, kind: 'official-connected', displayName: 'Official Catalog' })
      draft.snapshot = { sourceId: 1, revision: 4 }
    })
    const localProjection = await import('../../packages/catalog-protocol/src/index.ts')
      .then(({ projectCatalogItem }) => projectCatalogItem(cpus[0]))
    const registryProjection = await import('../../packages/catalog-protocol/src/index.ts')
      .then(({ digestCatalogTemplate }) => digestCatalogTemplate({
        ...cpus[0],
        model: 'i5-10500T',
        specs: {
          ...cpus[0].specs,
          socket: 'LGA1200',
          channels: 2,
          tdpWatts: 35,
          generation: '10th Gen',
        },
      }))
    expect(registryProjection.identityHash).toBe(localProjection.identityHash)
    expect(registryProjection.contentHash).not.toBe(localProjection.contentHash)

    const known = new Map([[registryProjection.contentHash, {
      identityHash: registryProjection.identityHash,
      fingerprintVersion: registryProjection.fingerprintVersion,
      templateKey: 'cpu-intel-core-i5-10500t',
      revision: 2,
      state: 'published',
    }]])
    expect(await discoverContributionCandidates(store, new Date('2026-07-31T12:00:00.000Z'), known, { linkOnly: true }))
      .toMatchObject({ queued: 0 })
    expect(store.getRegistryState().contributionOutbox).toEqual([])
    expect(store.getRegistryState().links).toEqual(cpus.map((cpu, index) => expect.objectContaining({
      id: index + 1,
      itemType: 'cpu',
      itemId: cpu.id,
      templateKey: 'cpu-intel-core-i5-10500t',
      importedRevision: 2,
      importedContentHash: localProjection.contentHash,
      state: 'adoption-available',
      availableRevision: 2,
      availableContentHash: registryProjection.contentHash,
    })))
  })

  it('uses an unambiguous published v2 identity alias to offer a generic host for variant adoption', async () => {
    const servers = [1, 2].map((id) => ({
      id,
      type: 'server',
      hardwareClass: 'desktop',
      usageRole: 'server',
      name: 'Dell OptiPlex Micro 7090',
      manufacturer: 'Dell',
      model: 'OptiPlex Micro 7090',
      specs: { formFactor: 'Micro' },
    }))
    const store = fixture(servers)
    store.registryTransaction((draft) => {
      draft.settings.automaticContributions = false
      draft.sources.push({ id: 1, kind: 'official-connected', displayName: 'Official Catalog' })
      draft.snapshot = { sourceId: 1, revision: 5 }
    })
    const protocol = await import('../../packages/catalog-protocol/src/index.ts')
    const local = await protocol.projectCatalogItem(servers[0])
    const legacy = await protocol.projectCatalogItem(servers[0], { fingerprintVersion: protocol.LEGACY_FINGERPRINT_VERSION })
    const published = await protocol.digestCatalogTemplate({
      type: 'desktop',
      name: 'Dell OptiPlex Micro 7090',
      manufacturer: 'Dell',
      model: 'OptiPlex Micro 7090',
      specs: {
        formFactor: 'Micro',
        motherboardPartNumber: '014T59',
        motherboardRevision: 'A00',
      },
    })
    expect(local.identityHash).not.toBe(published.identityHash)

    const known = new Map([[published.contentHash, {
      identityHash: published.identityHash,
      fingerprintVersion: published.fingerprintVersion,
      identityAliases: [{ fingerprintVersion: legacy.fingerprintVersion, identityHash: legacy.identityHash }],
      templateKey: 'desktop-dell-optiplex-7090-014t59',
      revision: 3,
      state: 'published',
    }]])

    await discoverContributionCandidates(store, new Date('2026-08-01T12:00:00.000Z'), known, { linkOnly: true })
    expect(store.getRegistryState().links).toEqual(servers.map((server) => expect.objectContaining({
      itemType: 'server',
      itemId: server.id,
      templateKey: 'desktop-dell-optiplex-7090-014t59',
      state: 'adoption-available',
      importedFingerprintVersion: 2,
      availableContentHash: published.contentHash,
    })))
  })

  it('relinks a detached override in place after its exact content is published', async () => {
    const cpu = {
      id: 1,
      type: 'cpu',
      name: 'Example CPU C1',
      manufacturer: 'Example',
      model: 'C1',
      specs: { cores: 6, threads: 12 },
    }
    const store = fixture(cpu)
    store.registryTransaction((draft) => {
      draft.sources.push({ id: 1, name: 'Official', origin: 'https://registry.example', enabled: true })
      draft.snapshot = { sourceId: 1, revision: 5 }
      draft.links.push({
        id: 7,
        itemType: 'cpu',
        itemId: 1,
        sourceId: 1,
        templateKey: 'example-cpu-c1',
        importedRevision: 1,
        importedContentHash: 'a'.repeat(64),
        state: 'detached',
        linkedAt: '2026-07-26T12:00:00.000Z',
        detachedAt: '2026-07-27T12:00:00.000Z',
      })
    })
    const projection = await import('../../packages/catalog-protocol/src/index.ts')
      .then(({ projectCatalogItem }) => projectCatalogItem(cpu))
    const known = new Map([[projection.contentHash, {
      identityHash: projection.identityHash,
      templateKey: 'example-cpu-c1',
      revision: 2,
      state: 'published',
    }]])

    expect(await discoverContributionCandidates(store, new Date('2026-07-28T12:00:00.000Z'), known))
      .toMatchObject({ queued: 0 })
    expect(store.getRegistryState().links).toEqual([expect.objectContaining({
      id: 7,
      itemType: 'cpu',
      itemId: 1,
      sourceId: 1,
      templateKey: 'example-cpu-c1',
      importedRevision: 2,
      importedContentHash: projection.contentHash,
      state: 'linked',
      linkedAt: '2026-07-28T12:00:00.000Z',
    })])
    expect(store.getRegistryState().links[0]).not.toHaveProperty('detachedAt')
  })

  it('keeps a detached override detached until its exact content is published', async () => {
    const cpu = { id: 1, type: 'cpu', name: 'Example CPU C1', manufacturer: 'Example', model: 'C1' }
    const store = fixture(cpu)
    store.registryTransaction((draft) => {
      draft.sources.push({ id: 1, name: 'Official', origin: 'https://registry.example', enabled: true })
      draft.snapshot = { sourceId: 1, revision: 5 }
      draft.links.push({
        id: 7,
        itemType: 'cpu',
        itemId: 1,
        sourceId: 1,
        templateKey: 'example-cpu-c1',
        importedRevision: 1,
        importedContentHash: 'a'.repeat(64),
        state: 'detached',
        linkedAt: '2026-07-26T12:00:00.000Z',
        detachedAt: '2026-07-27T12:00:00.000Z',
      })
    })
    const projection = await import('../../packages/catalog-protocol/src/index.ts')
      .then(({ projectCatalogItem }) => projectCatalogItem(cpu))
    const known = new Map([[projection.contentHash, {
      identityHash: projection.identityHash,
      templateKey: 'example-cpu-c1',
      revision: 2,
      state: 'pending',
    }]])

    expect(await discoverContributionCandidates(store, new Date('2026-07-28T12:00:00.000Z'), known))
      .toMatchObject({ queued: 0 })
    expect(store.getRegistryState().links).toEqual([expect.objectContaining({
      id: 7,
      state: 'detached',
      importedRevision: 1,
      detachedAt: '2026-07-27T12:00:00.000Z',
    })])
  })

  it('withholds unidentified generic storage from contribution delivery', async () => {
    const store = fixture({ id: 1, type: 'storage', name: '1TB NVMe', specs: { capacityGb: 1024, interface: 'NVMe', formFactor: '2280' } })
    expect(await discoverContributionCandidates(store)).toMatchObject({ queued: 0 })
    expect(store.getRegistryState().contributionOutbox).toEqual([])
  })
})
