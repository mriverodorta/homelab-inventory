import type { ComponentProps } from 'react'
import { DesktopInventoryShell } from '@/components/desktop-inventory-shell'
import { InventorySidebar } from '@/components/lazy-inventory-sidebar'
import { MobileInventorySheet } from '@/components/lazy-mobile-inventory-sheet'
import { useInventorySidebarController } from '@/components/inventory/use-inventory-sidebar-controller'

type DesktopShellProps = ComponentProps<typeof DesktopInventoryShell>
type InventorySidebarProps = ComponentProps<typeof InventorySidebar>
type MobileInventorySheetProps = ComponentProps<typeof MobileInventorySheet>

export interface AppInventoryPanelsProps {
  preferenceScope: string
  desktopLayout: boolean
  desktop: Omit<DesktopShellProps, 'children'>
  sidebar: InventorySidebarProps
  mobile: MobileInventorySheetProps
}

export function AppInventoryPanels({
  preferenceScope,
  desktopLayout,
  desktop,
  sidebar,
  mobile,
}: AppInventoryPanelsProps) {
  return (
    <ScopedInventoryPanels
      key={preferenceScope}
      preferenceScope={preferenceScope}
      desktopLayout={desktopLayout}
      desktop={desktop}
      sidebar={sidebar}
      mobile={mobile}
    />
  )
}

function ScopedInventoryPanels({
  preferenceScope,
  desktopLayout,
  desktop,
  sidebar,
  mobile,
}: AppInventoryPanelsProps) {
  const controller = useInventorySidebarController(preferenceScope)
  return desktopLayout ? (
      <DesktopInventoryShell {...desktop}>
        <InventorySidebar {...sidebar} controller={controller} />
      </DesktopInventoryShell>
  ) : (
    <MobileInventorySheet {...mobile} controller={controller} />
  )
}
