import type { RefObject } from 'react'
import type { AppWorkspaceSurfaceProps } from '@/app/app-workspace-surface'
import type { useAppNavigationActions } from '@/app/use-app-navigation-actions'
import type { useCanvasEquipmentLifecycle } from '@/app/use-canvas-equipment-lifecycle'
import type { useCanvasSelectionController } from '@/app/use-canvas-selection-controller'
import type { useCanvasWorkspaceActions } from '@/app/use-canvas-workspace-actions'
import type { useConnectionController } from '@/app/use-connection-controller'
import type { useInventoryLifecycle } from '@/app/use-inventory-lifecycle'
import type { useOnboardingController } from '@/app/use-onboarding-controller'
import type { useWorkspacePreferences } from '@/app/use-workspace-preferences'
import type { CanvasController } from '@/components/workbench-canvas-contract'
import { setAuditWarningIgnored } from '@/lib/compatibility-policy'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import type { ProjectState } from '@/types/inventory'

type CanvasProps = AppWorkspaceSurfaceProps['canvas']
type InspectorProps = AppWorkspaceSurfaceProps['inspector']
type ValidationSeverity = 'error' | 'unknown'

interface CreateWorkspaceSurfacePropsOptions {
  project: ProjectState
  topologyData: CanvasProps['topologyData']
  topologyStatus: { message: string; severity: ValidationSeverity } | null
  compatibleEndpointKeys: CanvasProps['compatibleEndpointKeys']
  agentStatus: CanvasProps['agentStatus']
  demoMode: boolean
  demoRemainingSeconds: number | null
  registryLinkedItemKeys: CanvasProps['registryLinkedItemKeys']
  dropCompatibilityByHostId: CanvasProps['dropCompatibilityByHostId']
  selection: ReturnType<typeof useCanvasSelectionController>
  connection: ReturnType<typeof useConnectionController>
  equipment: ReturnType<typeof useCanvasEquipmentLifecycle>
  inventory: ReturnType<typeof useInventoryLifecycle>
  onboarding: ReturnType<typeof useOnboardingController>
  preferences: ReturnType<typeof useWorkspacePreferences>
  canvasActions: ReturnType<typeof useCanvasWorkspaceActions>
  navigation: ReturnType<typeof useAppNavigationActions>
  canvasControllerRef: RefObject<CanvasController | null>
  validationMessage: string | null
  validationSeverity: ValidationSeverity
  persistenceWarning: string | null
  canUndo: boolean
  canRedo: boolean
  saveStatus: CanvasProps['saveStatus']
  canonicalMutationBusy: boolean
  canvasOperationLabel: string | null
  updateAvailable: boolean
  updateStatusLoading: boolean
  canViewNotifications: boolean
  notificationCount: number
  settingsOpen: boolean
  openNotifications(): void
  undo(): void
  redo(): void
  updateProject(nextProject: ProjectState): void
  setValidationMessage(message: string | null): void
  showCurrentExampleStep(): void
}

