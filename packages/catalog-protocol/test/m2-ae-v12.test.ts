import { describe, expect, it } from 'vitest'
import {
  M2_AE_FINGERPRINT_VERSION,
  canonicalizeCatalogItemV12,
  digestCatalogTemplate,
  moduleKeyFitsSocket,
  normalizeUsbGenerationV12,
  usbGenerationAtLeastV12,
} from '../src'

const host = {
  type: 'desktop',
  name: 'Example Micro',
  manufacturer: 'Example',
  model: 'Micro 1',
  specs: { topologyCompleteness: 'complete', motherboardPartNumber: 'BOARD-1' },
  compatibility: { host: { optionalModuleSlots: [{
    id: 1,
    key: 'm2-ae-slot',
    keyAliases: ['wlan-m2'],
    count: 1,
    label: 'M.2 Key E slot',
    interfaceFamily: 'm2-ae',
    socketKeys: ['E'],
    moduleSizes: ['2230'],
    availableBuses: [
      { family: 'usb', usbGeneration: 'USB 2.0' },
      { family: 'pcie', lanes: 1, pcieGeneration: 3 },
    ],
    intendedModuleKinds: ['wireless-card'],
  }] } },
} as const

const adapter = {
  type: 'network',
  name: 'Example A+E Ethernet',
  manufacturer: 'Example',
  model: 'AE-1G',
  specs: {
    networkTechnology: 'ethernet',
    formFactor: 'm2-2230',
    operatingModes: ['ethernet'],
    hostInterface: {
      family: 'm2-ae',
      key: 'A+E',
      moduleSize: '2230',
      requiredBuses: [{ family: 'pcie', minimumLanes: 1, minimumPcieGeneration: 2 }],
    },
  },
  ports: [{
    id: 1,
    key: 'port-1',
    kind: 'network',
    type: 'rj45',
    slotNumber: 1,
    speedBps: 1_000_000_000,
    supportedSpeedsBps: [1_000_000_000],
    networkTechnology: 'ethernet',
    operatingModes: ['ethernet'],
    origin: 'module',
  }],
} as const

describe('catalog fingerprint v12', () => {
  it('implements the frozen socket-key versus module-key matrix', () => {
    expect(moduleKeyFitsSocket('A', 'A')).toBe(true)
    expect(moduleKeyFitsSocket('A', 'E')).toBe(false)
    expect(moduleKeyFitsSocket('E', 'A')).toBe(false)
    expect(moduleKeyFitsSocket('E', 'E')).toBe(true)
    expect(moduleKeyFitsSocket('A+E', 'A')).toBe(true)
    expect(moduleKeyFitsSocket('A+E', 'E')).toBe(true)
    expect(moduleKeyFitsSocket('B+M', 'E')).toBe(false)
  })

  it('normalizes legacy USB names only at an explicit import boundary', () => {
    expect(normalizeUsbGenerationV12('2.0')).toBeUndefined()
    expect(normalizeUsbGenerationV12('2.0', { legacyBoundary: true })).toBe('USB 2.0')
    expect(normalizeUsbGenerationV12('USB 3.2 Gen 2')).toBe('USB 3.2 Gen 2')
    expect(normalizeUsbGenerationV12('USB 7.0', { legacyBoundary: true })).toBeUndefined()
    expect(usbGenerationAtLeastV12('USB4 40Gbps', 'USB 3.2 Gen 2x2')).toBe(true)
  })

  it('preserves absent, explicit-empty, and populated bus evidence', () => {
    const absent = structuredClone(host) as any
    delete absent.compatibility.host.optionalModuleSlots[0].availableBuses
    expect(canonicalizeCatalogItemV12(absent).compatibility?.host?.optionalModuleSlots?.[0]).not.toHaveProperty('availableBuses')

    const empty = structuredClone(host) as any
    empty.compatibility.host.optionalModuleSlots[0].availableBuses = []
    expect(canonicalizeCatalogItemV12(empty).compatibility?.host?.optionalModuleSlots?.[0]).toMatchObject({ availableBuses: [] })

    const populated = canonicalizeCatalogItemV12(host) as any
    expect(populated.compatibility.host.optionalModuleSlots[0].availableBuses).toEqual([
      { family: 'pcie', lanes: 1, pcieGeneration: 3 },
      { family: 'usb', usbGeneration: 'USB 2.0' },
    ])
  })

  it('rejects duplicate bus families and legacy canonical field names', () => {
    const duplicate = structuredClone(host) as any
    duplicate.compatibility.host.optionalModuleSlots[0].availableBuses.push({ family: 'pcie', lanes: 1 })
    expect(() => canonicalizeCatalogItemV12(duplicate)).toThrow(/duplicate family pcie/i)

    const legacy = structuredClone(host) as any
    legacy.compatibility.host.optionalModuleSlots[0].aliases = ['old-key']
    expect(() => canonicalizeCatalogItemV12(legacy)).toThrow(/keyAliases and socketKeys/i)
  })

  it('rejects aliases that collide across host resource collections', () => {
    const collision = structuredClone(host) as any
    collision.compatibility.host.expansionSlots = [{
      id: 2,
      key: 'wlan-m2',
      count: 1,
      label: 'Conflicting resource',
      interfaceFamily: 'pcie',
    }]
    expect(() => canonicalizeCatalogItemV12(collision)).toThrow(/alias wlan-m2 conflicts/i)
  })

  it('does not perform application relationship migrations during canonicalization', () => {
    const legacy = structuredClone(host) as any
    legacy.compatibility.host.optionalModuleSlots = []
    legacy.compatibility.host.expansionSlots = [{
      id: 7,
      key: 'm2-ae-slot',
      count: 1,
      label: 'M.2 2230 A/E WLAN slot',
      interfaceFamily: 'm2-ae',
      keying: 'A+E',
      moduleSize: '2230',
    }]

    const canonical = canonicalizeCatalogItemV12(legacy) as any

    expect(canonical.compatibility.host.expansionSlots).toEqual(legacy.compatibility.host.expansionSlots)
    expect(canonical.compatibility.host.optionalModuleSlots).toEqual([])
  })

  it('canonicalizes plural component requirements with AND semantics represented as a list', () => {
    const canonical = canonicalizeCatalogItemV12(adapter) as any
    expect(canonical.specs.hostInterface.requiredBuses).toEqual([
      { family: 'pcie', minimumLanes: 1, minimumPcieGeneration: 2 },
    ])
    expect(canonical.compatibility.requirements.expansion.requiredBuses).toEqual(
      canonical.specs.hostInterface.requiredBuses,
    )
  })

  it('keeps aliases and intended use identity-neutral but content-material', async () => {
    const base = await digestCatalogTemplate(host, { fingerprintVersion: M2_AE_FINGERPRINT_VERSION })
    const changed = structuredClone(host) as any
    changed.compatibility.host.optionalModuleSlots[0].keyAliases = ['legacy-wlan', 'wlan-m2']
    changed.compatibility.host.optionalModuleSlots[0].intendedModuleKinds = ['wired-network-card']
    const changedDigest = await digestCatalogTemplate(changed, { fingerprintVersion: M2_AE_FINGERPRINT_VERSION })
    expect(base.identityHash).toBe(changedDigest.identityHash)
    expect(base.contentHash).not.toBe(changedDigest.contentHash)
    expect(base.fingerprintVersion).toBe(12)
  })
})
