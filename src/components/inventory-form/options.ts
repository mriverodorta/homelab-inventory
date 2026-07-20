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
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
  'switch',
  'patchPanel',
]

export const TYPE_LABELS: Partial<Record<InventoryType, string>> = {
  server: 'Server',
  nas: 'NAS',
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'Storage',
  gpu: 'GPU',
  network: 'Network Card',
  switch: 'Switch',
  patchPanel: 'Patch Panel',
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
