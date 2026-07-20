import { describe, expect, it } from 'vitest'
import {
  formatCpuCanvasLabel,
  formatCpuCanvasParts,
  formatEquipmentCanvasLabel,
  formatEquipmentCanvasParts,
  formatGpuCanvasLabel,
  formatGpuCanvasParts,
  formatInventoryCompactSpec,
  formatRamCanvasLabel,
  formatRamCanvasParts,
  formatRamSpec,
  formatStorageCanvasLabel,
  formatStorageCanvasParts,
  formatStorageSpec,
} from '@/lib/format'
import type { InventoryItem } from '@/types/inventory'

describe('formatting helpers', () => {
  it('formats TB storage capacity', () => {
    const item: InventoryItem = {
      id: 'stor-1tb',
      name: '1TB NVMe SSD',
      type: 'storage',
      specs: {
        capacityTb: 1,
        interface: 'NVMe',
      },
    }

    expect(formatStorageSpec(item)).toBe('1TB / NVMe')
  })

  it('formats GB storage capacity without a question-mark TB fallback', () => {
    const item: InventoryItem = {
      id: 'stor-256gb',
      name: '256GB NVMe SSD',
      type: 'storage',
      specs: {
        capacityGb: 256,
        interface: 'NVMe',
      },
    }

    expect(formatStorageSpec(item)).toBe('256GB / NVMe')
  })

  it('formats storage canvas labels from capacity, interface, and form factor', () => {
    const item: InventoryItem = {
      id: 'stor-1tb',
      name: '1TB NVMe',
      type: 'storage',
      specs: {
        capacityTb: 1,
        interface: 'NVMe',
        formFactor: '2280',
      },
    }

    expect(formatStorageCanvasLabel(item)).toBe('1TB NVMe 2280')
    expect(formatStorageCanvasParts(item)).toEqual([
      { label: 'capacity', value: '1TB' },
      { label: 'interface', value: 'NVMe' },
      { label: 'formFactor', value: '2280' },
    ])
  })

  it('formats RAM compact specs as module composition and speed', () => {
    const item: InventoryItem = {
      id: 'ram-32gb',
      name: '32GB DDR4',
      type: 'ram',
      specs: {
        capacityGb: 32,
        generation: 'DDR4',
      },
    }

    expect(formatRamSpec(item)).toBe('2x16GB')
  })

  it('formats RAM compact specs with mixed stick speeds', () => {
    const item: InventoryItem = {
      id: 'ram-32gb',
      name: '32GB DDR4',
      type: 'ram',
      specs: {
        capacityGb: 32,
        generation: 'DDR4',
        speedMt: 3200,
        secondarySpeedMt: 2666,
      },
    }

    expect(formatRamSpec(item)).toBe('2x16GB / 3200/2666MHz')
  })

  it('formats RAM canvas labels from mixed stick speeds', () => {
    const item: InventoryItem = {
      id: 'ram-32gb',
      name: '32GB DDR4',
      type: 'ram',
      specs: {
        capacityGb: 32,
        generation: 'DDR4',
        speedMt: 3200,
        secondarySpeedMt: 2666,
      },
    }

    expect(formatRamCanvasLabel(item)).toBe('32GB DDR4 2x16GB 3200/2666MHz')
    expect(formatRamCanvasParts(item)).toEqual([
      { label: 'capacity', value: '32GB' },
      { label: 'generation', value: 'DDR4' },
      { label: 'module', value: '2x16GB' },
      { label: 'speed', value: '3200/2666MHz' },
    ])
  })

  it('formats CPU canvas labels from split identity fields', () => {
    const item: InventoryItem = {
      id: 'cpu-i5',
      name: 'Intel Core i5-10500T',
      type: 'cpu',
      manufacturer: 'Intel',
      family: 'Core i5',
      number: 'i5-10500T',
      specs: {
        cores: 6,
        threads: 12,
      },
    }

    expect(formatCpuCanvasLabel(item)).toBe('Intel Core i5 i5-10500T 6C/12T')
    expect(formatCpuCanvasParts(item)).toEqual([
      { label: 'manufacturer', value: 'Intel' },
      { label: 'family', value: 'Core i5' },
      { label: 'number', value: 'i5-10500T' },
      { label: 'coresThreads', value: '6C/12T' },
    ])
  })

  it('formats GPU canvas labels from identity and form factor', () => {
    const item: InventoryItem = {
      id: 'gpu-a310',
      name: 'Intel Arc A310 LP',
      type: 'gpu',
      manufacturer: 'Intel',
      model: 'Arc A310 LP',
      specs: {
        formFactor: 'Low profile',
      },
    }

    expect(formatGpuCanvasLabel(item)).toBe('Intel Arc A310 LP Low profile')
    expect(formatGpuCanvasParts(item)).toEqual([
      { label: 'manufacturer', value: 'Intel' },
      { label: 'model', value: 'Arc A310 LP' },
      { label: 'formFactor', value: 'Low profile' },
    ])
  })

  it('formats switch canvas labels from port inventory', () => {
    const item: InventoryItem = {
      id: 'switch',
      name: 'Switch',
      type: 'switch',
      specs: {
        management: 'Managed',
      },
      ports: [
        { id: 'rj45-01', kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '2.5G' },
        { id: 'rj45-02', kind: 'switch-port', type: 'rj45', slotNumber: 2, speed: '2.5G' },
        { id: 'sfp-plus-01', kind: 'switch-port', type: 'sfp-plus', slotNumber: 3, speed: '10G' },
      ],
    }

    expect(formatEquipmentCanvasLabel(item)).toBe('2x 2.5G RJ45 1x 10G SFP+ Managed')
    expect(formatEquipmentCanvasParts(item)).toEqual([
      { label: 'ports', value: '2x 2.5G RJ45' },
      { label: 'uplinks', value: '1x 10G SFP+' },
      { label: 'management', value: 'Managed' },
    ])
  })

  it('formats patch panel canvas labels from keystone inventory', () => {
    const item: InventoryItem = {
      id: 'patch',
      name: 'Patch Panel',
      type: 'patchPanel',
      specs: {
        rackUnits: 1,
      },
      ports: [
        { id: 'keystone-01', kind: 'keystone', type: 'hdmi', slotNumber: 1 },
        { id: 'keystone-02', kind: 'keystone', type: 'hdmi', slotNumber: 2 },
      ],
    }

    expect(formatEquipmentCanvasLabel(item)).toBe('2x HDMI 1U')
    expect(formatEquipmentCanvasParts(item)).toEqual([
      { label: 'keystone', value: '2x HDMI' },
      { label: 'rackUnits', value: '1U' },
    ])
  })

  it.each([
    [{ id: 1, type: 'server', name: 'Server', specs: { formFactor: 'Mini' } }, 'Mini'],
    [{ id: 1, type: 'pcBuild', name: 'PC', specs: { formFactor: 'ATX', operatingSystem: 'Linux' } }, 'ATX / Linux'],
    [{ id: 1, type: 'cpuCooler', name: 'Cooler', specs: { coolerType: 'AIO', radiatorSizeMm: 240 } }, 'AIO / 240mm'],
    [{ id: 1, type: 'motherboard', name: 'Board', specs: { formFactor: 'ATX', socket: 'AM5', chipset: 'B650' } }, 'ATX / AM5 / B650'],
    [{ id: 1, type: 'network', name: 'NIC', specs: { speedMbps: 2500, interface: 'PCIe' } }, '2500Mbps / PCIe'],
    [{ id: 1, type: 'wireless', name: 'Wi-Fi', specs: { wifiGeneration: 'Wi-Fi 6E', interface: 'M.2 A+E' } }, 'Wi-Fi 6E / M.2 A+E'],
    [{ id: 1, type: 'soundCard', name: 'Sound', specs: { interface: 'PCIe', channels: '7.1' } }, 'PCIe / 7.1'],
    [{ id: 1, type: 'case', name: 'Case', specs: { formFactor: 'ATX' } }, 'ATX'],
    [{ id: 1, type: 'powerSupply', name: 'PSU', specs: { wattageWatts: 850, formFactor: 'ATX', efficiency: '80 Plus Gold' } }, '850W / ATX / 80 Plus Gold'],
    [{ id: 1, type: 'powerAdapter', name: 'Adapter', specs: { wattageWatts: 90, connector: 'Barrel' } }, '90W / Barrel'],
    [{ id: 1, type: 'nas', name: 'NAS', specs: { driveBays: 6, m2Slots: 2 } }, '6 bays / 2 M.2 slots'],
    [{ id: 1, type: 'monitor', name: 'Display', specs: { sizeInches: 27, resolution: '4K', refreshRateHz: 144 } }, '27" / 4K / 144Hz'],
    [{ id: 1, type: 'ups', name: 'UPS', specs: { capacityVa: 1500, outlets: 8 } }, '1500VA / 8 outlets'],
    [{ id: 1, type: 'powerStrip', name: 'Strip', specs: { outlets: 6, surgeProtectedOutlets: 3 } }, '6 outlets / 3 surge outlets'],
  ] as Array<[InventoryItem, string]>)('formats the compact inventory summary for %s', (item, expected) => {
    expect(formatInventoryCompactSpec(item)).toBe(expected)
  })
})
