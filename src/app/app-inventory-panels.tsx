import type { ComponentProps } from 'react'
import { DesktopInventoryShell } from '@/components/desktop-inventory-shell'
import { InventorySidebar } from '@/components/lazy-inventory-sidebar'
import { MobileInventorySheet } from '@/components/lazy-mobile-inventory-sheet'

type DesktopShellProps = ComponentProps<typeof DesktopInventoryShell>
type InventorySidebarProps = ComponentProps<typeof InventorySidebar>
type MobileInventorySheetProps = ComponentProps<typeof MobileInventorySheet>

export interface AppInventoryPanelsProps {
  desktop: Omit<DesktopShellProps, 'children'>
  sidebar: InventorySidebarProps
  mobile: MobileInventorySheetProps
}

export function AppInventoryPanels({
  desktop,
  sidebar,
  mobile,
}: AppInventoryPanelsProps) {
  return (
    <>
      <DesktopInventoryShell {...desktop}>
        <InventorySidebar {...sidebar} />
      </DesktopInventoryShell>
      <MobileInventorySheet {...mobile} />
    </>
  )
}
