import type { InventoryType } from '@/types/inventory'
import type { InventoryItem } from '@/types/inventory'

export type InventoryTableKey =
  | 'servers'
  | 'cpus'
  | 'ram'
  | 'storage'
  | 'networkCards'
  | 'gpus'
  | 'nas'
  | 'switches'
  | 'patchPanels'

export const INVENTORY_TABLE_BY_TYPE: Record<InventoryType, InventoryTableKey> = {
  server: 'servers',
  cpu: 'cpus',
  ram: 'ram',
  storage: 'storage',
  network: 'networkCards',
  gpu: 'gpus',
  nas: 'nas',
  switch: 'switches',
  patchPanel: 'patchPanels',
}

export const INVENTORY_TYPE_BY_TABLE: Record<InventoryTableKey, InventoryType> = {
  servers: 'server',
  cpus: 'cpu',
  ram: 'ram',
  storage: 'storage',
  networkCards: 'network',
  gpus: 'gpu',
  nas: 'nas',
  switches: 'switch',
  patchPanels: 'patchPanel',
}

export const INVENTORY_TABLE_KEYS: InventoryTableKey[] = [
  'servers',
  'cpus',
  'ram',
  'storage',
  'networkCards',
  'gpus',
  'nas',
  'switches',
  'patchPanels',
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