export function createWorkspaceSurfaceProps({
  project,
  topologyData,
  topologyStatus,
  compatibleEndpointKeys,
  agentStatus,
  demoMode,
  demoRemainingSeconds,
  registryLinkedItemKeys,
  dropCompatibilityByHostId,
  selection,
  connection,
  equipment,
  inventory,
  onboarding,
  preferences,
  canvasActions,
  navigation,
  canvasControllerRef,
  validationMessage,
  validationSeverity,
  persistenceWarning,
  canUndo,
  canRedo,
  saveStatus,
  canonicalMutationBusy,
  canvasOperationLabel,
  updateAvailable,
  updateStatusLoading,
  canViewNotifications,
  notificationCount,
  settingsOpen,
  openNotifications,
  undo,
  redo,
  updateProject,
  setValidationMessage,
  showCurrentExampleStep,
}: CreateWorkspaceSurfacePropsOptions): AppWorkspaceSurfaceProps {
  const selectedItemId = selection.selectedItem ? runtimeItemKey(selection.selectedItem) : null
  const selectedConnectionId = selection.selectedConnection?.id ?? null
  const inspectorOpen = selection.selectedItem !== null || selection.selectedConnection !== null
  const desktopOffset = preferences.desktopInventoryVisible
    ? preferences.inventoryWidth + 16
    : 16

  const inspector: InspectorProps = {
    project,
    topologyData,
    topologyStatusMessage: topologyStatus?.message ?? null,
    topologyStatusIsError: topologyStatus?.severity === 'error',
    compatibleEndpointKeys,
    agentStatus,
    demoMode,
    selectedItemId,
    selectedConnectionId,
    activeNetworkTraceKey: selection.activeNetworkTraceEndpoint
      ? endpointKey(selection.activeNetworkTraceEndpoint)
      : null,
    pendingConnectionEndpoint: connection.pendingConnectionEndpoint,
    validationMessage,
    validationSeverity,
    persistenceWarning,
    open: inspectorOpen,
    onClose: navigation.clearCanvasSelection,
    onUpdateProject: updateProject,
    onUpdateItem: inventory.updateItem,
    onRequestNasPowerConfigurationChange: (item, powerConfiguration) => {
      void inventory.requestNasPowerConfigurationChange(item, powerConfiguration)
    },
    onSetWarningIgnored: (warningId, ignored) => {
      updateProject(setAuditWarningIgnored(project, warningId, ignored))
    },
    onUpdateItemProperties: inventory.updateItemProperties,
    onDuplicateItem: inventory.duplicateItem,
    onArchiveItem: (item) => void inventory.requestAction('archive', [item]),
    onReturnItemToInventory: equipment.requestReturnToInventory,
    lifecycleBusy: inventory.busy,
    onCreateConnection: connection.createConnectionBetween,
    onSelectConnection: selection.selectConnection,
    onSelectNetworkTrace: (endpoint) => {
      selection.selectNetworkTrace(endpoint)
      connection.clearPendingConnection()
    },
    onEndpointConnectionClick: connection.handleEndpointConnectionClick,
    onCancelPendingConnection: () => {
      connection.clearPendingConnection()
      setValidationMessage(null)
    },
    onUpdateConnectionLabel: connection.updateConnectionLabel,
    onUpdateConnectionRoute: connection.updateConnectionRoute,
    onRemoveConnection: connection.removeConnection,
  }

  return {
    canvas: {
      project,
      registryLinkedItemKeys,
      topologyData,
      compatibleEndpointKeys,
      agentStatus,
      demoRemainingSeconds,
      selectedItemId,
      selectedConnectionId,
      spotlightItemId: selection.spotlightItemId,
      activeNetworkTraceConnectionIds: selection.activeNetworkTraceConnectionIds,
      activeNetworkTraceItemIds: selection.activeNetworkTraceItemIds,
      pendingEndpoint: connection.pendingConnectionEndpoint,
      draggingEndpoint: connection.portConnectionPreview?.mode === 'drag'
        ? connection.portConnectionPreview.from
        : null,
      dropCompatibilityByHostId,
      validationMessage: validationMessage ?? topologyStatus?.message ?? null,
      validationSeverity: validationMessage
        ? validationSeverity
        : topologyStatus?.severity ?? validationSeverity,
      canUndo,
      canRedo,
      saveStatus,
      canonicalMutationBusy,
      canvasOperationLabel,
      desktopInventoryVisible: preferences.desktopInventoryVisible,
      inspectorOpen,
      autoCenterOnSelect: preferences.autoCenterOnSelect,
      networkCablesVisible: preferences.networkCablesVisible,
      powerCablesVisible: preferences.powerCablesVisible,
      displayCablesVisible: preferences.displayCablesVisible,
      snapCablesToGrid: preferences.snapCablesToGrid,
      avoidCableCollisionsGlobally: preferences.avoidCableCollisionsGlobally,
      snapItemsToGrid: preferences.snapItemsToGrid,
      initialViewport: preferences.initialViewport,
      updateAvailable,
      updateStatusLoading,
      canViewNotifications,
      notificationCount,
      onSelect: selection.selectCanvasItem,
      onSelectConnection: selection.selectConnection,
      onRemoveAssignment: equipment.requestAssignedComponentRemoval,
      onMoveItem: canvasActions.moveItem,
      onMoveItems: canvasActions.moveItems,
      onEndpointClick: connection.handleCanvasEndpointClick,
      onEndpointDragStart: connection.handleCanvasEndpointDragStart,
      onEndpointDrop: connection.handleCanvasEndpointDrop,
      onUpdateConnectionRoute: connection.updateConnectionRoute,
      onResolveConnectionRouteSides: connection.resolveConnectionRouteSides,
      onCanonicalizeConnectionRoutes: connection.canonicalizeConnectionRoutes,
      onViewportReady: (controller) => {
        canvasControllerRef.current = controller
      },
      onViewportChange: preferences.persistViewport,
      onCanvasClick: navigation.clearCanvasSelection,
      onUndo: undo,
      onRedo: redo,
      onOpenInventory: navigation.openInventory,
      onToggleAutoCenterOnSelect: () => preferences.setAutoCenterOnSelect((current) => !current),
      onToggleNetworkCablesVisible: () => preferences.setNetworkCablesVisible((current) => !current),
      onTogglePowerCablesVisible: () => preferences.setPowerCablesVisible((current) => !current),
      onToggleDisplayCablesVisible: () => preferences.setDisplayCablesVisible((current) => !current),
      onAutoArrange: canvasActions.autoArrange,
      onOpenAudit: navigation.openAudit,
      onOpenSettings: navigation.openSettings,
      onOpenNotifications: openNotifications,
      onOpenUpdate: navigation.openUpdate,
    },
    exampleGuide: onboarding.showExampleGuide && !settingsOpen ? {
      step: onboarding.current?.walkthroughStep ?? 0,
      desktopOffset,
      busy: onboarding.busy,
      onShowMe: showCurrentExampleStep,
      onSkip: () => onboarding.saveWalkthroughStep.mutate(3),
    } : undefined,
    gettingStarted: onboarding.showGettingStarted ? {
      milestones: onboarding.current?.milestones ?? {
        created: false,
        placed: false,
        related: false,
        completed: false,
      },
      desktopOffset,
      onDismiss: () => onboarding.dismiss.mutate(),
    } : undefined,
    portPreview: connection.portConnectionPreview
      ? { preview: connection.portConnectionPreview }
      : undefined,
    inspector,
  }
}
