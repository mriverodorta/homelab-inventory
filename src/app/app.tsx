import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import {
  type CanvasController,
} from '@/components/workbench-canvas-contract'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import { useRegistryMutations, useRegistryQuery } from '@/hooks/use-registry'
import {
  useCompatibleTopologyDestinations,
  useTopologyQuery,
} from '@/hooks/use-topology-query'
import { setAuditWarningIgnored } from '@/lib/compatibility-policy'
import { loadAgentStatus } from '@/lib/agent-api'
import {
  loadProject,
} from '@/lib/db'
import { buildVisibleRegistryLinkKeys } from '@/lib/registry-links'
import { ErrorScreen, LoadingScreen } from '@/app/app-status-screens'
import { AppDialogs } from '@/app/app-dialogs'
import { AppInventoryPanels } from '@/app/app-inventory-panels'
import { AppShell } from '@/app/app-shell'
import { AppWorkspaceSurface } from '@/app/app-workspace-surface'
import { InventoryDragPreview } from '@/app/inventory-drag-preview'
import { useWorkspacePreferences } from '@/app/use-workspace-preferences'
import { useInventoryPanelResize } from '@/app/use-inventory-panel-resize'
import { useDemoSessionLifecycle } from '@/app/use-demo-session-lifecycle'
import { useWorkspaceDrag } from '@/app/use-workspace-drag'
import { useProjectHistory } from '@/app/use-project-history'
import { useInventoryLifecycle } from '@/app/use-inventory-lifecycle'
import { useOnboardingController } from '@/app/use-onboarding-controller'
import { useReleaseUpdateController } from '@/app/use-release-update-controller'
import { useCanvasMaintenanceController } from '@/app/use-canvas-maintenance-controller'
import { useCanvasEquipmentLifecycle } from '@/app/use-canvas-equipment-lifecycle'
import { useConnectionController } from '@/app/use-connection-controller'
import { useProjectSaveQueue } from '@/app/use-project-save-queue'
import { useCanvasSelectionController } from '@/app/use-canvas-selection-controller'
import { useProjectGeometrySync } from '@/app/use-project-geometry-sync'
import { useProjectHydration } from '@/app/use-project-hydration'
import { useProjectCommands } from '@/app/use-project-commands'
import { useCanvasWorkspaceActions } from '@/app/use-canvas-workspace-actions'
import { useRegistrySettingsActions } from '@/app/use-registry-settings-actions'
import { useAppNavigationActions } from '@/app/use-app-navigation-actions'
import { createSettingsDialogProps } from '@/app/create-settings-dialog-props'
import { createInventoryPanelProps } from '@/app/create-inventory-panel-props'
import { createLifecycleDialogProps } from '@/app/create-lifecycle-dialog-props'
import { createOnboardingDialogProps } from '@/app/create-onboarding-dialog-props'
import { createReleaseDialogProps } from '@/app/create-release-dialog-props'
import { createWorkspaceSurfaceProps } from '@/app/create-workspace-surface-props'
import { pushHistory } from '@/lib/history'
import type { ProjectState } from '@/types/inventory'

type SaveStatus = 'saved' | 'saving' | 'error'
type ValidationSeverity = 'error' | 'unknown'

