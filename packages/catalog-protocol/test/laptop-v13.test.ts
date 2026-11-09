import { describe, expect, it } from 'vitest'
import { assertCatalogProtocolContract, canonicalizeCatalogItemV13, digestCatalogTemplate, projectCatalogItem, validateCatalogSnapshot } from '../src'

export function laptopFixture() {
  return {
    type: 'laptop', name: 'Synthetic Notebook 13', manufacturer: 'Synthetic', model: 'Notebook 13',
    specs: { formFactor: 'Laptop' },
    fixedComponents: [{ id: 1, componentType: 'cpu', disposition: 'soldered', label: 'Processor', item: {
      type: 'cpu', name: 'Synthetic Mobile 13', manufacturer: 'Synthetic', model: 'Mobile 13', specs: { generation: 'Synthetic 1', tdpMw: 15000 },
    } }],
    compatibility: { host: {
      topologyCompleteness: 'complete',
      memory: { slots: 2, generations: ['DDR5'], formFactors: ['SO-DIMM'], maxCapacityMib: 65536, maxModuleCapacityMib: 32768, eccSupport: 'unsupported' },
      storageSlots: [{ id: 1, key: 'nvme', label: 'Drive', count: 1, interfaces: ['NVMe'], formFactors: ['2280'], location: 'internal', backplane: 'direct' }],
    } },
  }
}
type Fixture = ReturnType<typeof laptopFixture>
const digest = (item: unknown) => digestCatalogTemplate(item, { fingerprintVersion: 13 })
function ram(id = 2) {
  return { id, componentType: 'ram', disposition: 'soldered', label: 'Memory', item: {
    type: 'ram', name: 'Synthetic fixed memory', specs: { capacityMib: 8192, generation: 'DDR5', formFactor: 'Onboard' },
  } }
}
function host(item: unknown): Record<string, any> { return (item as Fixture).compatibility.host }

