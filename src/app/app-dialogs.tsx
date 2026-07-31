import type { ComponentProps } from 'react'
import {
  AssignedComponentRemovalDialog,
  AuditDrawer,
  DemoSessionDialog,
  ExampleCompletionDialog,
  FirstRunOnboardingDialog,
  GlobalItemSearch,
  InventoryLifecycleDialog,
  NasPowerConfigurationDialog,
  ReturnToInventoryDialog,
  SettingsDialog,
  UpdateDialog,
  WhatsNewDialog,
} from '@/components/lazy-app-surfaces'

export interface AppDialogsProps {
  audit: ComponentProps<typeof AuditDrawer>
  search: ComponentProps<typeof GlobalItemSearch>
  inventoryLifecycle: ComponentProps<typeof InventoryLifecycleDialog>
  returnToInventory: ComponentProps<typeof ReturnToInventoryDialog>
  nasPower: ComponentProps<typeof NasPowerConfigurationDialog>
  assignmentRemoval: ComponentProps<typeof AssignedComponentRemovalDialog>
  whatsNew?: ComponentProps<typeof WhatsNewDialog>
  update?: ComponentProps<typeof UpdateDialog>
  settings: ComponentProps<typeof SettingsDialog>
  demoSession: ComponentProps<typeof DemoSessionDialog>
  firstRun: ComponentProps<typeof FirstRunOnboardingDialog>
  exampleCompletion: ComponentProps<typeof ExampleCompletionDialog>
}

export function AppDialogs({
  audit,
  search,
  inventoryLifecycle,
  returnToInventory,
  nasPower,
  assignmentRemoval,
  whatsNew,
  update,
  settings,
  demoSession,
  firstRun,
  exampleCompletion,
}: AppDialogsProps) {
  return (
    <>
      <AuditDrawer {...audit} />
      <GlobalItemSearch {...search} />
      <InventoryLifecycleDialog {...inventoryLifecycle} />
      <ReturnToInventoryDialog {...returnToInventory} />
      <NasPowerConfigurationDialog {...nasPower} />
      <AssignedComponentRemovalDialog {...assignmentRemoval} />
      {whatsNew ? <WhatsNewDialog {...whatsNew} /> : null}
      {update ? <UpdateDialog {...update} /> : null}
      <SettingsDialog {...settings} />
      <DemoSessionDialog {...demoSession} />
      <FirstRunOnboardingDialog {...firstRun} />
      <ExampleCompletionDialog {...exampleCompletion} />
    </>
  )
}
