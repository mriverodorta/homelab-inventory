import { describe, expect, test } from 'bun:test'
import {
  INVENTORY_FIELD_CONTRACT,
  SUPPORTED_INVENTORY_FIELDS,
  assertExtensionsContainOnlyUnknownFields,
} from './field-contract.ts'

describe('inventory persistence field contract', () => {
  test('maps every field emitted by current forms and registry adapters', () => {
    const commonPaths = [
      'type',
      'name',
      'aliases',
      'manufacturer',
      'secondaryManufacturer',
      'model',
      'family',
      'number',
      'subtype',
      'properties',
      'compatibility',
      'fixedComponents',
      'notes',
      'archivedAt',
    ]
    const typePaths = {
      server: ['hardwareClass', 'usageRole', 'specs.formFactor', 'specs.networkSlot', 'specs.wireless', 'ports'],
      nas: [
        'specs.driveBays',
        'specs.m2Slots',
        'specs.powerConfiguration',
        'specs.formFactor',
        'specs.platformFamily',
        'specs.variantKey',
        'specs.hardwareRevision',
        'specs.boardRevision',
        'specs.releaseDate',
        'specs.discontinued',
        'specs.widthMm',
        'specs.heightMm',
        'specs.depthMm',
        'specs.massGrams',
        'specs.rackUnits',
        'ports',
      ],
      pcBuild: ['specs.operatingSystem', 'specs.role'],
      cpu: [
        'specs.cores',
        'specs.threads',
        'specs.baseClockMhz',
        'specs.baseClockGhz',
        'specs.boostClockMhz',
        'specs.boostClockGhz',
      ],
      ram: [
        'specs.capacityMib',
        'specs.capacityGb',
        'specs.generation',
        'specs.speedMt',
        'specs.formFactor',
        'specs.moduleType',
        'specs.ecc',
        'specs.rank',
        'specs.voltageMv',
        'specs.voltageVolts',
      ],
      storage: [
        'specs.capacityBytes',
        'specs.capacityGb',
        'specs.capacityTb',
        'specs.interface',
        'specs.formFactor',
        'specs.serialNumber',
        'specs.partitionTable',
      ],
      gpu: ['specs.vramMib', 'specs.vramGb', 'specs.formFactor', 'specs.slotWidth', 'specs.pcie', 'ports'],
      network: [
        'specs.ports',
        'specs.maxSpeedBps',
        'specs.speedMbps',
        'specs.interface',
        'specs.formFactor',
        'ports',
      ],
      motherboard: [
        'specs.chipset',
        'specs.formFactor',
        'specs.boardRevision',
        'specs.launchDate',
        'specs.discontinued',
        'specs.wifiGeneration',
        'specs.bluetooth',
        'ports',
      ],
      cpuCooler: ['specs.coolerType'],
      case: ['specs.formFactors'],
      powerSupply: [
        'specs.formFactor',
        'specs.ratedPowerMw',
        'specs.wattageWatts',
        'specs.efficiency',
        'specs.connectors',
      ],
      soundCard: ['specs.interface'],
      wireless: ['specs.interface', 'specs.wifiGeneration', 'specs.bluetooth'],
      powerAdapter: ['specs.ratedPowerMw', 'specs.wattageWatts', 'specs.connector'],
      switch: [
        'specs.management',
        'specs.switchingCapacityBps',
        'specs.switchingCapacityGbps',
        'specs.fanless',
        'ports',
      ],
      patchPanel: ['specs.rackUnits', 'specs.mount', 'ports'],
      monitor: [
        'specs.diagonalMm',
        'specs.diagonalSourceText',
        'specs.sizeInches',
        'specs.resolution',
        'specs.refreshRateMillihz',
        'specs.refreshRateHz',
      ],
      ups: [
        'specs.ratedPowerMw',
        'specs.wattageWatts',
        'specs.capacityMillivoltAmps',
        'specs.capacityVa',
        'specs.batteryBackupOutlets',
        'specs.surgeProtectedOutlets',
        'specs.outlets',
      ],
      powerStrip: ['specs.outlets', 'specs.surgeProtected', 'specs.surgeProtectedOutlets', 'smart'],
    } as const

    const expectedKeys = Object.entries(typePaths).flatMap(([type, paths]) => (
      [...commonPaths, ...paths].map((path) => `${type}.${path}`)
    )).sort()

    expect([...INVENTORY_FIELD_CONTRACT.keys()].sort()).toEqual(expectedKeys)
    for (const key of expectedKeys) {
      expect(INVENTORY_FIELD_CONTRACT.get(key), key).toBeDefined()
    }
  })

  test('covers every current inventory category with a subtype table', () => {
    const mappedTypes = new Set(SUPPORTED_INVENTORY_FIELDS.map((field) => field.type))
    expect([...mappedTypes].sort()).toEqual([
      'case',
      'cpu',
      'cpuCooler',
      'gpu',
      'monitor',
      'motherboard',
      'nas',
      'network',
      'patchPanel',
      'pcBuild',
      'powerAdapter',
      'powerStrip',
      'powerSupply',
      'ram',
      'server',
      'soundCard',
      'storage',
      'switch',
      'ups',
      'wireless',
    ])
  })

  test('rejects supported fields from forward-compatible extensions', () => {
    expect(() => assertExtensionsContainOnlyUnknownFields('cpu', {
      baseClockGhz: 2.3,
    })).toThrow(/supported field/iu)

    expect(() => assertExtensionsContainOnlyUnknownFields('cpu', {
      futureVendorField: 'preserved',
    })).not.toThrow()
  })
})