describe('laptop fingerprint v13', () => {
  it('preserves every historical immutable contract vector', async () => {
    await expect(assertCatalogProtocolContract()).resolves.toBeUndefined()
  })
  it('maps local numeric server identity without changing source references', async () => {
    const result = await projectCatalogItem({ ...laptopFixture(), type: 'server', hardwareClass: 'laptop', id: 71 }, { fingerprintVersion: 13 })
    expect(result.status).toBe('eligible')
    expect(result.source).toEqual({ itemType: 'server', itemId: 71 })
  })
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const)('rejects laptop on historical fingerprint %s', async (fingerprintVersion) => {
    expect((await projectCatalogItem({ ...laptopFixture(), id: 1 }, { fingerprintVersion })).status).toBe('ineligible')
  })
  it('preserves fixed CPU without fabricating a socket or unknown power', async () => {
    const result = await digest(laptopFixture())
    expect(result.item.compatibility?.host).not.toHaveProperty('cpu')
    expect(result.item.compatibility?.host).not.toHaveProperty('power')
    expect(result.item.fixedComponents).toHaveLength(1)
    expect(host(result.item).storageSlots[0].location).toBe('internal')
  })
  it('accepts explicit socketed CPU with no fixed CPU', () => {
    const item: any = laptopFixture()
    delete item.fixedComponents
    host(item).cpu = { sockets: ['Synthetic Socket'], socketCount: 1 }
    expect(canonicalizeCatalogItemV13(item).fixedComponents).toBeUndefined()
  })
  it('supports all-fixed RAM and mixed RAM without double-counting', () => {
    const item: any = laptopFixture()
    item.fixedComponents.push(ram())
    host(item).memory = { slots: 0, maxCapacityMib: 8192 }
    expect(canonicalizeCatalogItemV13(item).fixedComponents).toHaveLength(2)
    host(item).memory = { slots: 1, maxCapacityMib: 40960, maxModuleCapacityMib: 32768 }
    expect(canonicalizeCatalogItemV13(item).compatibility?.host).toEqual(host(item))
  })
  it.each(['maxModuleCapacityMib', 'oemMaxModuleCapacityMib', 'verifiedMaxModuleCapacityMib'])('rejects %s with zero replaceable slots', (key) => {
    const item = laptopFixture()
    host(item).memory = { slots: 0, [key]: 8192 }
    expect(() => canonicalizeCatalogItemV13(item)).toThrow(/zero replaceable slots/)
  })
  it.each(['maxCapacityMib', 'oemMaxCapacityMib', 'verifiedMaxCapacityMib'])('rejects %s below fixed subtotal', (key) => {
    const item: any = laptopFixture()
    item.fixedComponents.push(ram())
    host(item).memory = { slots: 1, [key]: 4096 }
    expect(() => canonicalizeCatalogItemV13(item)).toThrow(/below fixed RAM/)
  })
  it('retains absent, empty and populated physical bus evidence', async () => {
    const item = laptopFixture()
    host(item).optionalModuleSlots = [{ id: 1, key: 'physical-e', count: 1, interfaceFamily: 'm2-ae', socketKeys: ['E'], moduleSizes: ['2230'], intendedModuleKinds: ['wireless-card'] }]
    const unknown = await digest(item)
    host(item).optionalModuleSlots[0].availableBuses = []
    const empty = await digest(item)
    host(item).optionalModuleSlots[0].availableBuses = [{ family: 'pcie', lanes: 1, pcieGeneration: 3 }]
    const populated = await digest(item)
    expect(new Set([unknown.identityHash, empty.identityHash, populated.identityHash]).size).toBe(3)
    expect(host(empty.item).optionalModuleSlots[0].availableBuses).toEqual([])
    expect(host(populated.item).optionalModuleSlots[0].key).toBe('physical-e')
    host(item).optionalModuleSlots[0].intendedModuleKinds = ['network-card']
    expect((await digest(item)).identityHash).toBe(populated.identityHash)
  })
  it('keeps empty objects distinct from missing capability and explicit zero', async () => {
    const item = laptopFixture()
    delete host(item).memory
    const unknown = await digest(item)
    host(item).memory = {}
    const empty = await digest(item)
    host(item).memory = { slots: 0 }
    const zero = await digest(item)
    expect(new Set([unknown.identityHash, empty.identityHash, zero.identityHash]).size).toBe(3)
    expect(host(empty.item).memory).toEqual({})
  })
  it('distinguishes fixed and replaceable power and rejects contradictory disposition', async () => {
    const item = laptopFixture()
    host(item).power = { configuration: 'external-adapter', adapterDisposition: 'fixed', supportedPowerMw: [65000] }
    const fixed = await digest(item)
    host(item).power.adapterDisposition = 'replaceable'
    expect((await digest(item)).identityHash).not.toBe(fixed.identityHash)
    host(item).power.configuration = 'internal-psu'
    expect(() => canonicalizeCatalogItemV13(item)).toThrow(/must be absent/)
  })
  it('makes limits and cosmetic data content-only but fixed hardware material', async () => {
    const item = laptopFixture()
    const initial = await digest(item)
    host(item).memory.maxCapacityMib = 98304
    host(item).storageSlots[0].label = 'Renamed drive'
    const revised = await digest(item)
    expect(revised.identityHash).toBe(initial.identityHash)
    expect(revised.contentHash).not.toBe(initial.contentHash)
    item.fixedComponents[0].item.model = 'Mobile 14'
    expect((await digest(item)).identityHash).not.toBe(initial.identityHash)
  })
  it('preserves identical fixed bank multiplicity', async () => {
    const item: any = laptopFixture()
    item.fixedComponents.push(ram())
    const one = await digest(item)
    item.fixedComponents.push(ram(3))
    expect((await digest(item)).identityHash).not.toBe(one.identityHash)
    item.fixedComponents.reverse()
    const reordered = await digest(item)
    item.fixedComponents.reverse()
    expect((await digest(item)).identityHash).toBe(reordered.identityHash)
  })
  it('resolves references by collection and keeps consistent ID renumbering identity-neutral', async () => {
    const item = laptopFixture()
    host(item).controllerSlots = [{ id: 1, key: 'nvme', count: 1 }]
    host(item).storageSlots[0].controllerSlotIds = [1]
    host(item).constraintGroups = [{ id: 1, key: 'exclusive', kind: 'mutually-exclusive', members: [{ resourceType: 'storage-slot', resourceId: 1 }, { resourceType: 'controller-slot', resourceId: 1 }] }]
    const original = await digest(item)
    host(item).controllerSlots[0].id = 15
    host(item).storageSlots[0].controllerSlotIds = [15]
    host(item).constraintGroups[0].members[1].resourceId = 15
    const next = await digest(item)
    expect(next.identityHash).toBe(original.identityHash)
    expect(next.contentHash).not.toBe(original.contentHash)
    host(item).storageSlots[0].controllerSlotIds = [99]
    expect(() => canonicalizeCatalogItemV13(item)).toThrow(/dangling/)
  })
  it('rejects malformed evidence, unsupported relationships, recursion and legacy units', () => {
    const variants: Array<(item: any) => void> = [
      (i) => { host(i).memory.slots = null },
      (i) => { host(i).memory.maxCapacityGb = 64 },
      (i) => { host(i).memory.maxCapacityMib = 1.5 },
      (i) => { host(i).storageSlots[0].controllerId = 1 },
      (i) => { host(i).storageSlots[0].id = '1' },
      (i) => { host(i).storageSlots.push({ ...host(i).storageSlots[0] }) },
      (i) => { i.fixedComponents[0].item.fixedComponents = [] },
      (i) => { host(i).fixedPorts = [{ id: 1 }] },
      (i) => { i.specs.$hliV13Evidence = 'empty-array' },
      (i) => { i.type = 'desktop' },
    ]
    for (const mutate of variants) {
      const item = laptopFixture()
      mutate(item)
      expect(() => canonicalizeCatalogItemV13(item)).toThrow()
    }
  })
  it('round-trips a mixed historical/laptop snapshot deterministically', async () => {
    const laptop = await digest(laptopFixture())
    const cpu = await digestCatalogTemplate({ type: 'cpu', name: 'Intel Core i5-10500T', manufacturer: 'Intel', family: 'Core i5', model: 'i5-10500T' })
    const snapshot = { schemaVersion: 1, catalogRevision: 1, generatedAt: '2026-01-01T00:00:00.000Z', manufacturerAliases: {}, templates: [
      { templateKey: 'synthetic-laptop', revision: 1, fingerprintVersion: 13, item: laptop.item, identityHash: laptop.identityHash, contentHash: laptop.contentHash },
      { templateKey: 'synthetic-cpu', revision: 1, fingerprintVersion: 3, item: cpu.item, identityHash: cpu.identityHash, contentHash: cpu.contentHash },
    ] }
    const first = await validateCatalogSnapshot(snapshot)
    expect(await validateCatalogSnapshot(JSON.parse(JSON.stringify(first)))).toEqual(first)
  })
})
