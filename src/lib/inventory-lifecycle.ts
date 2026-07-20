import type { InventoryType } from '@/types/inventory'

const INVENTORY_TYPE_LABELS: Record<InventoryType, string> = {
  server: 'server',
  nas: 'NAS',
  pcBuild: 'PC build',
  switch: 'switch',
  patchPanel: 'patch panel',
  monitor: 'monitor',
  ups: 'UPS',
  powerStrip: 'power strip',
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'storage device',
  gpu: 'GPU',
  network: 'network card',
  motherboard: 'motherboard',
  cpuCooler: 'CPU cooler',
  case: 'case',
  powerSupply: 'power supply',
  soundCard: 'sound card',
  wireless: 'wireless card',
  powerAdapter: 'power adapter',
}

export function inventoryTypeLabel(type: InventoryType): string {
  return INVENTORY_TYPE_LABELS[type]
}

export type InventoryRef = {
  type: InventoryType
  id: string | number
}

export type InventoryDependencyKind = string

export type InventoryDependencyReason = {
  kind: InventoryDependencyKind
  count: number
  message: string
}

export type InventoryDependencyReport = {
  item?: InventoryRef & { name?: string }
  blocked: boolean
  reasons: InventoryDependencyReason[]
}
