import { createLazySurface } from '@/components/lazy-surface'
import type { InventorySidebarProps } from '@/components/inventory-sidebar'

type LazyInventorySidebarProps = InventorySidebarProps & {
  active?: boolean
}

const inventorySidebarLoader = () => import('@/components/inventory-sidebar').then((module) => ({
  default: module.InventorySidebar,
}))

const InventorySidebarSurface = createLazySurface(inventorySidebarLoader, {
  displayName: 'Inventory',
  loadingLabel: 'Loading inventory',
  loadingClassName: 'h-full min-h-0 w-full rounded-none border-0 bg-[#20242c] text-[#f7f1e8]',
})

export function InventorySidebar({ active = true, ...props }: LazyInventorySidebarProps) {
  if (!active) return null
  return <InventorySidebarSurface {...props} />
}
