import type { InventoryFormValues } from './model'
import type { InventoryType } from '@/types/inventory'

export type InventoryFormPlaceholders = Partial<Record<keyof InventoryFormValues, string>> & {
  name: string
  manufacturer: string
  model: string
}

export const INVENTORY_FORM_PLACEHOLDERS: Record<InventoryType, InventoryFormPlaceholders> = {
  server: {
    name: 'Dell OptiPlex Micro 7090',
    manufacturer: 'Dell',
    model: 'OptiPlex Micro 7090',
  },
  nas: {
    name: 'Synology DS1621+',
    manufacturer: 'Synology',
    model: 'DS1621+',
    driveBays: '6',
    m2Slots: '2',
  },
  cpu: {
    name: 'Intel Core i5-10500T',
    manufacturer: 'Select manufacturer',
    model: 'Core i5-10500T',
    family: 'Core i5',
    number: 'i5-10500T',
    cores: '6',
    threads: '12',
    baseClockGhz: '2.3',
    boostClockGhz: '3.8',
  },
  ram: {
    name: 'Crucial 32GB DDR4 Kit',
    manufacturer: 'Crucial',
    model: 'CT2K16G4SFRA32A',
    capacityGb: '32',
    secondaryManufacturer: 'Same as stick 1',
  },
  storage: {
    name: 'Samsung 990 EVO Plus 4TB',
    manufacturer: 'Samsung',
    model: '990 EVO Plus',
    capacity: '4',
  },
  gpu: {
    name: 'Intel Arc A310',
    manufacturer: 'Select manufacturer',
    model: 'Arc A310',
    vramGb: '4',
  },
  network: {
    name: 'Intel I226-V 2.5G NIC',
    manufacturer: 'Intel',
    model: 'I226-V',
  },
  switch: {
    name: 'TP-Link Omada ES210X-M2',
    manufacturer: 'TP-Link',
    model: 'ES210X-M2',
    switchingCapacityGbps: '80',
  },
  patchPanel: {
    name: 'VCELINK 24-Port Cat6A Patch Panel',
    manufacturer: 'VCELINK',
    model: '24-Port Keystone Patch Panel',
    rackUnits: '1',
    mount: 'Rack mounted',
  },
  pcBuild: {
    name: 'Custom PC',
    manufacturer: 'Custom',
    model: 'Desktop build',
  },
  motherboard: {
    name: 'ASUS TUF Gaming B650-PLUS',
    manufacturer: 'ASUS',
    model: 'TUF Gaming B650-PLUS',
  },
  cpuCooler: {
    name: 'Noctua NH-D15',
    manufacturer: 'Noctua',
    model: 'NH-D15',
  },
  case: {
    name: 'Fractal Design North',
    manufacturer: 'Fractal Design',
    model: 'North',
  },
  powerSupply: {
    name: 'Corsair RM850x',
    manufacturer: 'Corsair',
    model: 'RM850x',
  },
  soundCard: {
    name: 'Creative Sound Blaster AE-7',
    manufacturer: 'Creative',
    model: 'Sound Blaster AE-7',
  },
  wireless: {
    name: 'Intel AX210 Wi-Fi 6E',
    manufacturer: 'Intel',
    model: 'AX210',
  },
  powerAdapter: {
    name: 'Dell 90W AC Adapter',
    manufacturer: 'Dell',
    model: '90W AC Adapter',
  },
  monitor: {
    name: 'Dell UltraSharp U2723QE',
    manufacturer: 'Dell',
    model: 'UltraSharp U2723QE',
  },
  ups: {
    name: 'APC Back-UPS Pro 1500',
    manufacturer: 'APC',
    model: 'BR1500MS2',
  },
  powerStrip: {
    name: 'Kasa Smart Plug Power Strip',
    manufacturer: 'TP-Link',
    model: 'HS300',
  },
}

export function getInventoryFormPlaceholders(type: InventoryType): InventoryFormPlaceholders {
  return INVENTORY_FORM_PLACEHOLDERS[type]
}
