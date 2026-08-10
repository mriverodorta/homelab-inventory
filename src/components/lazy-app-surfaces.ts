import { createLazySurface } from '@/components/lazy-surface'

const inspectorLoader = () => import('@/components/inspector-panel').then((module) => ({
  default: module.InspectorPanel,
}))
export const InspectorPanel = createLazySurface(inspectorLoader, {
  displayName: 'Inspector',
  loadingLabel: 'Loading inspector',
  loadingClassName: 'fixed inset-y-0 right-0 z-50 w-full max-w-[640px] rounded-none',
  getClose: (props) => props.onClose,
  shouldRender: (props) => props.open,
})

const auditLoader = () => import('@/components/audit-drawer').then((module) => ({
  default: module.AuditDrawer,
}))
export const AuditDrawer = createLazySurface(auditLoader, {
  displayName: 'Audit',
  loadingLabel: 'Loading audit',
  loadingClassName: 'fixed inset-y-0 right-0 z-50 w-full max-w-[560px] rounded-none',
  getClose: (props) => props.onClose,
  shouldRender: (props) => props.open,
})

const searchLoader = () => import('@/components/global-item-search').then((module) => ({
  default: module.GlobalItemSearch,
}))
export const GlobalItemSearch = createLazySurface(searchLoader, {
  displayName: 'Global search',
  loadingLabel: 'Loading search',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const lifecycleLoader = () => import('@/components/inventory-lifecycle-dialog').then((module) => ({
  default: module.InventoryLifecycleDialog,
}))
export const InventoryLifecycleDialog = createLazySurface(lifecycleLoader, {
  displayName: 'Inventory action',
  loadingLabel: 'Loading inventory action',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const returnLoader = () => import('@/components/return-to-inventory-dialog').then((module) => ({
  default: module.ReturnToInventoryDialog,
}))
export const ReturnToInventoryDialog = createLazySurface(returnLoader, {
  displayName: 'Return to inventory',
  loadingLabel: 'Loading return summary',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const nasPowerLoader = () => import('@/components/nas-power-configuration-dialog').then((module) => ({
  default: module.NasPowerConfigurationDialog,
}))
export const NasPowerConfigurationDialog = createLazySurface(nasPowerLoader, {
  displayName: 'NAS power configuration',
  loadingLabel: 'Loading power configuration',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const assignmentRemovalLoader = () => import('@/components/assigned-component-removal-dialog').then((module) => ({
  default: module.AssignedComponentRemovalDialog,
}))
export const AssignedComponentRemovalDialog = createLazySurface(assignmentRemovalLoader, {
  displayName: 'Component removal',
  loadingLabel: 'Loading component removal',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const whatsNewLoader = () => import('@/components/whats-new-dialog').then((module) => ({
  default: module.WhatsNewDialog,
}))
export const WhatsNewDialog = createLazySurface(whatsNewLoader, {
  displayName: "What's new",
  loadingLabel: "Loading what's new",
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const updateLoader = () => import('@/components/update-dialog').then((module) => ({
  default: module.UpdateDialog,
}))
export const UpdateDialog = createLazySurface(updateLoader, {
  displayName: 'Application update',
  loadingLabel: 'Loading update information',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const settingsLoader = () => import('@/components/settings-dialog').then((module) => ({
  default: module.SettingsDialog,
}))
export const SettingsDialog = createLazySurface(settingsLoader, {
  displayName: 'Settings',
  loadingLabel: 'Loading settings',
  loadingClassName: 'fixed inset-4 z-50 rounded-lg sm:inset-8',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const notificationCenterLoader = () => import('@/components/notifications/notification-center').then((module) => ({
  default: module.NotificationCenter,
}))
export const NotificationCenter = createLazySurface(notificationCenterLoader, {
  displayName: 'Notification Center',
  loadingLabel: 'Loading notifications',
  loadingClassName: 'fixed inset-y-0 right-0 z-50 w-full max-w-[480px] rounded-none',
  getClose: (props) => () => props.onOpenChange(false),
  shouldRender: (props) => props.open,
})

const demoSessionLoader = () => import('@/components/demo-session-dialog').then((module) => ({
  default: module.DemoSessionDialog,
}))
export const DemoSessionDialog = createLazySurface(demoSessionLoader, {
  displayName: 'Demo session',
  loadingLabel: 'Loading demo session',
  shouldRender: (props) => props.state !== 'closed',
})

const firstRunLoader = () => import('@/components/onboarding/first-run-dialog').then((module) => ({
  default: module.FirstRunOnboardingDialog,
}))
export const FirstRunOnboardingDialog = createLazySurface(firstRunLoader, {
  displayName: 'Getting started',
  loadingLabel: 'Loading getting started',
  getClose: (props) => () => props.onStartEmpty(),
  shouldRender: (props) => props.open,
})

const exampleGuideLoader = () => import('@/components/onboarding/example-workspace-guide').then((module) => ({
  default: module.ExampleWorkspaceGuide,
}))
export const ExampleWorkspaceGuide = createLazySurface(exampleGuideLoader, {
  displayName: 'Example workspace guide',
  loadingLabel: 'Loading workspace guide',
  loadingClassName: 'fixed left-4 top-4 z-40 min-h-32 w-80',
  getClose: (props) => props.onSkip,
})

const exampleCompletionLoader = () => import('@/components/onboarding/example-completion-dialog').then((module) => ({
  default: module.ExampleCompletionDialog,
}))
export const ExampleCompletionDialog = createLazySurface(exampleCompletionLoader, {
  displayName: 'Example completion',
  loadingLabel: 'Loading completion summary',
  getClose: (props) => props.onKeep,
  shouldRender: (props) => props.open,
})

const checklistLoader = () => import('@/components/onboarding/getting-started-checklist').then((module) => ({
  default: module.GettingStartedChecklist,
}))
export const GettingStartedChecklist = createLazySurface(checklistLoader, {
  displayName: 'Getting started checklist',
  loadingLabel: 'Loading checklist',
  loadingClassName: 'fixed left-4 top-4 z-40 min-h-32 w-80',
  getClose: (props) => props.onDismiss,
})

export const prefetchAppSurface = {
  audit: AuditDrawer.prefetch,
  inspector: InspectorPanel.prefetch,
  onboarding: FirstRunOnboardingDialog.prefetch,
  search: GlobalItemSearch.prefetch,
  settings: SettingsDialog.prefetch,
  notifications: NotificationCenter.prefetch,
  update: UpdateDialog.prefetch,
} as const
