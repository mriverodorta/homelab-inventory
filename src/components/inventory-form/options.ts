import { SWITCH_NETWORK_PORT_SPEEDS } from '@/lib/switch-ports'
import type {
  InventoryPortRole,
  InventoryPortType,
  InventoryType,
} from '@/types/inventory'

export function fieldClassName(): string {
  return 'w-full border-[#ded8ce] bg-[#fffdf8] text-[#20242c] placeholder:text-[#8d857b]'
}

export const INVENTORY_TYPES: InventoryType[] = [
  'server',
  'nas',
  'pcBuild',
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
  'motherboard',
  'cpuCooler',
  'case',
  'powerSupply',
  'soundCard',
  'wireless',
  'powerAdapter',
  'switch',
  'patchPanel',
  'monitor',
  'ups',
  'powerStrip',
]

export const TYPE_LABELS: Partial<Record<InventoryType, string>> = {
  server: 'Server',
  nas: 'NAS',
  pcBuild: 'PC Build',
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'Storage',
  gpu: 'GPU',
  network: 'Network Card',
  motherboard: 'Motherboard',
  cpuCooler: 'CPU Cooler',
  case: 'Case',
  powerSupply: 'Power Supply',
  soundCard: 'Sound Card',
  wireless: 'Wireless Card',
  powerAdapter: 'Power Adapter',
  switch: 'Switch',
  patchPanel: 'Patch Panel',
  monitor: 'Monitor',
  ups: 'UPS',
  powerStrip: 'Power Strip',
}

export const PORT_TYPES: InventoryPortType[] = [
  'rj45',
  'sfp',
  'sfp-plus',
  'hdmi',
  'displayport',
  'mini-displayport',
  'barrel',
]

export const PORT_ROLES: InventoryPortRole[] = [
  'access',
  'trunk',
  'uplink',
  'management',
  'disabled',
]

export const PORT_SPEEDS = ['', ...SWITCH_NETWORK_PORT_SPEEDS]
export const RAM_SPEEDS = ['', '1600', '1866', '2133', '2400', '2666', '2933', '3200', '3600', '4800', '5600']
export const NAS_POWER_CONFIGURATION_OPTIONS = [
  { value: 'internal-psu', label: 'Internal PSU' },
  { value: 'external-adapter', label: 'External power adapter' },
] as const
export const STORAGE_FORM_FACTORS = ['', '2230', '2242', '2260', '2280', '2.5"', '3.5"', 'eMMC']
export const SERVER_FORM_FACTORS = ['Tiny', 'Mini', 'Micro', 'Small', 'SFF', 'Tower', 'Mini-ITX', 'Micro-ATX', 'ATX', 'E-ATX']
export const NETWORK_SLOTS = ['On board', 'PCIe', 'M.2 A+E']
export const WIRELESS_OPTIONS = ['Yes', 'No']
export const CPU_MANUFACTURERS = ['Intel', 'AMD', 'ARM']
export const CPU_SOCKET_SUGGESTIONS = ['LGA1151', 'LGA1200', 'LGA1700', 'AM4', 'AM5', 'SP3', 'SP5']
export const CPU_GENERATIONS = [
  'Intel 7th Gen',
  'Intel 8th Gen',
  'Intel 9th Gen',
  'Intel 10th Gen',
  'Intel 11th Gen',
  'Intel 12th Gen',
  'Intel 13th Gen',
  'Intel 14th Gen',
  'AMD Zen',
  'AMD Zen 2',
  'AMD Zen 3',
  'AMD Zen 4',
  'AMD Zen 5',
]
export const RAM_GENERATIONS = ['DDR3', 'DDR3L', 'DDR4', 'DDR5', 'LPDDR4', 'LPDDR5']
export const STORAGE_INTERFACES = ['NVMe', 'SATA', 'SAS', 'eMMC', 'USB']
export const GPU_MANUFACTURERS = ['AMD', 'Nvidia', 'Intel']
export const GPU_FORM_FACTORS = ['Low profile', 'Full height', 'Half height', 'Single slot', 'Dual slot']
export const GPU_SLOT_WIDTHS = ['Single slot', 'Dual slot', 'Triple slot']
export const PCIE_OPTIONS = ['PCIe 2.0 x1', 'PCIe 2.0 x4', 'PCIe 2.0 x8', 'PCIe 3.0 x4', 'PCIe 3.0 x8', 'PCIe 3.0 x16', 'PCIe 4.0 x4', 'PCIe 4.0 x8', 'PCIe 4.0 x16', 'PCIe 5.0 x16']
export const NETWORK_INTERFACES = ['PCIe 2.0 x1', 'PCIe 2.0 x4', 'PCIe 2.0 x8', 'PCIe 3.0 x1', 'PCIe 3.0 x4', 'PCIe 3.0 x8', 'M.2 A+E', 'USB']
export const NETWORK_FORM_FACTORS = ['Low profile', 'Full height', 'M.2 2230 A+E', 'USB dongle', 'Onboard']
export const PCIE_GENERATIONS = ['1', '2', '3', '4', '5', '6']
export const PCIE_LANE_WIDTHS = ['1', '2', '4', '8', '16']
export const EXPANSION_INTERFACE_FAMILIES = ['pcie', 'm2-ae', 'usb', 'onboard']
export const CARD_HEIGHTS = ['full-height', 'low-profile']
export const SLOT_WIDTHS = ['1', '2', '3', '4']
export const SWITCH_MANAGEMENT_OPTIONS = [
  'Unmanaged',
  'Smart / Web-managed',
  'Layer 2 Managed',
  'Layer 2+ Managed',
  'Layer 3 Managed',
  'Controller / Cloud-managed',
]
export const MOTHERBOARD_FORM_FACTORS = ['Mini-ITX', 'Micro-ATX', 'ATX', 'E-ATX', 'SSI CEB', 'SSI EEB']
export const PSU_FORM_FACTORS = ['ATX', 'SFX', 'SFX-L', 'TFX', 'Flex ATX', 'External']
export const COOLER_TYPES = ['air', 'aio', 'custom-loop', 'passive']
export const POWER_EFFICIENCY_RATINGS = ['80 Plus', '80 Plus Bronze', '80 Plus Silver', '80 Plus Gold', '80 Plus Platinum', '80 Plus Titanium']
export const WIFI_GENERATIONS = ['Wi-Fi 4', 'Wi-Fi 5', 'Wi-Fi 6', 'Wi-Fi 6E', 'Wi-Fi 7']
export const SOUND_CARD_INTERFACES = ['PCIe', 'USB', 'Onboard']
export const WIRELESS_INTERFACES = ['M.2 A+E', 'PCIe', 'USB', 'Onboard']
export const DC_CONNECTORS = ['Barrel', 'USB-C', 'Slim tip', 'Proprietary']
export const YES_NO_OPTIONS = ['Yes', 'No']
export const OUTLET_CLASSIFICATIONS = ['Battery backup', 'Surge protection']

export function withLegacyOption(options: string[], currentValue?: string): string[] {
  const value = currentValue?.trim()

  if (!value || options.includes(value)) {
    return options
  }

  return [...options, value]
}

export function formatPortTypeLabel(type: InventoryPortType): string {
  if (type === 'sfp-plus') return 'SFP+'
  if (type === 'displayport') return 'DisplayPort'
  if (type === 'mini-displayport') return 'Mini DisplayPort'
  return type.toUpperCase()
}
