import type { InventoryType } from '@/types/inventory'

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
