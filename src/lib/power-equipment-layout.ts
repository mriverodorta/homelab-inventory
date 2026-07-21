import type { InventoryItem } from '@/types/inventory'

export type PowerEquipmentOrientation = 'horizontal' | 'vertical'
export type UpsOutletGroupOrder = 'battery-surge' | 'surge-battery'

export const POWER_EQUIPMENT_ORIENTATION_PROPERTY = 'canvasOrientation'
export const UPS_OUTLET_GROUP_ORDER_PROPERTY = 'upsOutletGroupOrder'

type ItemWithProperties = Pick<InventoryItem, 'properties'>
type UpsGroup = { id: string }

export function getPowerEquipmentOrientation(
  item: ItemWithProperties,
): PowerEquipmentOrientation {
  return item.properties?.[POWER_EQUIPMENT_ORIENTATION_PROPERTY] === 'vertical'
    ? 'vertical'
    : 'horizontal'
}

export function getUpsOutletGroupOrder(item: ItemWithProperties): UpsOutletGroupOrder {
  return item.properties?.[UPS_OUTLET_GROUP_ORDER_PROPERTY] === 'surge-battery'
    ? 'surge-battery'
    : 'battery-surge'
}

export function getSwappedUpsOutletGroupOrder(item: ItemWithProperties): UpsOutletGroupOrder {
  return getUpsOutletGroupOrder(item) === 'battery-surge'
    ? 'surge-battery'
    : 'battery-surge'
}

export function orderUpsOutletGroups<T extends UpsGroup>(
  item: ItemWithProperties,
  groups: readonly T[],
): T[] {
  const battery = groups.find((group) => group.id === 'battery')
  const surge = groups.find((group) => group.id === 'surge')
  const remaining = groups.filter((group) => group.id !== 'battery' && group.id !== 'surge')
  const ordered = getUpsOutletGroupOrder(item) === 'battery-surge'
    ? [battery, surge]
    : [surge, battery]

  return [...ordered.filter((group): group is T => Boolean(group)), ...remaining]
}
