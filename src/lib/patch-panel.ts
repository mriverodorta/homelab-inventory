import type { InventoryItem, InventoryPortSide } from '@/types/inventory'

export const PATCH_PANEL_ROW_ORDER_PROPERTY = 'patchPanelRowOrder'

export type PatchPanelRowOrderValue = 'back-front' | 'front-back'

export function getPatchPanelRowOrderValue(item: InventoryItem): PatchPanelRowOrderValue {
  return item.properties?.[PATCH_PANEL_ROW_ORDER_PROPERTY] === 'front-back'
    ? 'front-back'
    : 'back-front'
}

export function getPatchPanelRowSides(item: InventoryItem): InventoryPortSide[] {
  return getPatchPanelRowOrderValue(item) === 'front-back'
    ? ['front', 'back']
    : ['back', 'front']
}

export function getSwappedPatchPanelRowOrderValue(item: InventoryItem): PatchPanelRowOrderValue {
  return getPatchPanelRowOrderValue(item) === 'back-front'
    ? 'front-back'
    : 'back-front'
}
