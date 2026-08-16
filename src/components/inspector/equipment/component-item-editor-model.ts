import type { ComponentType, InventoryItem } from '@/types/inventory'

const EDITABLE_COMPONENT_TYPES: ReadonlySet<ComponentType> = new Set([
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
  'powerAdapter',
])

export function isEditableComponent(item: InventoryItem): item is InventoryItem & { type: ComponentType } {
  return EDITABLE_COMPONENT_TYPES.has(item.type as ComponentType)
}
