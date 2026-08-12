import type { SettingsDialogProps } from '@/components/settings-dialog'
import type { useCanvasMaintenanceController } from '@/app/use-canvas-maintenance-controller'
import type { useOnboardingController } from '@/app/use-onboarding-controller'
import type { useRegistrySettingsActions } from '@/app/use-registry-settings-actions'
import type { useReleaseUpdateController } from '@/app/use-release-update-controller'
import type { useWorkspacePreferences } from '@/app/use-workspace-preferences'
import type { useRegistryMutations, useRegistryQuery } from '@/hooks/use-registry'
import {
  clearIgnoredAuditWarnings,
  enableCompatibilityForAllHosts,
} from '@/lib/compatibility-policy'
import { clampInventoryWidth } from '@/lib/ui-preferences'
import type { ProjectState } from '@/types/inventory'
import type { useWorkbookController } from '@/app/use-workbook-controller'

type SaveStatus = 'saved' | 'saving' | 'error'

interface CreateSettingsDialogPropsOptions {
  open: boolean
  project: ProjectState
  saveStatus: SaveStatus
  preferences: ReturnType<typeof useWorkspacePreferences>
  maintenance: ReturnType<typeof useCanvasMaintenanceController>
  releases: ReturnType<typeof useReleaseUpdateController>
  onboarding: ReturnType<typeof useOnboardingController>
  registryQuery: ReturnType<typeof useRegistryQuery>
  registryMutations: ReturnType<typeof useRegistryMutations>
  registryActions: ReturnType<typeof useRegistrySettingsActions>
  updateProject(nextProject: ProjectState): void
  updateProjectName(name: string): void
  setOpen(open: boolean): void
  workbook?: ReturnType<typeof useWorkbookController>
}

