import type { ComponentProps } from 'react'
import {
  AssignedComponentRemovalDialog,
  AuditDrawer,
  DemoSessionDialog,
  ExampleCompletionDialog,
  FirstRunOnboardingDialog,
  GlobalItemSearch,
  InventoryLifecycleDialog,
  InventoryScopeDialog,
  NasPowerConfigurationDialog,
  ReturnToInventoryDialog,
  SettingsDialog,
  NotificationCenter,
  UpdateDialog,
  WhatsNewDialog,
} from '@/components/lazy-app-surfaces'

export interface AppDialogsProps {
  audit: ComponentProps<typeof AuditDrawer>
  search: ComponentProps<typeof GlobalItemSearch>
  inventoryLifecycle: ComponentProps<typeof InventoryLifecycleDialog>
  inventoryScope: ComponentProps<typeof InventoryScopeDialog>
  returnToInventory: ComponentProps<typeof ReturnToInventoryDialog>
  nasPower: ComponentProps<typeof NasPowerConfigurationDialog>
  assignmentRemoval: ComponentProps<typeof AssignedComponentRemovalDialog>
  whatsNew?: ComponentProps<typeof WhatsNewDialog>
  update?: ComponentProps<typeof UpdateDialog>
  settings: ComponentProps<typeof SettingsDialog>
  notifications?: ComponentProps<typeof NotificationCenter>
  demoSession: ComponentProps<typeof DemoSessionDialog>
  firstRun: ComponentProps<typeof FirstRunOnboardingDialog>
  exampleCompletion: ComponentProps<typeof ExampleCompletionDialog>
}

export function AppDialogs({
  audit,
  search,
  inventoryLifecycle,
  inventoryScope,
  returnToInventory,
  nasPower,
  assignmentRemoval,
  whatsNew,
  update,
  settings,
  notifications,
  demoSession,
  firstRun,
  exampleCompletion,
}: AppDialogsProps) {
  return (
    <>
      <AuditDrawer {...audit} />
      <GlobalItemSearch {...search} />
      <InventoryLifecycleDialog {...inventoryLifecycle} />
      <InventoryScopeDialog {...inventoryScope} />
      <ReturnToInventoryDialog {...returnToInventory} />
      <NasPowerConfigurationDialog {...nasPower} />
      <AssignedComponentRemovalDialog {...assignmentRemoval} />
      {whatsNew ? <WhatsNewDialog {...whatsNew} /> : null}
      {update ? <UpdateDialog {...update} /> : null}
      <SettingsDialog {...settings} />
      {notifications ? <NotificationCenter {...notifications} /> : null}
      <DemoSessionDialog {...demoSession} />
      <FirstRunOnboardingDialog {...firstRun} />
      <ExampleCompletionDialog {...exampleCompletion} />
    </>
  )
}
