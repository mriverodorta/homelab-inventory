import { createLazySurface } from '@/components/lazy-surface'

const inventoryItemDialogLoader = () => import('@/components/inventory-item-dialog').then((module) => ({
  default: module.InventoryItemDialog,
}))

export const InventoryItemDialog = createLazySurface(inventoryItemDialogLoader, {
  displayName: 'Add inventory item',
  loadingLabel: 'Loading hardware form',
  loadingClassName: 'fixed inset-4 z-50 rounded-lg sm:inset-x-[10vw] sm:inset-y-8',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})
