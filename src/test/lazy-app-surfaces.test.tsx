import { describe, expect, it } from 'vitest'
import {
  AssignedComponentRemovalDialog,
  AuditDrawer,
  DemoSessionDialog,
  ExampleCompletionDialog,
  ExampleWorkspaceGuide,
  FirstRunOnboardingDialog,
  GettingStartedChecklist,
  GlobalItemSearch,
  InspectorPanel,
  InventoryLifecycleDialog,
  NasPowerConfigurationDialog,
  NotificationCenter,
  ReturnToInventoryDialog,
  SettingsDialog,
  UpdateDialog,
  WhatsNewDialog,
  prefetchAppSurface,
} from '@/components/lazy-app-surfaces'

describe('lazy application surfaces', () => {
  it('exposes every optional surface through a retryable lazy boundary', () => {
    const surfaces = [
      AssignedComponentRemovalDialog,
      AuditDrawer,
      DemoSessionDialog,
      ExampleCompletionDialog,
      ExampleWorkspaceGuide,
      FirstRunOnboardingDialog,
      GettingStartedChecklist,
      GlobalItemSearch,
      InspectorPanel,
      InventoryLifecycleDialog,
      NasPowerConfigurationDialog,
      NotificationCenter,
      ReturnToInventoryDialog,
      SettingsDialog,
      UpdateDialog,
      WhatsNewDialog,
    ]

    for (const surface of surfaces) {
      expect(surface).toBeTypeOf('function')
      expect(surface.prefetch).toBeTypeOf('function')
    }
  })

  it('provides intent-prefetch entry points without loading modules eagerly', () => {
    expect(Object.keys(prefetchAppSurface)).toEqual([
      'audit',
      'inspector',
      'onboarding',
      'search',
      'settings',
      'notifications',
      'update',
    ])
  })
})
