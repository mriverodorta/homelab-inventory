import { describe, expect, it } from 'bun:test'
import { projectCatalogTemplateForRuntime } from './catalog-runtime-projection.mjs'

function template(item, fingerprintVersion) {
  return {
    templateKey: `fixture-${item.type}-${fingerprintVersion}`,
    revision: 4,
    fingerprintVersion,
    identityHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    item,
  }
}

describe('catalog runtime projection', () => {
  it('canonicalizes historical RAM without mutating signed metadata or source data', () => {
    const source = template({
      type: 'ram',
      name: '8GB DDR3L',
      manufacturer: 'Example',
      specs: { capacityGb: 8, generation: 'DDR3L', voltageVolts: 1.35 },
      compatibility: { requirements: { memory: { capacityGb: 8 } } },
    }, 8)
    const before = structuredClone(source)

    const projected = projectCatalogTemplateForRuntime(source)

    expect(projected).toMatchObject({
      templateKey: source.templateKey,
      revision: 4,
      fingerprintVersion: 8,
      identityHash: source.identityHash,
      contentHash: source.contentHash,
      runtimeCanonicalVersion: 9,
      item: {
        specs: { capacityMib: 8192, voltageMv: 1350 },
        compatibility: { requirements: { memory: { capacityMib: 8192 } } },
      },
    })
    expect(projected.item.specs.capacityGb).toBeUndefined()
    expect(source).toEqual(before)
  })

  it('canonicalizes historical storage capacity exactly', () => {
    const projected = projectCatalogTemplateForRuntime(template({
      type: 'storage',
      name: '4TB SSD',
      specs: { capacityTb: 4, interface: 'NVMe' },
    }, 3))

    expect(projected.item.specs).toMatchObject({ capacityBytes: 4_000_000_000_000, interface: 'NVMe' })
    expect(projected.item.specs.capacityTb).toBeUndefined()
  })

  it('preserves ambiguous historical cache values while canonicalizing exact fields', () => {
    const projected = projectCatalogTemplateForRuntime(template({
      type: 'cpu',
      name: 'Historical CPU',
      specs: { cacheMb: 12, baseClockGhz: 2.5, tdpWatts: 65 },
    }, 3))

    expect(projected.item.specs).toMatchObject({ cacheMb: 12, baseClockMhz: 2500, tdpMw: 65_000 })
    expect(projected.item.specs.cacheMib).toBeUndefined()
  })

  it('preserves ambiguous historical measurement text while indexing exact related values', () => {
    const projected = projectCatalogTemplateForRuntime(template({
      type: 'gpu',
      name: 'Historical GPU',
      specs: { vramGb: 4, powerWatts: '40-75W' },
      compatibility: { requirements: { expansion: { powerWatts: 75 } } },
    }, 3))

    expect(projected.item.specs).toEqual({ vramMib: 4096, powerWatts: '40-75W' })
    expect(projected.item.compatibility.requirements.expansion).toEqual({ powerMw: 75_000 })
  })

  it('validates v9 records and preserves canonical measurements', () => {
    const projected = projectCatalogTemplateForRuntime(template({
      type: 'cpu',
      name: 'Canonical CPU',
      specs: { baseClockMhz: 2300, tdpMw: 35_000 },
    }, 9))

    expect(projected).toMatchObject({
      runtimeCanonicalVersion: 9,
      item: { specs: { baseClockMhz: 2300, tdpMw: 35_000 } },
    })
  })

  it('preserves strict v10 fixed-component and power topology', () => {
    const projected = projectCatalogTemplateForRuntime(template({
      type: 'nas',
      name: 'Fixed adapter NAS',
      fixedComponents: [{
        id: 1,
        componentType: 'cpu',
        disposition: 'soldered',
        label: 'Embedded CPU',
        item: { type: 'cpu', name: 'Embedded CPU' },
      }],
      compatibility: {
        host: {
          power: {
            configuration: 'external-adapter',
            adapterDisposition: 'fixed',
            connector: 'barrel',
          },
        },
      },
    }, 10))

    expect(projected).toMatchObject({
      runtimeCanonicalVersion: 10,
      item: {
        fixedComponents: [{ disposition: 'soldered' }],
        compatibility: { host: { power: { adapterDisposition: 'fixed' } } },
      },
    })
  })

  it('preserves v12 M.2 A/E socket semantics and tri-state bus evidence', () => {
    const item = {
      type: 'desktop',
      name: 'Canonical M.2 host',
      compatibility: { host: { optionalModuleSlots: [{
        id: 1,
        key: 'm2-ae-slot',
        keyAliases: ['wlan-m2'],
        count: 1,
        label: 'M.2 Key E slot',
        interfaceFamily: 'm2-ae',
        socketKeys: ['E'],
        moduleSizes: ['2230'],
        availableBuses: [],
        intendedModuleKinds: ['wireless-card'],
      }] } },
    }
    const projected = projectCatalogTemplateForRuntime(template(item, 12))

    expect(projected.runtimeCanonicalVersion).toBe(12)
    expect(projected.item.compatibility.host.optionalModuleSlots[0]).toEqual(
      item.compatibility.host.optionalModuleSlots[0],
    )
  })

  it('rejects conflicting historical measurements', () => {
    expect(() => projectCatalogTemplateForRuntime(template({
      type: 'ram',
      name: 'Conflicting RAM',
      specs: { capacityGb: 8, capacityMib: 4096 },
    }, 8))).toThrow('conflicts')
  })

  it('rejects malformed canonical measurements in historical records', () => {
    expect(() => projectCatalogTemplateForRuntime(template({
      type: 'ram',
      name: 'Malformed canonical RAM',
      specs: { capacityMib: '8192' },
    }, 8))).toThrow('finite non-negative number')
  })
})
