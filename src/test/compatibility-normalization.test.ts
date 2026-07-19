import { describe, expect, it } from 'vitest'
import {
  normalizeComponentRequirements,
  normalizeHostCapabilities,
  parsePcieDescriptor,
} from '@/lib/compatibility'
import type { InventoryItem } from '@/types/inventory'

describe('compatibility normalization', () => {
  it('normalizes canonical RAM fields without inferring missing values', () => {
    expect(
      normalizeComponentRequirements({
        id: 1,
        type: 'ram',
        name: '32GB DDR4',
        specs: {
          capacityGb: 32,
          moduleCount: 2,
          generation: ' ddr4 ',
          speedMt: 3200,
        },
      }),
    ).toEqual({
      type: 'ram',
      capacityGb: 32,
      moduleCount: 2,
      moduleCapacityGb: 16,
      generation: 'DDR4',
      speedMt: 3200,
    })

    expect(
      normalizeComponentRequirements({
        id: 2,
        type: 'ram',
        name: '64GB DDR5 kit',
        specs: { capacityGb: 64, generation: 'DDR5' },
      }),
    ).toEqual({
      type: 'ram',
      capacityGb: 64,
      moduleCount: undefined,
      moduleCapacityGb: undefined,
      generation: 'DDR5',
      speedMt: undefined,
    })
  })

  it('normalizes canonical storage fields and optional PCIe descriptors', () => {
    expect(
      normalizeComponentRequirements({
        id: 3,
        type: 'storage',
        name: '4TB NVMe',
        specs: {
          capacityTb: 4,
          interface: ' nvme ',
          formFactor: ' 2280 ',
          pcie: 'PCIe 4.0 x4',
        },
      }),
    ).toEqual({
      type: 'storage',
      capacityGb: undefined,
      capacityTb: 4,
      interface: 'NVMe',
      formFactor: '2280',
      pcieGeneration: 4,
      connectorLanes: 4,
    })
  })

  it('uses structured expansion requirements ahead of deterministic legacy fields', () => {
    expect(
      normalizeComponentRequirements({
        id: 4,
        type: 'gpu',
        name: 'Example GPU',
        specs: { pcie: 'PCIe 4.0 x8', powerWatts: 75 },
        compatibility: {
          requirements: {
            expansion: {
              interfaceFamily: 'pcie',
              pcieGeneration: 3,
              connectorLanes: 16,
              height: 'low-profile',
            },
          },
        },
      }),
    ).toEqual({
      type: 'gpu',
      pcieGeneration: 3,
      connectorLanes: 16,
      powerWatts: 75,
      interfaceFamily: 'pcie',
      height: 'low-profile',
    })
  })

  it('parses a network card PCIe descriptor from its canonical interface field', () => {
    expect(
      normalizeComponentRequirements({
        id: 5,
        type: 'network',
        name: 'Example NIC',
        specs: {
          interface: '  PCIe 3.0   x8 ',
          formFactor: ' Low profile ',
          powerWatts: 12.5,
        },
      }),
    ).toEqual({
      type: 'network',
      pcieGeneration: 3,
      connectorLanes: 8,
      powerWatts: 12.5,
    })
  })

  it('reads CPU requirements only from the structured compatibility profile', () => {
    expect(
      normalizeComponentRequirements({
        id: 6,
        type: 'cpu',
        name: 'CPU name must not be parsed',
        specs: { socket: 'LGA1200', generation: '10', tdpWatts: 35 },
        compatibility: {
          requirements: {
            cpu: { socket: 'AM5', generation: 'Zen 4', tdpWatts: 65 },
          },
        },
      }),
    ).toEqual({
      type: 'cpu',
      socket: 'AM5',
      generation: 'Zen 4',
      tdpWatts: 65,
    })

    expect(
      normalizeComponentRequirements({
        id: 7,
        type: 'cpu',
        name: 'Intel Core i5-10500T',
        specs: { socket: 'LGA1200' },
      }),
    ).toEqual({ type: 'cpu' })
  })

  it('returns cloned host capabilities and does not expose the inventory object for mutation', () => {
    const item: InventoryItem = {
      id: 8,
      type: 'server',
      name: 'Example host',
      compatibility: {
        host: {
          cpu: { sockets: ['LGA1200'] },
          memory: { generations: ['DDR4'], slots: 2 },
        },
      },
    }

    const normalized = normalizeHostCapabilities(item)
    normalized.cpu?.sockets?.push('AM5')

    expect(item.compatibility?.host?.cpu?.sockets).toEqual(['LGA1200'])
    expect(normalizeHostCapabilities({ id: 9, type: 'server', name: 'Unknown host' })).toEqual({})
  })

  it('parses only explicit PCIe generation and lane descriptors', () => {
    expect(parsePcieDescriptor('PCIe 4.0 x8')).toEqual({
      pcieGeneration: 4,
      connectorLanes: 8,
    })
    expect(parsePcieDescriptor(' pcie 3 x16 ')).toEqual({
      pcieGeneration: 3,
      connectorLanes: 16,
    })
    expect(parsePcieDescriptor('M.2 NVMe')).toEqual({})
    expect(parsePcieDescriptor('PCIe x8')).toEqual({})
    expect(parsePcieDescriptor(null)).toEqual({})
  })

  it('preserves malformed and absent optional values as unknown', () => {
    expect(
      normalizeComponentRequirements({
        id: 10,
        type: 'ram',
        name: 'Malformed RAM',
        specs: {
          capacityGb: 'many',
          moduleCount: '   ',
          generation: '   ',
          speedMt: Number.NaN,
        },
      }),
    ).toEqual({
      type: 'ram',
      capacityGb: undefined,
      moduleCount: undefined,
      moduleCapacityGb: undefined,
      generation: undefined,
      speedMt: undefined,
    })
  })
})