function App() {
  const queryClient = useQueryClient()
  const domainEngine = useDomainEngine()
  const [project, setProject] = useState<ProjectState | null>(null)
  const projectRef = useRef<ProjectState | null>(null)
  const topologyQuery = useTopologyQuery(project)
  const [validationMessage, setValidationMessageValue] = useState<string | null>(null)
  const [validationSeverity, setValidationSeverity] = useState<ValidationSeverity>('error')
  const topologyStatus = project && !topologyQuery.data
    ? domainEngine.state.phase === 'failed'
      || domainEngine.state.phase === 'unsupported'
      || topologyQuery.isError
      ? {
          message: topologyQuery.error instanceof Error
            ? topologyQuery.error.message
            : 'Connection topology is unavailable. Retry the workspace engine before editing cables.',
          severity: 'error' as const,
        }
      : {
          message: 'Loading connection topology...',
          severity: 'unknown' as const,
        }
    : null
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [canonicalMutationBusy, setCanonicalMutationBusy] = useState(false)
  const [canvasOperationLabel, setCanvasOperationLabel] = useState<string | null>(null)
  const workspacePreferences = useWorkspacePreferences()
  const {
    inventoryWidth,
    setInventoryWidth,
    desktopInventoryVisible,
    setDesktopInventoryVisible,
    autoCenterOnSelect,
    openCreatedConnectionInspector,
    snapItemsToGrid,
  } = workspacePreferences
  const [mobileInventoryOpen, setMobileInventoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    query: demoSessionQuery,
    remainingSeconds: demoRemainingSeconds,
    dialogState: demoDialogState,
    extensionSeconds: demoExtensionSeconds,
    extend: extendDemoSession,
    finalizeExpiration: finalizeDemoExpiration,
  } = useDemoSessionLifecycle()
  const canvasControllerRef = useRef<CanvasController | null>(null)
  const canvasSelectionController = useCanvasSelectionController({
    project,
    projectRef,
    topologyData: topologyQuery.data,
    canvasControllerRef,
    autoCenterOnSelect,
    closeMobileInventory: () => setMobileInventoryOpen(false),
  })
  const {
    selectedItemId,
    selectedConnectionId,
    activeNetworkTraceEndpoint,
    setSelectedItemId,
    setSelectedConnectionId,
    setActiveNetworkTraceEndpoint,
    focusCanvasItem,
    selectInventoryItem,
    focusExampleTarget,
  } = canvasSelectionController
  const {
    lastPersistedProjectRef,
    coordinator: persistenceCoordinator,
    scheduleProjectSave,
    settleLegacyProjectPersistence,
    resetPendingSaves,
  } = useProjectSaveQueue({
    projectRef,
    setProject,
    setSaveStatus,
    setPersistenceWarning,
    setCanonicalMutationBusy,
  })
  const {
    history,
    setHistory,
    undoProjectChange,
    redoProjectChange,
  } = useProjectHistory({
    projectRef,
    setProject,
    setSelectedItemId,
    setSelectedConnectionId,
    setValidationMessage,
    scheduleProjectSave,
  })
  const hasHydratedProjectRef = useRef(false)
  const applyInventoryCommandSnapshotRef = useRef<(
    project: ProjectState,
    options?: { historySnapshot?: ProjectState },
  ) => Promise<ProjectState>>(async (nextProject) => nextProject)
  const {
    updateProject,
    validateCanvasPlacement,
    validateCanvasGroupMove,
    updateProjectName,
    applyInventoryCommandSnapshot,
    showCompatibilityUnknownMessage,
    commitEngineMutation,
    commitAssignmentUpdate,
    recoverConnectionMutation,
    commitPlacementUpdates,
  } = useProjectCommands({
    domainEngine,
    queryClient,
    projectRef,
    lastPersistedProjectRef,
    persistenceCoordinator,
    settleLegacyProjectPersistence,
    resetPendingSaves,
    scheduleProjectSave,
    setProject,
    setHistory,
    setSelectedConnectionId,
    clearNetworkTrace: () => setActiveNetworkTraceEndpoint(null),
    setSaveStatus,
    setPersistenceWarning,
    setValidationMessage,
  })
  applyInventoryCommandSnapshotRef.current = applyInventoryCommandSnapshot
  const {
    draggingItemId,
    dragPreviewOverCanvas,
    dragPreviewZoom,
    dropCompatibilityByHostId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    cancelDrag,
  } = useWorkspaceDrag({
    project,
    canvasControllerRef,
    snapItemsToGrid,
    setMobileInventoryOpen,
    setSelectedItemId,
    setSelectedConnectionId,
    setValidationMessage,
    showMessage,
    showCompatibilityUnknownMessage,
    focusCanvasItem,
    validateCanvasPlacement,
    validateCanvasGroupMove,
    commitPlacementUpdates,
    commitAssignmentUpdate,
  })
  const canvasMaintenance = useCanvasMaintenanceController({
    project,
    projectRef,
    snapItemsToGrid,
    commitEngineMutation,
    recoverMutation: recoverConnectionMutation,
    setValidationMessage,
    setCanvasOperationLabel,
  })
  const releaseUpdateController = useReleaseUpdateController()
  const canvasEquipmentLifecycle = useCanvasEquipmentLifecycle({
    project,
    projectRef,
    updateProject,
    commitEngineMutation,
    commitAssignmentUpdate,
    recoverMutation: recoverConnectionMutation,
    recordHistorySnapshot: (snapshot) => {
      setHistory((currentHistory) => pushHistory(currentHistory, snapshot))
    },
    clearCanvasSelection: () => {
      setSelectedItemId(null)
      setSelectedConnectionId(null)
      setPendingConnectionEndpoint(null)
      setPortConnectionPreview(null)
      setActiveNetworkTraceEndpoint(null)
      setValidationMessage(null)
    },
    showMessage,
  })
  const connectionController = useConnectionController({
    projectRef,
    selectedItemId,
    selectedConnectionId,
    activeNetworkTraceEndpoint,
    openCreatedConnectionInspector,
    setSelectedItemId,
    setSelectedConnectionId,
    setActiveNetworkTraceEndpoint,
    setProject,
    setSaveStatus,
    setValidationMessage,
    commitEngineMutation,
    recoverMutation: recoverConnectionMutation,
  })
  const {
    pendingConnectionEndpoint,
    setPendingConnectionEndpoint,
    setPortConnectionPreview,
    clearPendingConnection,
  } = connectionController
  const compatibleTopologyDestinations = useCompatibleTopologyDestinations(
    project,
    pendingConnectionEndpoint,
  )
  const startInventoryResize = useInventoryPanelResize({
    width: inventoryWidth,
    onWidthChange: setInventoryWidth,
  })
  const projectQuery = useQuery({
    queryKey: ['project'],
    queryFn: loadProject,
  })
  const agentStatusQuery = useQuery({
    queryKey: ['agent-status'],
    queryFn: loadAgentStatus,
    refetchInterval: 30_000,
  })
  const {
    updateStatusQuery,
    setUpdateDialogOpen,
    whatsNewVisible: shouldShowWhatsNewDialog,
    updateHighlighted,
  } = releaseUpdateController
  const registryQuery = useRegistryQuery()
  const registryMutations = useRegistryMutations()
  const inventoryLifecycle = useInventoryLifecycle({
    projectRef,
    applyInventorySnapshot: applyInventoryCommandSnapshot,
    validateCanvasPlacement,
    createPrivateTemplate: (item) => registryMutations.createTemplate.mutateAsync({
      name: item.name,
      item,
    }),
    setSelectedItemId,
    setPersistenceWarning,
    showMessage,
    showSuccessMessage: (message) => setValidationMessage(message, 'unknown'),
  })
  const onboardingController = useOnboardingController({
    project,
    selectedItemId,
    selectedConnectionId,
    demoSessionReady: demoSessionQuery.data !== undefined,
    demoDialogState,
    enginePhase: domainEngine.state.phase,
    settingsOpen,
    whatsNewVisible: shouldShowWhatsNewDialog,
    canvasControllerRef,
    applyInventorySnapshot: applyInventoryCommandSnapshot,
    setSettingsOpen,
  })
  const {
    busy: inventoryLifecycleBusy,
    revision: inventoryLifecycleRevision,
    createItem: handleCreateInventoryItem,
    createCatalogItem: handleCreateCatalogInventoryItem,
    savePrivateTemplate: handleSavePrivateTemplate,
    duplicateItem: handleDuplicateInventoryItem,
    requestAction: requestInventoryLifecycle,
    restoreItems: handleRestoreInventoryItems,
    applyUpdate: handleApplyCatalogUpdate,
  } = inventoryLifecycle
  const {
    currentExampleTarget,
  } = onboardingController
  const registryLinkedItemKeys = useMemo(
    () => buildVisibleRegistryLinkKeys(registryQuery.data),
    [registryQuery.data],
  )
  useProjectHydration({
    loadedProject: projectQuery.data,
    project,
    projectRef,
    lastPersistedProjectRef,
    hasHydratedProjectRef,
    domainEngine,
    queryClient,
    setProject,
    setHistory,
    setSelectedItemId,
    setSelectedConnectionId,
    clearPendingConnection,
    clearNetworkTrace: () => setActiveNetworkTraceEndpoint(null),
    setPersistenceWarning,
    setSaveStatus,
    applyInventorySnapshot: (canonicalProject) => applyInventoryCommandSnapshotRef.current(canonicalProject),
  })
  useProjectGeometrySync({ project, domainEngine, setPersistenceWarning })

  const canvasWorkspaceActions = useCanvasWorkspaceActions({
    project,
    snapItemsToGrid,
    validatePlacement: validateCanvasPlacement,
    validateGroupMove: validateCanvasGroupMove,
    commitPlacements: commitPlacementUpdates,
    showMessage,
    setOperationLabel: setCanvasOperationLabel,
  })
  const registrySettingsActions = useRegistrySettingsActions({
    queryClient,
    mutations: registryMutations,
    applyCatalogUpdate: handleApplyCatalogUpdate,
  })
  const navigationActions = useAppNavigationActions({
    setSelectedItemId,
    setSelectedConnectionId,
    clearPendingConnection,
    clearNetworkTrace: () => setActiveNetworkTraceEndpoint(null),
    focusCanvasItem,
    setAuditOpen,
    setSettingsOpen,
    setDesktopInventoryVisible,
    setMobileInventoryOpen,
    updateStatusAvailable: Boolean(updateStatusQuery.data),
    refreshUpdateStatus: async () => Boolean((await updateStatusQuery.refetch()).data),
    setUpdateDialogOpen,
  })
  const isDemoMode = demoSessionQuery.data?.mode === 'demo'
  function setValidationMessage(
    message: string | null,
    severity: ValidationSeverity = 'error',
  ) {
    setValidationMessageValue(message)
    setValidationSeverity(message ? severity : 'error')
  }

  function showMessage(message: string) {
    setValidationMessage(message)
  }

  function showCurrentExampleStep() {
    if (!currentExampleTarget) return
    focusExampleTarget(currentExampleTarget)
  }

  if (projectQuery.isError) {
    const error = projectQuery.error

    return (
      <ErrorScreen
        message={error instanceof Error ? error.message : 'Unknown startup error.'}
        onRetry={() => {
          hasHydratedProjectRef.current = false
          void projectQuery.refetch()
        }}
      />
    )
  }

  if (projectQuery.isLoading || !project) {
    return <LoadingScreen />
  }

  const settingsDialogProps = createSettingsDialogProps({
    open: settingsOpen,
    project,
    saveStatus,
    preferences: workspacePreferences,
    maintenance: canvasMaintenance,
    releases: releaseUpdateController,
    onboarding: onboardingController,
    registryQuery,
    registryMutations,
    registryActions: registrySettingsActions,
    updateProject,
    updateProjectName,
    setOpen: setSettingsOpen,
  })
  const inventoryPanelProps = createInventoryPanelProps({
    desktop: {
      expanded: desktopInventoryVisible,
      width: inventoryWidth,
      onResizePointerDown: startInventoryResize,
    },
    mobile: {
      open: mobileInventoryOpen,
      onOpenChange: setMobileInventoryOpen,
    },
    shared: {
      project,
      onSelect: selectInventoryItem,
      onCreateItem: handleCreateInventoryItem,
      onCreateCatalogItem: handleCreateCatalogInventoryItem,
      onDuplicateItem: handleDuplicateInventoryItem,
      onArchiveItems: (items) => void requestInventoryLifecycle('archive', items),
      onRestoreItems: (items) => void handleRestoreInventoryItems(items),
      onDeleteItems: (items) => void requestInventoryLifecycle('delete', items),
      lifecycleRevision: inventoryLifecycleRevision,
      lifecycleBusy: inventoryLifecycleBusy,
      registry: registryQuery.data,
      onSaveAsTemplate: (item) => void handleSavePrivateTemplate(item),
      onDuplicatePrivateTemplate: async (id) => {
        await registryMutations.duplicateTemplate.mutateAsync(id)
      },
    },
    width: inventoryWidth,
    openSettings: () => setSettingsOpen(true),
    openMobileSettings: () => {
      setMobileInventoryOpen(false)
      setSettingsOpen(true)
    },
  })
  const lifecycleDialogProps = createLifecycleDialogProps({
    project,
    inventory: inventoryLifecycle,
    equipment: canvasEquipmentLifecycle,
  })
  const releaseDialogProps = createReleaseDialogProps(releaseUpdateController)
  const onboardingDialogProps = createOnboardingDialogProps({
    onboarding: onboardingController,
    demoSession: {
      state: demoDialogState,
      secondsRemaining: demoExtensionSeconds,
      onExtend: extendDemoSession,
      onExpire: finalizeDemoExpiration,
    },
  })
  const workspaceSurfaceProps = createWorkspaceSurfaceProps({
    project,
    topologyData: topologyQuery.data,
    topologyStatus,
    compatibleEndpointKeys: compatibleTopologyDestinations.endpointKeys,
    agentStatus: agentStatusQuery.data ?? null,
    demoMode: isDemoMode,
    demoRemainingSeconds,
    registryLinkedItemKeys,
    dropCompatibilityByHostId,
    selection: canvasSelectionController,
    connection: connectionController,
    equipment: canvasEquipmentLifecycle,
    inventory: inventoryLifecycle,
    onboarding: onboardingController,
    preferences: workspacePreferences,
    canvasActions: canvasWorkspaceActions,
    navigation: navigationActions,
    canvasControllerRef,
    validationMessage,
    validationSeverity,
    persistenceWarning,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saveStatus,
    canonicalMutationBusy,
    canvasOperationLabel,
    updateAvailable: updateHighlighted,
    updateStatusLoading: updateStatusQuery.isFetching && !updateStatusQuery.data,
    settingsOpen,
    undo: undoProjectChange,
    redo: redoProjectChange,
    updateProject,
    setValidationMessage,
    showCurrentExampleStep,
  })

  return (
    <AppShell
      drag={{
        onDragStart: handleDragStart,
        onDragOver: handleDragOver,
        onDragCancel: cancelDrag,
        onDragEnd: handleDragEnd,
        overlay: (
          <InventoryDragPreview
            item={draggingItemId ? project.items[draggingItemId] ?? null : null}
            project={project}
            overCanvas={dragPreviewOverCanvas}
            viewportZoom={dragPreviewZoom}
          />
        ),
      }}
    >
          <AppInventoryPanels {...inventoryPanelProps} />
          <AppWorkspaceSurface {...workspaceSurfaceProps} />
          <AppDialogs
            {...lifecycleDialogProps}
            {...releaseDialogProps}
            {...onboardingDialogProps}
            audit={{
              project,
              topologyData: topologyQuery.data,
              open: auditOpen,
              onClose: () => setAuditOpen(false),
              onSelectItem: navigationActions.selectAuditItem,
              onSetWarningIgnored: (warningId, ignored) => {
                updateProject(setAuditWarningIgnored(project, warningId, ignored))
              },
            }}
            search={{
              project,
              open: searchOpen,
              onOpenChange: setSearchOpen,
              onSelectItem: navigationActions.selectSearchItem,
            }}
            settings={settingsDialogProps}
          />
    </AppShell>
  )
}

export default App
