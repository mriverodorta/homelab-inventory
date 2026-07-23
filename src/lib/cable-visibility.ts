import type { InventoryConnectionType } from '@/types/inventory'

export type CableVisibility = {
  network: boolean
  power: boolean
  display: boolean
}

export function isCableTypeVisible(
  type: InventoryConnectionType,
  visibility: CableVisibility,
): boolean {
  if (type === 'network' || type === 'power' || type === 'display') {
    return visibility[type]
  }

  return true
}
