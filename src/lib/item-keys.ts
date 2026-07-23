import type { InventoryType } from '@/types/inventory'
import type { InventoryItem } from '@/types/inventory'

export type InventoryTableKey =
  | 'servers'
  | 'pcBuilds'
  | 'cpus'
  | 'ram'
  | 'storage'
  | 'networkCards'
  | 'gpus'
  | 'motherboards'
  | 'cpuCoolers'
  | 'cases'
  | 'powerSupplies'
  | 'soundCards'
  | 'wirelessCards'
  | 'powerAdapters'
  | 'nas'
  | 'switches'
  | 'patchPanels'
  | 'monitors'
  | 'upsSystems'
  | 'powerStrips'

export const INVENTORY_TABLE_BY_TYPE: Partial<Record<InventoryType, InventoryTableKey>> = {
  server: 'servers',
  pcBuild: 'pcBuilds',
  cpu: 'cpus',
  ram: 'ram',
  storage: 'storage',
  network: 'networkCards',
  gpu: 'gpus',
  motherboard: 'motherboards',
  cpuCooler: 'cpuCoolers',
  case: 'cases',
  powerSupply: 'powerSupplies',
  soundCard: 'soundCards',
  wireless: 'wirelessCards',
  powerAdapter: 'powerAdapters',
  nas: 'nas',
  switch: 'switches',
  patchPanel: 'patchPanels',
  monitor: 'monitors',
  ups: 'upsSystems',
  powerStrip: 'powerStrips',
}

export const INVENTORY_TYPE_BY_TABLE: Record<InventoryTableKey, InventoryType> = {
  servers: 'server',
  pcBuilds: 'pcBuild',
  cpus: 'cpu',
  ram: 'ram',
  storage: 'storage',
  networkCards: 'network',
  gpus: 'gpu',
  motherboards: 'motherboard',
  cpuCoolers: 'cpuCooler',
  cases: 'case',
  powerSupplies: 'powerSupply',
  soundCards: 'soundCard',
  wirelessCards: 'wireless',
  powerAdapters: 'powerAdapter',
  nas: 'nas',
  switches: 'switch',
  patchPanels: 'patchPanel',
  monitors: 'monitor',
  upsSystems: 'ups',
  powerStrips: 'powerStrip',
}

export const INVENTORY_TABLE_KEYS: InventoryTableKey[] = [
  'servers',
  'pcBuilds',
  'cpus',
  'ram',
  'storage',
  'networkCards',
  'gpus',
  'motherboards',
  'cpuCoolers',
  'cases',
  'powerSupplies',
  'soundCards',
  'wirelessCards',
  'powerAdapters',
  'nas',
  'switches',
  'patchPanels',
  'monitors',
  'upsSystems',
  'powerStrips',
]

export function itemKey(type: InventoryType, id: string | number): string {
  return `${type}:${id}`
}

export function runtimeItemKey(item: InventoryItem): string {
  if (item.key) {
    return item.key
  }

  if (typeof item.id === 'string') {
    if (parseItemKey(item.id)) {
      return item.id
    }

    if (!Number.isInteger(Number(item.id))) {
      return item.id
    }
  }

  return itemKey(item.type, item.id)
}

export function parseItemKey(key: string): { type: InventoryType; id: number } | null {
  const [type, rawId] = key.split(':')
  const id = Number(rawId)

  if (!type || !Number.isInteger(id)) {
    return null
  }

  if (!Object.values(INVENTORY_TYPE_BY_TABLE).includes(type as InventoryType)) {
    return null
  }

  return { type: type as InventoryType, id }
}
