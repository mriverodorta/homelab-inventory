import { INVENTORY_CATEGORY_ORDER } from '@/lib/inventory'
import { runtimeItemKey } from '@/lib/item-keys'
import type { InventoryItem, InventoryType } from '@/types/inventory'

export type InventoryVirtualRow =
  | {
      kind: 'category'
      key: string
      type: InventoryType
      count: number
    }
  | {
      kind: 'item'
      key: string
      type: InventoryType
      item: InventoryItem
    }

export function createInventoryVirtualRows(
  items: readonly InventoryItem[],
  collapsedTypes: ReadonlySet<InventoryType>,
): InventoryVirtualRow[] {
  const itemsByType = new Map<InventoryType, InventoryItem[]>()

  for (const item of items) {
    const group = itemsByType.get(item.type)
    if (group) group.push(item)
    else itemsByType.set(item.type, [item])
  }

  return INVENTORY_CATEGORY_ORDER.flatMap((type) => {
    const groupItems = itemsByType.get(type) ?? []
    if (groupItems.length === 0) return []

    const category: InventoryVirtualRow = {
      kind: 'category',
      key: `category:${type}`,
      type,
      count: groupItems.length,
    }

    return collapsedTypes.has(type)
      ? [category]
      : [
          category,
          ...groupItems.map((item): InventoryVirtualRow => ({
            kind: 'item',
            key: `item:${runtimeItemKey(item)}`,
            type,
            item,
          })),
        ]
  })
}
