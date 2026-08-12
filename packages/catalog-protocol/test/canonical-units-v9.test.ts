import { describe, expect, it } from 'vitest'
import {
  CANONICAL_MEASUREMENT_CONFLICT,
  CANONICAL_MEASUREMENT_NOT_EXACT,
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  CanonicalMeasurementError,
  canonicalizeCatalogItemV9,
  digestCatalogTemplate,
  toBasisPoints,
  toBitsPerSecond,
  toBytes,
  toMhz,
  toMib,
  toMilliamps,
  toMilliCelsius,
  toMillihertz,
  toMillimeters,
  toMillivoltAmps,
  toMillivolts,
  toMilliwatts,
} from '../src'

describe('canonical catalog units v9', () => {
  it('converts every canonical unit with exact integer arithmetic', () => {
    expect(toMhz({ value: 2_300, unit: 'MHz' })).toBe(2_300)
    expect(toMhz({ value: 2.3, unit: 'GHz' })).toBe(2_300)
    expect(toMib({ value: 16_384, unit: 'MiB' })).toBe(16_384)
    expect(toMib({ value: 16, unit: 'GiB' })).toBe(16_384)
    expect(toBytes({ value: 1, unit: 'bytes' })).toBe(1)
    expect(toBytes({ value: 1, unit: 'KB' })).toBe(1_000)
    expect(toBytes({ value: 1, unit: 'MB' })).toBe(1_000_000)
    expect(toBytes({ value: 1, unit: 'GB' })).toBe(1_000_000_000)
    expect(toBytes({ value: 1, unit: 'TB' })).toBe(1_000_000_000_000)
    expect(toBytes({ value: 1, unit: 'KiB' })).toBe(1_024)
    expect(toBytes({ value: 1, unit: 'MiB' })).toBe(1_048_576)
    expect(toBytes({ value: 1, unit: 'GiB' })).toBe(1_073_741_824)
    expect(toBytes({ value: 1, unit: 'TiB' })).toBe(1_099_511_627_776)
    expect(toBitsPerSecond({ value: 1, unit: 'bps' })).toBe(1)
    expect(toBitsPerSecond({ value: 100, unit: 'Mbps' })).toBe(100_000_000)
    expect(toBitsPerSecond({ value: 2.5, unit: 'Gbps' })).toBe(2_500_000_000)
    expect(toMilliwatts({ value: 130_000, unit: 'mW' })).toBe(130_000)
    expect(toMilliwatts({ value: 130, unit: 'W' })).toBe(130_000)
    expect(toMillivolts({ value: 1_200, unit: 'mV' })).toBe(1_200)
    expect(toMillivolts({ value: 1.2, unit: 'V' })).toBe(1_200)
    expect(toMilliamps({ value: 2_500, unit: 'mA' })).toBe(2_500)
    expect(toMilliamps({ value: 2.5, unit: 'A' })).toBe(2_500)
    expect(toMillimeters({ value: 250, unit: 'mm' })).toBe(250)
    expect(toMillimeters({ value: 25, unit: 'cm' })).toBe(250)
    expect(toMillimeters({ value: 0.25, unit: 'm' })).toBe(250)
    expect(toMillimeters({ value: 10, unit: 'in' })).toBe(254)
    expect(toMilliCelsius({ value: 95_000, unit: 'mC' })).toBe(95_000)
    expect(toMilliCelsius({ value: 95, unit: 'C' })).toBe(95_000)
    expect(toBasisPoints({ value: 9_850, unit: 'basis-points' })).toBe(9_850)
    expect(toBasisPoints({ value: 98.5, unit: 'percent' })).toBe(9_850)
    expect(toMillihertz({ value: 60_000, unit: 'mHz' })).toBe(60_000)
    expect(toMillihertz({ value: 60, unit: 'Hz' })).toBe(60_000)
    expect(toMillivoltAmps({ value: 1_500_000, unit: 'mVA' })).toBe(1_500_000)
    expect(toMillivoltAmps({ value: 1_500, unit: 'VA' })).toBe(1_500_000)
  })

  it('rejects precision-losing, negative, non-finite, and unsafe values', () => {
    for (const callback of [
      () => toMhz({ value: 2.3001, unit: 'GHz' }),
      () => toMillimeters({ value: 27, unit: 'in' }),
      () => toMilliwatts({ value: -1, unit: 'W' }),
      () => toMilliwatts({ value: Number.POSITIVE_INFINITY, unit: 'W' }),
      () => toBytes({ value: Number.MAX_SAFE_INTEGER, unit: 'TiB' }),
    ]) expect(callback).toThrow(CanonicalMeasurementError)
  })

  it('canonicalizes CPU, RAM, ports, and compatibility without changing topology', () => {
    const cpu = canonicalizeCatalogItemV9({
      type: 'cpu', name: 'Intel Core i5-10500T', manufacturer: 'Intel', number: 'i5-10500T',
      specs: { baseClockGhz: 2.3, boostClockGhz: 3.8, tdpWatts: 35, maxTemperatureC: 100 },
      compatibility: { requirements: { cpu: { socket: 'LGA1200', generation: '10th Gen', tdpWatts: 35 } } },
    })
    expect(cpu.specs).toEqual({
      baseClockMhz: 2_300, boostClockMhz: 3_800, maxTemperatureMilliCelsius: 100_000, tdpMw: 35_000,
    })
    expect(cpu.compatibility).toEqual({
      requirements: { cpu: { socket: 'LGA1200', generation: '10th Gen', tdpMw: 35_000 } },
    })

    const ram = canonicalizeCatalogItemV9({
      type: 'ram', name: 'Module', manufacturer: 'Micron', number: 'MTA8ATF2G64HZ',
      specs: { capacityGb: 16, voltageVolts: 1.2, speedMt: 3_200 },
      compatibility: { requirements: { memory: { capacityGb: 16, speedMt: 3_200 } } },
    })
    expect(ram.specs).toEqual({ capacityMib: 16_384, speedMt: 3_200, voltageMv: 1_200 })
    expect(ram.compatibility).toEqual({ requirements: { memory: { capacityMib: 16_384, speedMt: 3_200 } } })

    const host = canonicalizeCatalogItemV9({
      type: 'desktop', name: 'Example', manufacturer: 'Example', model: 'One',
      ports: [{ id: 1, kind: 'network', type: 'rj45', slotNumber: 1, speed: '2.5G' }],
      compatibility: { host: {
        maxExpansionPowerWatts: 75,
        expansionSlots: [{ id: 1, key: 'pcie', count: 1, maxPowerWatts: 75 }],
        power: { supportedWattagesWatts: [65, 90] },
      } },
    })
    expect(host.ports?.[0]).toMatchObject({ speedBps: 2_500_000_000 })
    expect(host.ports?.[0]).not.toHaveProperty('speed')
    expect(host.compatibility).toEqual({ host: {
      maxExpansionPowerMw: 75_000,
      expansionSlots: [{ id: 1, key: 'pcie', count: 1, maxPowerMw: 75_000 }],
      power: { supportedPowerMw: [65_000, 90_000] },
    } })

    expect(canonicalizeCatalogItemV9({
      type: 'nas', name: 'NAS', manufacturer: 'Example', model: 'One',
      specs: {
        memoryGb: 16,
        maxPowerWatts: 65,
        voltageVolts: 12,
        currentAmps: 5.5,
        efficiencyPercent: 98.5,
      },
    }).specs).toEqual({
      currentMa: 5_500,
      efficiencyBasisPoints: 9_850,
      maxPowerMw: 65_000,
      memoryMib: 16_384,
      voltageMv: 12_000,
    })
  })

  it('accepts equivalent dual representations and rejects conflicts', () => {
    expect(canonicalizeCatalogItemV9({
      type: 'storage', name: 'Drive', manufacturer: 'Example', model: 'One',
      specs: { capacityTb: 1, capacityBytes: 1_000_000_000_000 },
    }).specs).toEqual({ capacityBytes: 1_000_000_000_000 })

    expect(() => canonicalizeCatalogItemV9({
      type: 'storage', name: 'Drive', manufacturer: 'Example', model: 'One',
      specs: { capacityTb: 1, capacityBytes: 1_000_000_000_001 },
    })).toThrowError(expect.objectContaining({ code: CANONICAL_MEASUREMENT_CONFLICT }))
  })

  it('rejects unsafe canonical values at nested compatibility and port paths', () => {
    for (const source of [
      {
        type: 'desktop', name: 'Host', manufacturer: 'Example', model: 'One',
        compatibility: { host: { cpu: { maxTdpMw: Number.MAX_SAFE_INTEGER + 1 } } },
      },
      {
        type: 'switch', name: 'Switch', manufacturer: 'Example', model: 'One',
        ports: [{ id: 1, kind: 'network', type: 'rj45', slotNumber: 1, speedBps: -1 }],
      },
    ]) expect(() => canonicalizeCatalogItemV9(source)).toThrowError(expect.objectContaining({
      code: 'canonical-measurement-invalid',
    }))
  })

  it('retains non-exact marketed monitor size as source text without inventing millimeters', () => {
    const item = canonicalizeCatalogItemV9({
      type: 'monitor', name: 'Display', manufacturer: 'Example', model: '27',
      specs: { sizeInches: 27, refreshRateHz: 60 },
    })
    expect(item.specs).toEqual({ diagonalSourceText: '27 in', refreshRateMillihz: 60_000 })
  })

  it('preserves unknown public fields and removes private instance fields', () => {
    const item = canonicalizeCatalogItemV9({
      id: 1, key: 'cpu:1', type: 'cpu', name: 'CPU', manufacturer: 'Example', model: 'One',
      serialNumber: 'private', scope: 'project', ownerProjectId: 1, usageRole: 'server', archivedAt: 1,
      lifecycle: { status: 'active', customName: 'lab-only' },
      specs: { socket: 'LGA1', vendorFeature: { tier: 'public' }, serialNumber: 'private' },
    }) as unknown as Record<string, unknown>
    expect(item.lifecycle).toEqual({ status: 'active' })
    expect(item).not.toHaveProperty('serialNumber')
    expect(item).not.toHaveProperty('id')
    expect(item).not.toHaveProperty('key')
    expect(item).not.toHaveProperty('scope')
    expect(item).not.toHaveProperty('ownerProjectId')
    expect(item).not.toHaveProperty('usageRole')
    expect(item).not.toHaveProperty('archivedAt')
    expect(item.specs).toEqual({ socket: 'LGA1', vendorFeature: { tier: 'public' } })
  })

  it('is idempotent and produces stable fingerprint-v9 hashes', async () => {
    const source = {
      type: 'powerAdapter', name: 'Dell 130W', manufacturer: 'Dell', model: 'LA130PM190',
      specs: { wattageWatts: 130, connector: 'Slim tip' },
    }
    const once = canonicalizeCatalogItemV9(source)
    expect(canonicalizeCatalogItemV9(once)).toEqual(once)
    const first = await digestCatalogTemplate(source, { fingerprintVersion: CANONICAL_UNITS_FINGERPRINT_VERSION })
    const second = await digestCatalogTemplate(once, { fingerprintVersion: CANONICAL_UNITS_FINGERPRINT_VERSION })
    expect(first).toMatchObject({ fingerprintVersion: 9, item: { ...once, name: 'Dell LA130PM190' } })
    expect(second.identityHash).toBe(first.identityHash)
    expect(second.contentHash).toBe(first.contentHash)
  })

  it('uses canonical capacity in standard category identity', async () => {
    const first = await digestCatalogTemplate({
      type: 'storage', name: 'Drive', manufacturer: 'Example', model: 'One', specs: { capacityTb: 1, interface: 'NVMe' },
    }, { fingerprintVersion: 9 })
    const second = await digestCatalogTemplate({
      type: 'storage', name: 'Drive', manufacturer: 'Example', model: 'One', specs: { capacityBytes: 1_000_000_000_000, interface: 'NVMe' },
    }, { fingerprintVersion: 9 })
    expect(second.identityPayload).toMatchObject({ capacityBytes: 1_000_000_000_000 })
    expect(second.identityHash).toBe(first.identityHash)
  })

  it('reports ambiguous cache units instead of silently relabeling them', () => {
    expect(() => canonicalizeCatalogItemV9({
      type: 'cpu', name: 'CPU', manufacturer: 'Example', model: 'One', specs: { cacheMb: 12 },
    })).toThrowError(expect.objectContaining({ code: CANONICAL_MEASUREMENT_NOT_EXACT }))
  })
})
