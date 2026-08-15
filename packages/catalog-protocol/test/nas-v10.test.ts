import { describe, expect, it } from 'vitest'
import fixture from './fixtures/server-specs-inventory-nas-v10.json'
import {
  NAS_FINGERPRINT_VERSION,
  canonicalizeCatalogItemV10,
  digestCatalogTemplate,
} from '../src'

const nas = {
  type: 'nas',
  name: 'Example NAS',
  manufacturer: 'Example',
  family: 'Storage',
  model: 'NAS-6',
  specs: {
    formFactor: 'Desktop',
    topologyCompleteness: 'complete',
    widthMm: 151,
    heightMm: 121,
    depthMm: 175,
    massGrams: 1_400,
  },
  ports: [{
    id: 1,
    key: 'lan-1',
    kind: 'network',
    type: 'rj45',
    slotNumber: 1,
    speedBps: 1_000_000_000,
    origin: 'fixed',
  }],
  fixedComponents: [{
    id: 1,
    componentType: 'cpu',
    disposition: 'soldered',
    label: 'Soldered processor',
    item: {
      type: 'cpu',
      name: 'Example CPU',
      manufacturer: 'Example',
      model: 'CPU-1',
      specs: { cores: 2, threads: 2, tdpMw: 10_000 },
    },
  }],
  compatibility: {
    host: {
      memory: {
        slots: 2,
        generations: ['DDR3L'],
        formFactors: ['SO-DIMM'],
        moduleTypes: ['UDIMM'],
        oemMaxCapacityMib: 6_144,
        verifiedMaxCapacityMib: 16_384,
      },
      storageSlots: [{
        id: 1,
        key: 'sata-bays',
        label: 'SATA drive bays',
        count: 6,
        interfaces: ['SATA'],
        formFactors: ['2.5-inch'],
        hotSwap: true,
      }],
      expansionSlots: [],
      optionalModuleSlots: [],
      power: {
        configuration: 'external-adapter',
        adapterDisposition: 'fixed',
        connector: '4-pin DIN',
        supportedPowerMw: [65_000],
        adapterRequired: true,
      },
      topologyCompleteness: 'complete',
    },
  },
} as const

describe('NAS catalog protocol v10', () => {
  it('consumes the frozen registry fixture without changing its contract hashes', async () => {
    const digest = await digestCatalogTemplate(fixture.item, {
      fingerprintVersion: NAS_FINGERPRINT_VERSION,
    })

    expect(digest.fingerprintVersion).toBe(fixture.fingerprintVersion)
    expect(digest.identityHash).toBe(fixture.identityHash)
    expect(digest.contentHash).toBe(fixture.contentHash)
    expect(digest.item).toEqual(fixture.item)
  })

  it('preserves fixed components, canonical measurements, and explicit power ownership', () => {
    expect(canonicalizeCatalogItemV10(nas)).toMatchObject({
      fixedComponents: [{
        id: 1,
        componentType: 'cpu',
        disposition: 'soldered',
        item: { specs: { tdpMw: 10_000 } },
      }],
      compatibility: { host: {
        memory: { oemMaxCapacityMib: 6_144, verifiedMaxCapacityMib: 16_384 },
        power: { configuration: 'external-adapter', adapterDisposition: 'fixed' },
      } },
    })
  })

  it('treats fixed topology and adapter ownership as material NAS identity', async () => {
    const base = await digestCatalogTemplate(nas, { fingerprintVersion: NAS_FINGERPRINT_VERSION })
    const changedCpu = await digestCatalogTemplate({
      ...nas,
      fixedComponents: [{
        ...nas.fixedComponents[0],
        item: { ...nas.fixedComponents[0].item, model: 'CPU-2' },
      }],
    }, { fingerprintVersion: NAS_FINGERPRINT_VERSION })
    const changedPower = await digestCatalogTemplate({
      ...nas,
      compatibility: { host: {
        ...nas.compatibility.host,
        power: { ...nas.compatibility.host.power, adapterDisposition: 'replaceable' as const },
      } },
    }, { fingerprintVersion: NAS_FINGERPRINT_VERSION })

    expect(base.fingerprintVersion).toBe(10)
    expect(changedCpu.identityHash).not.toBe(base.identityHash)
    expect(changedPower.identityHash).not.toBe(base.identityHash)
  })

  it('keeps aliases content-only without changing NAS identity', async () => {
    const base = await digestCatalogTemplate(nas, { fingerprintVersion: NAS_FINGERPRINT_VERSION })
    const changed = await digestCatalogTemplate({
      ...nas,
      aliases: ['DS620 slim'],
    }, { fingerprintVersion: NAS_FINGERPRINT_VERSION })

    expect(changed.identityHash).toBe(base.identityHash)
    expect(changed.contentHash).not.toBe(base.contentHash)
  })

  it('requires explicit external-adapter ownership and rejects it for internal PSUs', () => {
    const missingDisposition = {
      ...nas,
      compatibility: { host: {
        ...nas.compatibility.host,
        power: {
          configuration: 'external-adapter',
          connector: '4-pin DIN',
          supportedPowerMw: [65_000],
        },
      } },
    }
    const internalWithDisposition = {
      ...nas,
      compatibility: { host: {
        ...nas.compatibility.host,
        power: { configuration: 'internal-psu', adapterDisposition: 'fixed' },
      } },
    }

    expect(() => canonicalizeCatalogItemV10(missingDisposition)).toThrow(/adapterDisposition/)
    expect(() => canonicalizeCatalogItemV10(internalWithDisposition)).toThrow(/must be omitted/)
  })

  it('supports the shared fixed-component shape on future host classes', () => {
    expect(canonicalizeCatalogItemV10({
      type: 'desktop',
      name: 'Example SBC',
      fixedComponents: nas.fixedComponents,
    }).fixedComponents).toHaveLength(1)
  })

  it('rejects duplicate relational IDs and legacy measurements', () => {
    expect(() => canonicalizeCatalogItemV10({
      ...nas,
      fixedComponents: [nas.fixedComponents[0], nas.fixedComponents[0]],
    })).toThrow(/unique positive safe integer/)
    expect(() => canonicalizeCatalogItemV10({
      ...nas,
      specs: { ...nas.specs, powerWatts: 65 },
    })).toThrow(/legacy measurement/)
  })

  it('is deterministic and idempotent', async () => {
    const once = canonicalizeCatalogItemV10(nas)
    expect(canonicalizeCatalogItemV10(once)).toEqual(once)
    const first = await digestCatalogTemplate(nas, { fingerprintVersion: NAS_FINGERPRINT_VERSION })
    const second = await digestCatalogTemplate(once, { fingerprintVersion: NAS_FINGERPRINT_VERSION })
    expect(second.identityHash).toBe(first.identityHash)
    expect(second.contentHash).toBe(first.contentHash)
  })
})
