import type { AppInventoryPanelsProps } from '@/app/app-inventory-panels'

type SidebarProps = AppInventoryPanelsProps['sidebar']

interface CreateInventoryPanelPropsOptions {
  preferenceScope: string
  desktopLayout: boolean
  desktop: AppInventoryPanelsProps['desktop']
  mobile: Pick<AppInventoryPanelsProps['mobile'], 'open' | 'onOpenChange'>
  shared: Pick<
    SidebarProps,
    | 'project'
    | 'onSelect'
    | 'onCreateItem'
    | 'onCreateCatalogItem'
    | 'onDuplicateItem'
    | 'onDuplicateItemToProject'
    | 'onChangeItemScope'
    | 'onRemoveGlobalItemFromProject'
    | 'onAddGlobalInventory'
    | 'globalInventoryEnabled'
    | 'onArchiveItems'
    | 'onRestoreItems'
    | 'onDeleteItems'
    | 'lifecycleRevision'
    | 'lifecycleBusy'
    | 'registry'
    | 'onSaveAsTemplate'
    | 'onDuplicatePrivateTemplate'
  >
  width: number
  openSettings(): void
  openMobileSettings(): void
}

export function createInventoryPanelProps({
  preferenceScope,
  desktopLayout,
  desktop,
  mobile,
  shared,
  width,
  openSettings,
  openMobileSettings,
}: CreateInventoryPanelPropsOptions): AppInventoryPanelsProps {
  return {
    preferenceScope,
    desktopLayout,
    desktop,
    sidebar: {
      ...shared,
      active: desktop.expanded,
      width,
      onOpenRegistrySettings: openSettings,
    },
    mobile: {
      ...shared,
      ...mobile,
      onOpenRegistrySettings: openMobileSettings,
    },
  }
}