export function createSettingsDialogProps({
  open,
  project,
  saveStatus,
  preferences,
  maintenance,
  releases,
  onboarding,
  registryQuery,
  registryMutations,
  registryActions,
  updateProject,
  updateProjectName,
  setOpen,
  workbook,
}: CreateSettingsDialogPropsOptions): SettingsDialogProps {
  const activeWorkbook = workbook?.activeWorkbook
  return {
    open,
    projectName: activeWorkbook?.project.name ?? project.metadata.name,
    projectWorkspaces: activeWorkbook ? [...activeWorkbook.workspaces] : undefined,
    defaultWorkspaceId: activeWorkbook?.defaultWorkspaceId,
    includesGlobalInventory: activeWorkbook?.project.includesGlobalInventory,
    useLastActiveWorkspace: workbook?.useLastActiveWorkspace,
    saveStatus,
    inventoryVisible: preferences.desktopInventoryVisible,
    inventoryWidth: preferences.inventoryWidth,
    autoCenterOnSelect: preferences.autoCenterOnSelect,
    networkCablesVisible: preferences.networkCablesVisible,
    powerCablesVisible: preferences.powerCablesVisible,
    displayCablesVisible: preferences.displayCablesVisible,
    openCreatedConnectionInspector: preferences.openCreatedConnectionInspector,
    snapCablesToGrid: preferences.snapCablesToGrid,
    avoidCableCollisionsGlobally: preferences.avoidCableCollisionsGlobally,
    snapItemsToGrid: preferences.snapItemsToGrid,
    placementCount: project.placements.length,
    aligningItemsToGrid: maintenance.aligningItemsToGrid,
    manualCableBendCount: maintenance.manualCableBendCount,
    resettingCableBends: maintenance.resettingCableBends,
    manualCableRouteCount: maintenance.manualCableRouteCount,
    restoringAutomaticCableRoutes: maintenance.restoringAutomaticCableRoutes,
    updateStatus: releases.updateStatusQuery.data ?? null,
    updateLoading: releases.updateStatusQuery.isLoading,
    updateChecking: releases.checkForUpdatesMutation.isPending,
    updateClearingSkip: releases.clearSkippedUpdateMutation.isPending,
    onboardingStatus: onboarding.current ?? onboarding.query.data ?? null,
    onboardingBusy: onboarding.busy,
    registry: registryQuery.data,
    registryLoading: registryQuery.isLoading,
    registrySaving: registryMutations.updateSettings.isPending
      || registryMutations.importCatalog.isPending
      || registryMutations.refreshCatalog.isPending
      || registryMutations.deliverContributions.isPending
      || registryMutations.revokeContributions.isPending
      || registryMutations.rotateContributionKey.isPending
      || registryMutations.resumeContributionRecovery.isPending
      || registryMutations.resetContributionRecovery.isPending,
    onOpenChange: setOpen,
    onProjectNameChange: activeWorkbook && workbook
      ? (name) => void workbook.updateProject(activeWorkbook.project.id, {
          name,
          description: activeWorkbook.project.description,
          iconKey: activeWorkbook.project.iconKey,
          includesGlobalInventory: activeWorkbook.project.includesGlobalInventory,
        })
      : updateProjectName,
    onDefaultWorkspaceChange: workbook
      ? (workspaceId) => void workbook.setDefaultWorkspace(workspaceId)
      : undefined,
    onIncludesGlobalInventoryChange: activeWorkbook && workbook
      ? (enabled) => void workbook.updateProject(activeWorkbook.project.id, {
          name: activeWorkbook.project.name,
          description: activeWorkbook.project.description,
          iconKey: activeWorkbook.project.iconKey,
          includesGlobalInventory: enabled,
        })
      : undefined,
    onUseLastActiveWorkspaceChange: workbook?.setUseLastActiveWorkspace,
    onInventoryVisibleChange: preferences.setDesktopInventoryVisible,
    onInventoryWidthChange: (width) => preferences.setInventoryWidth(clampInventoryWidth(width)),
    onAutoCenterOnSelectChange: preferences.setAutoCenterOnSelect,
    onNetworkCablesVisibleChange: preferences.setNetworkCablesVisible,
    onPowerCablesVisibleChange: preferences.setPowerCablesVisible,
    onDisplayCablesVisibleChange: preferences.setDisplayCablesVisible,
    onOpenCreatedConnectionInspectorChange: preferences.setOpenCreatedConnectionInspector,
    onSnapCablesToGridChange: preferences.setSnapCablesToGrid,
    onAvoidCableCollisionsGloballyChange: preferences.setAvoidCableCollisionsGlobally,
    onSnapItemsToGridChange: preferences.setSnapItemsToGrid,
    onAlignAllItemsToGrid: () => void maintenance.alignAllEquipmentToGrid(),
    onResetAllCableBends: () => void maintenance.resetAllConnectionBends(),
    onRestoreAutomaticCableRoutes: () => void maintenance.restoreAutomaticConnectionRoutes(),
    onResetBrowserPreferences: preferences.resetWorkspacePreferences,
    onClearIgnoredWarnings: () => updateProject(clearIgnoredAuditWarnings(project)),
    onEnableCompatibilityForAllHosts: () => updateProject(enableCompatibilityForAllHosts(project)),
    onCheckForUpdates: () => releases.checkForUpdatesMutation.mutate(),
    onClearSkippedUpdate: () => releases.clearSkippedUpdateMutation.mutate(),
    onExploreExample: () => onboarding.loadExample.mutate(),
    onReviewExample: () => {
      setOpen(false)
      onboarding.saveWalkthroughStep.mutate(3)
    },
    onRestartOnboarding: () => onboarding.restart.mutate(),
    onDismissOnboarding: () => onboarding.dismiss.mutate(),
    onRegistrySettingsChange: registryActions.updateSettings,
    onDeletePrivateTemplate: registryActions.deletePrivateTemplate,
    onExportPrivateTemplates: registryActions.exportPrivateTemplates,
    onImportPrivateTemplates: registryActions.importPrivateTemplates,
    onImportOfficialCatalog: registryActions.importOfficialCatalog,
    onRefreshOfficialCatalog: registryActions.refreshOfficialCatalog,
    onApplyCatalogUpdate: registryActions.applyCatalogUpdate,
    onDeliverRegistryContributions: registryActions.deliverContributions,
    onRevokeRegistryContributions: registryActions.revokeContributions,
    onRotateRegistryContributionKey: registryActions.rotateContributionKey,
    onResumeRegistryContributionRecovery: registryActions.resumeContributionRecovery,
    onResetRegistryContributionRecovery: registryActions.resetContributionRecovery,
  }
}
