import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type CanvasController,
} from '@/components/workbench-canvas-contract'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import { usePermission } from '@/hooks/use-permission'
import { useAuth } from '@/hooks/use-auth'
import {
  catalogFacetPrefetchEnabled,
  useCatalogFacetPrefetch,
  useRegistryMutations,
  useRegistryQuery,
} from '@/hooks/use-registry'
import { useNotificationSummary } from '@/hooks/use-notifications'
import { useAgentStatus } from '@/hooks/use-agent-status'
import { useDesktopBreakpoint } from '@/hooks/use-desktop-breakpoint'
import {
  useCompatibleTopologyDestinations,
  useTopologyQuery,
} from '@/hooks/use-topology-query'
import { setAuditWarningIgnored } from '@/lib/compatibility-policy'
import { addGlobalInventoryToProject, loadProject } from '@/lib/db'
import { loadWorkspace, saveWorkspace, type ProjectWorkbook } from '@/lib/workbook-api'
import { buildVisibleRegistryLinkKeys } from '@/lib/registry-links'
import { loadCatalogUpdateSummary } from '@/lib/registry-api'
import { ErrorScreen, LoadingScreen } from '@/app/app-status-screens'
import { AppDialogs } from '@/app/app-dialogs'
import { AppInventoryPanels } from '@/app/app-inventory-panels'
import { AppShell } from '@/app/app-shell'
import { AppWorkspaceSurface } from '@/app/app-workspace-surface'
import { InventoryDragPreview } from '@/app/inventory-drag-preview'
import { ProjectSwitcher } from '@/components/workbook/project-switcher'
import { WorkbookTabStrip } from '@/components/workbook/workbook-tab-strip'
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
import { useCanvasEngineReactivation } from '@/app/use-canvas-engine-reactivation'
import { useProjectGeometrySync } from '@/app/use-project-geometry-sync'
import { useProjectHydration } from '@/app/use-project-hydration'
import { useProjectCommands } from '@/app/use-project-commands'
import { useCanvasWorkspaceActions } from '@/app/use-canvas-workspace-actions'
import { useRegistrySettingsActions } from '@/app/use-registry-settings-actions'
import { useAppNavigationActions } from '@/app/use-app-navigation-actions'
import { useWorkbookController } from '@/app/use-workbook-controller'
import { createSettingsDialogProps } from '@/app/create-settings-dialog-props'
import { createInventoryPanelProps } from '@/app/create-inventory-panel-props'
import { createLifecycleDialogProps } from '@/app/create-lifecycle-dialog-props'
import { createOnboardingDialogProps } from '@/app/create-onboarding-dialog-props'
import { createReleaseDialogProps } from '@/app/create-release-dialog-props'
import { createWorkspaceSurfaceProps } from '@/app/create-workspace-surface-props'
import { createEmptyHistory, pushHistory } from '@/lib/history'
import type { ProjectState } from '@/types/inventory'
import type { InventoryMetadataSavedChange } from '@/types/inventory-metadata'
import type { InventoryMetadataSettingsTab, SettingsDestination } from '@/types/settings-navigation'
import type { DomainMutationResult, MutationEffects } from '@/types/domain-mutation'
import { NO_MUTATION_EFFECTS } from '@/types/domain-mutation'
import { inventoryMetadataKeys } from '@/lib/inventory-metadata-query'
import {
  createProjectHistorySnapshot,
  type InventoryMetadataHistoryState,
} from '@/app/project-history-snapshot'
import { browserPreferenceScope } from '@/lib/browser-preference-scope'
import { cacheProjectState } from '@/lib/project-query-key'
import { projectQueryKeyForScope } from '@/lib/project-query-key'
import { canvasRuntimeKey } from '@/engine/runtime-scope'
import {
  type CanvasRuntimeViewState,
  validCanvasRuntimeViewState,
} from '@/app/canvas-runtime-view-state'
import { createSystemsProjectScope, shouldLoadCanvasProject } from '@/app/workspace-project-loading'

type SaveStatus = 'saved' | 'saving' | 'error'
type ValidationSeverity = 'error' | 'unknown'

function App() {
  const queryClient = useQueryClient()
  const auth = useAuth()
  const domainEngine = useDomainEngine()
  const activateCanvasEngine = domainEngine.activateCanvas
  const clearCanvasRuntimes = domainEngine.clearCanvasRuntimes
  const getCanvasRuntimeKeys = domainEngine.getCanvasRuntimeKeys
  const removeCanvasRuntime = domainEngine.removeCanvasRuntime
  const setCanvasRuntimeBusy = domainEngine.setRuntimeBusy
  const engineAccountScope = auth.status?.account?.id
    ? `account:${auth.status.account.id}`
    : auth.status?.mode === 'disabled'
      ? 'installation-local'
      : null
  const canViewAgents = usePermission('agents.view')
  const canViewRegistry = usePermission('registry.view')
  const canViewUpdates = usePermission('updates.view')
  const canManageAudit = usePermission('audit.manage')
  const canViewAudit = usePermission('audit.view')
  const canViewNotifications = usePermission('notifications.view')
  const [project, setProject] = useState<ProjectState | null>(null)
  const projectRef = useRef<ProjectState | null>(null)
  const runtimeViewStatesRef = useRef(new Map<string, CanvasRuntimeViewState>())
  const [validationMessage, setValidationMessageValue] = useState<string | null>(null)
  const [validationSeverity, setValidationSeverity] = useState<ValidationSeverity>('error')
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [canonicalMutationBusy, setCanonicalMutationBusy] = useState(false)
  const [canvasOperationLabel, setCanvasOperationLabel] = useState<string | null>(null)
  const [mobileInventoryOpen, setMobileInventoryOpen] = useState(false)
  const desktopLayout = useDesktopBreakpoint()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDestination, setSettingsDestination] = useState<SettingsDestination | null>(null)
  const settingsRequestIdRef = useRef(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [registryUpdatesOpen, setRegistryUpdatesOpen] = useState(false)
  const setSettingsDialogOpen = useCallback((open: boolean) => {
    setSettingsOpen(open)
    if (!open) setSettingsDestination(null)
  }, [])
  const openSettings = useCallback(() => {
    setSettingsDestination(null)
    setSettingsOpen(true)
  }, [])
  const openInventoryMetadataSettings = useCallback((tab: InventoryMetadataSettingsTab) => {
    settingsRequestIdRef.current += 1
    setSettingsDestination({
      requestId: settingsRequestIdRef.current,
      category: 'inventory-metadata',
      inventoryMetadataTab: tab,
    })
    setSettingsOpen(true)
  }, [])
  const {
    query: demoSessionQuery,
    remainingSeconds: demoRemainingSeconds,
    dialogState: demoDialogState,
    extensionSeconds: demoExtensionSeconds,
    extend: extendDemoSession,
    finalizeExpiration: finalizeDemoExpiration,
  } = useDemoSessionLifecycle()
  const canvasControllerRef = useRef<CanvasController | null>(null)
  const registryUpdatesQuery = useQuery({
    queryKey: ['registry', 'update-summary'],
    queryFn: loadCatalogUpdateSummary,
    enabled: canViewRegistry,
    staleTime: 60_000,
  })
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
  const workbookHistoryRef = useRef<ProjectWorkbook | null>(null)
  const recordWorkbookHistoryRef = useRef<(before: ProjectWorkbook, after: ProjectWorkbook) => void>(
    () => undefined,
  )
  const workbookController = useWorkbookController({
    beforeNavigate: settleLegacyProjectPersistence,
    onHistoryChange: (before, after) => recordWorkbookHistoryRef.current(before, after),
  })
  workbookHistoryRef.current = workbookController.activeWorkbook
  const canvasWorkspaceActive = workbookController.activeWorkspace?.type === 'canvas'
  const systemsWorkspaceActive = workbookController.activeWorkspace?.type === 'systems'
  const systemsProjectScope = useMemo(
    () => createSystemsProjectScope(workbookController.activeWorkbook, workbookController.activeWorkspace),
    [workbookController.activeWorkbook, workbookController.activeWorkspace],
  )
  const sidebarPreferenceScope = workbookController.activeWorkbook && workbookController.sourceCanvasWorkspace
    ? browserPreferenceScope(
        auth.status?.account?.id ?? null,
        workbookController.activeWorkbook.project.id,
        workbookController.sourceCanvasWorkspace.id,
      )
    : null
  const workspacePreferences = useWorkspacePreferences({
    workspace: workbookController.sourceCanvasWorkspace,
    browserScope: sidebarPreferenceScope,
    onWorkspaceSettingsChange: (settings) => workbookController.updateCanvasConfiguration({ settings }),
    onWorkspaceViewportChange: (viewport) => workbookController.updateCanvasConfiguration({ viewport }),
  })
  const {
    inventoryWidth,
    setInventoryWidth,
    desktopInventoryVisible,
    setDesktopInventoryVisible,
    autoCenterOnSelect,
    openCreatedConnectionInspector,
    snapItemsToGrid,
  } = workspacePreferences
  const topologyQuery = useTopologyQuery(
    canvasWorkspaceActive ? project : null,
  )
  const topologyStatus = project
    && canvasWorkspaceActive
    && !topologyQuery.data
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
  useCanvasEngineReactivation({
    canvasWorkspaceActive,
    engineEnabled: domainEngine.enabled,
    enginePhase: domainEngine.state.phase,
    engineRuntimeKey: domainEngine.runtimeKey,
    engineGeneration: domainEngine.generation,
    selectedItemId,
    autoCenterOnSelect,
    focusCanvasItem,
  })
  const sourceProjectId = workbookController.activeWorkbook?.project.id ?? null
  const sourceWorkspaceId = workbookController.sourceCanvasWorkspace?.id ?? null
  const canvasEngineScope = useMemo(() => (
    canvasWorkspaceActive
    && engineAccountScope
    && sourceProjectId
    && sourceWorkspaceId
      ? {
          accountScope: engineAccountScope,
          projectId: sourceProjectId,
          workspaceId: sourceWorkspaceId,
          workspaceType: 'canvas' as const,
        }
      : null
  ), [canvasWorkspaceActive, engineAccountScope, sourceProjectId, sourceWorkspaceId])
  const engineAccountScopeRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!engineAccountScope) return
    if (engineAccountScopeRef.current && engineAccountScopeRef.current !== engineAccountScope) {
      clearCanvasRuntimes()
      runtimeViewStatesRef.current.clear()
    }
    engineAccountScopeRef.current = engineAccountScope
  }, [clearCanvasRuntimes, engineAccountScope])
  useLayoutEffect(() => {
    activateCanvasEngine(canvasEngineScope)
  }, [
    activateCanvasEngine,
    canvasEngineScope,
  ])
  const defaultWorkspaceActive = sourceProjectId === 1 && sourceWorkspaceId === 2
  const activeProjectQueryKey = defaultWorkspaceActive
    ? ['project'] as const
    : ['project', sourceProjectId, sourceWorkspaceId] as const
  const loadActiveProject = () => defaultWorkspaceActive
    ? loadProject()
    : loadWorkspace(sourceProjectId!, sourceWorkspaceId!)
  const projectQuery = useQuery({
    queryKey: activeProjectQueryKey,
    queryFn: loadActiveProject,
    enabled: sourceProjectId !== null
      && sourceWorkspaceId !== null
      && shouldLoadCanvasProject(canvasWorkspaceActive, settingsOpen),
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const inventoryMetadataHistoryRef = useRef<InventoryMetadataHistoryState>(new Map())
  const applyHistoryDomainMutationRef = useRef<(
    result: DomainMutationResult<ProjectState>,
  ) => Promise<ProjectState>>(async (result) => result.data)
  const restorePlacementHistoryRef = useRef<(
    project: ProjectState,
  ) => Promise<ProjectState>>(async (nextProject) => nextProject)
  const restoreWorkspaceHistoryRef = useRef<(
    project: ProjectState,
  ) => Promise<ProjectState>>(async (nextProject) => nextProject)
  const {
    history,
    historyBusy,
    setHistory,
    undoProjectChange,
    redoProjectChange,
    recordWorkbookChange,
    recordWorkspaceChange,
  } = useProjectHistory({
    projectRef,
    inventoryMetadataHistoryRef,
    workbookHistoryRef,
    setProject,
    setSelectedItemId,
    setSelectedConnectionId,
    setValidationMessage,
    scheduleProjectSave,
    applyDomainMutationResult: (result) => applyHistoryDomainMutationRef.current(result),
    restorePlacementHistory: (nextProject) => restorePlacementHistoryRef.current(nextProject),
    restoreWorkspaceHistory: (nextProject) => restoreWorkspaceHistoryRef.current(nextProject),
    restoreWorkbookHistory: workbookController.restoreWorkbookSnapshot,
    refreshInventoryMetadata: async (projectIds, items) => {
      for (const item of items) {
        for (const projectId of projectIds) {
          queryClient.setQueryData(
            inventoryMetadataKeys.item(projectId, item.ref),
            item.metadata,
          )
        }
      }
      await Promise.all(projectIds.map((projectId) => queryClient.invalidateQueries({
        queryKey: inventoryMetadataKeys.projectProjections(projectId),
      })))
    },
  })
  recordWorkbookHistoryRef.current = recordWorkbookChange
  useLayoutEffect(() => {
    if (!domainEngine.runtimeKey) return
    setCanvasRuntimeBusy(
      domainEngine.runtimeKey,
      canonicalMutationBusy || historyBusy || saveStatus === 'saving',
    )
  }, [
    canonicalMutationBusy,
    domainEngine.runtimeKey,
    historyBusy,
    saveStatus,
    setCanvasRuntimeBusy,
  ])
  const hasHydratedProjectRef = useRef(false)
  const hydratedWorkspaceKeyRef = useRef<string | null>(null)
  const activeWorkspaceKey = engineAccountScope && sourceProjectId && sourceWorkspaceId
    ? canvasRuntimeKey({
        accountScope: engineAccountScope,
        projectId: sourceProjectId,
        workspaceId: sourceWorkspaceId,
        workspaceType: 'canvas',
      })
    : null
  const discardCanvasRuntime = useCallback((projectId: number, workspaceId: number) => {
    if (!engineAccountScope) return
    const scope = {
      accountScope: engineAccountScope,
      projectId,
      workspaceId,
      workspaceType: 'canvas' as const,
    }
    runtimeViewStatesRef.current.delete(canvasRuntimeKey(scope))
    removeCanvasRuntime(scope)
    queryClient.removeQueries({ queryKey: projectQueryKeyForScope(projectId, workspaceId), exact: true })
  }, [engineAccountScope, queryClient, removeCanvasRuntime])
  useLayoutEffect(() => {
    if (!activeWorkspaceKey) return
    if (hydratedWorkspaceKeyRef.current === null) {
      hydratedWorkspaceKeyRef.current = activeWorkspaceKey
      return
    }
    if (hydratedWorkspaceKeyRef.current === activeWorkspaceKey) return
    const previousWorkspaceKey = hydratedWorkspaceKeyRef.current
    const previousProject = projectRef.current
    if (previousWorkspaceKey && previousProject) {
      runtimeViewStatesRef.current.set(previousWorkspaceKey, {
        project: previousProject,
        history,
        metadataHistory: new Map(inventoryMetadataHistoryRef.current),
        selectedItemId,
        selectedConnectionId,
        activeNetworkTraceEndpoint,
      })
    }
    hydratedWorkspaceKeyRef.current = activeWorkspaceKey
    resetPendingSaves()
    canvasControllerRef.current = null
    const retainedRuntimeKeys = new Set(getCanvasRuntimeKeys())
    for (const key of runtimeViewStatesRef.current.keys()) {
      if (!retainedRuntimeKeys.has(key) && key !== activeWorkspaceKey) {
        runtimeViewStatesRef.current.delete(key)
      }
    }

    const cachedState = runtimeViewStatesRef.current.get(activeWorkspaceKey)
    const queryProject = sourceProjectId && sourceWorkspaceId
      ? queryClient.getQueryData<ProjectState>(projectQueryKeyForScope(sourceProjectId, sourceWorkspaceId))
      : undefined
    const restoredState = cachedState
      ? validCanvasRuntimeViewState({
          ...cachedState,
          project: queryProject
            && (queryProject.revision ?? 0) > (cachedState.project.revision ?? 0)
            ? queryProject
            : cachedState.project,
        })
      : queryProject
        ? validCanvasRuntimeViewState({
            project: queryProject,
            history: createEmptyHistory(),
            metadataHistory: new Map(),
            selectedItemId: null,
            selectedConnectionId: null,
            activeNetworkTraceEndpoint: null,
          })
        : null

    if (!restoredState) {
      hasHydratedProjectRef.current = false
      inventoryMetadataHistoryRef.current = new Map()
      setHistory(createEmptyHistory())
      setSelectedItemId(null)
      setSelectedConnectionId(null)
      setActiveNetworkTraceEndpoint(null)
      return
    }

    hasHydratedProjectRef.current = true
    projectRef.current = restoredState.project
    lastPersistedProjectRef.current = restoredState.project
    inventoryMetadataHistoryRef.current = new Map(restoredState.metadataHistory)
    setProject(restoredState.project)
    setHistory(restoredState.history)
    setSelectedItemId(restoredState.selectedItemId)
    setSelectedConnectionId(restoredState.selectedConnectionId)
    setActiveNetworkTraceEndpoint(restoredState.activeNetworkTraceEndpoint)
  }, [
    activeWorkspaceKey,
    activeNetworkTraceEndpoint,
    getCanvasRuntimeKeys,
    hasHydratedProjectRef,
    history,
    lastPersistedProjectRef,
    projectRef,
    queryClient,
    resetPendingSaves,
    selectedConnectionId,
    selectedItemId,
    setActiveNetworkTraceEndpoint,
    setHistory,
    setSelectedConnectionId,
    setSelectedItemId,
    sourceProjectId,
    sourceWorkspaceId,
  ])
  const applyInventoryCommandSnapshotRef = useRef<(
    project: ProjectState,
    options?: {
      historySnapshot?: ProjectState
      metadataChange?: Pick<InventoryMetadataSavedChange, 'ref' | 'before' | 'after'>
      effects?: MutationEffects
      preserveHistory?: boolean
    },
  ) => Promise<ProjectState>>(async (nextProject) => nextProject)
  const {
    updateProject,
    validateCanvasPlacement,
    validateCanvasGroupMove,
    updateProjectName,
    applyInventoryCommandSnapshot,
    recordInventoryMetadataChange,
    showCompatibilityUnknownMessage,
    commitEngineMutation,
    commitAssignmentUpdate,
    recoverConnectionMutation,
    commitPlacementUpdates,
    restorePlacementHistory,
  } = useProjectCommands({
    domainEngine,
    queryClient,
    projectRef,
    inventoryMetadataHistoryRef,
    workbookHistoryRef,
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
  restorePlacementHistoryRef.current = restorePlacementHistory
  applyHistoryDomainMutationRef.current = (result) => applyInventoryCommandSnapshot(
    result.data,
    { effects: result.effects, preserveHistory: true },
  )

  async function persistInactiveWorkspace(nextProject: ProjectState) {
    const currentProject = projectRef.current
    const projectId = nextProject.metadata.projectId
    const workspaceId = nextProject.metadata.workspaceId
    if (
      !currentProject
      || !projectId
      || !workspaceId
      || currentProject.metadata.projectId !== projectId
      || currentProject.metadata.workspaceId === workspaceId
    ) {
      throw new Error('Choose a different destination canvas in the current project.')
    }

    return persistenceCoordinator.run(settleLegacyProjectPersistence, async () => {
      const latestDestination = await loadWorkspace(projectId, workspaceId)
      const saved = await saveWorkspace(projectId, workspaceId, {
        ...latestDestination,
        placements: nextProject.placements,
        assignments: nextProject.assignments,
        connections: nextProject.connections,
      })
      cacheProjectState(queryClient, saved)

      const activeWorkspaceId = currentProject.metadata.workspaceId
      if (!activeWorkspaceId) throw new Error('The source canvas identity is not recorded.')
      const refreshedSource = await loadWorkspace(projectId, activeWorkspaceId)
      if (domainEngine.enabled && typeof refreshedSource.revision === 'number') {
        await domainEngine.client.synchronizeCanonicalRevision(
          refreshedSource.revision,
          'Synchronizing the copied canvas configuration.',
        )
      }
      await applyInventoryCommandSnapshot(refreshedSource, {
        effects: NO_MUTATION_EFFECTS,
        preserveHistory: true,
      })
      await queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'systems'] })
      return saved
    })
  }

  restoreWorkspaceHistoryRef.current = persistInactiveWorkspace

  async function copyHostConfiguration(previous: ProjectState, nextProject: ProjectState) {
    const saved = await persistInactiveWorkspace(nextProject)
    recordWorkspaceChange(previous, saved)
  }

  async function handleInventoryMetadataSaved(change: InventoryMetadataSavedChange) {
    recordInventoryMetadataChange({
      ref: change.ref,
      before: change.before,
      after: change.after,
    })
  }
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
  const releaseUpdateController = useReleaseUpdateController({ canViewUpdates })
  const canvasEquipmentLifecycle = useCanvasEquipmentLifecycle({
    project,
    projectRef,
    updateProject,
    commitEngineMutation,
    commitAssignmentUpdate,
    recoverMutation: recoverConnectionMutation,
    recordHistorySnapshot: (snapshot) => {
      setHistory((currentHistory) => pushHistory(
        currentHistory,
        createProjectHistorySnapshot(
          snapshot,
          inventoryMetadataHistoryRef.current,
          workbookHistoryRef.current,
        ),
      ))
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
  const agentStatusQuery = useAgentStatus(canViewAgents && (!systemsWorkspaceActive || Boolean(selectedItemId)))
  const {
    updateStatusQuery,
    setUpdateDialogOpen,
    whatsNewVisible: shouldShowWhatsNewDialog,
    updateHighlighted,
  } = releaseUpdateController
  const registryQuery = useRegistryQuery(canViewRegistry && (canvasWorkspaceActive || settingsOpen))
  useCatalogFacetPrefetch(
    registryQuery.data?.snapshot,
    catalogFacetPrefetchEnabled({
      canViewRegistry,
      canvasWorkspaceActive,
      projectLoaded: Boolean(project),
    }),
  )
  const notificationQuery = useNotificationSummary(canViewNotifications && canvasWorkspaceActive)
  const registryMutations = useRegistryMutations()
  const inventoryLifecycle = useInventoryLifecycle({
    scope: sourceProjectId && sourceWorkspaceId
      ? { projectId: sourceProjectId, workspaceId: sourceWorkspaceId }
      : null,
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
    activeProjectId: sourceProjectId ?? 1,
    projects: workbookController.workbooks.map((workbook) => workbook.project),
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
    setSettingsOpen: setSettingsDialogOpen,
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
    inventoryMetadataHistoryRef,
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
    reloadProject: loadActiveProject,
    queryKey: activeProjectQueryKey,
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
    setSettingsOpen: setSettingsDialogOpen,
    setDesktopInventoryVisible,
    setMobileInventoryOpen,
    desktopLayout,
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

  if (projectQuery.isError || workbookController.loadError) {
    const error = projectQuery.error ?? workbookController.loadError

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

  const projectMatchesActiveWorkspace = Boolean(
    project
    && (
      (project.metadata.projectId === sourceProjectId && project.metadata.workspaceId === sourceWorkspaceId)
      || (defaultWorkspaceActive && !project.metadata.projectId && !project.metadata.workspaceId)
    ),
  )
  const surfaceProject = project ?? systemsProjectScope
  const fullProjectRequired = shouldLoadCanvasProject(canvasWorkspaceActive, settingsOpen)

  if (
    workbookController.loading
    || !surfaceProject
    || (fullProjectRequired && !project)
    || !workbookController.activeWorkspace
    || !workbookController.activeWorkbook
  ) {
    return <LoadingScreen />
  }

  const inventorySidebarAvailable = workbookController.activeWorkspace.type === 'canvas'
  const effectiveDesktopInventoryVisible = inventorySidebarAvailable && desktopInventoryVisible
  const inventoryOpen = inventorySidebarAvailable && (
    desktopLayout ? desktopInventoryVisible : mobileInventoryOpen
  )

  const settingsDialogProps = createSettingsDialogProps({
    open: settingsOpen,
    destination: settingsDestination,
    project: surfaceProject,
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
    setOpen: setSettingsDialogOpen,
    workbook: workbookController,
  })
  const inventoryPanelProps = createInventoryPanelProps({
    preferenceScope: sidebarPreferenceScope ?? browserPreferenceScope(
      auth.status?.account?.id ?? null,
      workbookController.activeWorkbook.project.id,
    ),
    desktopLayout,
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
      project: surfaceProject,
      onSelect: selectInventoryItem,
      onCreateItem: handleCreateInventoryItem,
      onCreateCatalogItem: handleCreateCatalogInventoryItem,
      onDuplicateItem: handleDuplicateInventoryItem,
      onDuplicateItemToProject: inventoryLifecycle.projects.length > 1
        ? (item) => inventoryLifecycle.requestScopeAction('duplicate-to-project', item)
        : undefined,
      onChangeItemScope: (item, scope) => inventoryLifecycle.requestScopeAction(
        scope === 'global' ? 'make-global' : 'make-project-bound',
        item,
      ),
      onRemoveGlobalItemFromProject: (item) => inventoryLifecycle.requestScopeAction('remove-from-project', item),
      globalInventoryEnabled: workbookController.activeWorkbook.project.includesGlobalInventory,
      onAddGlobalInventory: async (item) => {
        const previousProject = projectRef.current
        const result = await addGlobalInventoryToProject(sourceProjectId!, { type: item.type, id: item.id })
        await applyInventoryCommandSnapshot(result.project, { historySnapshot: previousProject ?? undefined })
        setSelectedItemId(`${item.type}:${item.id}`)
        await queryClient.invalidateQueries({ queryKey: ['global-inventory-available', sourceProjectId] })
      },
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
    openSettings,
    openMobileSettings: () => {
      setMobileInventoryOpen(false)
      openSettings()
    },
  })
  const lifecycleDialogProps = createLifecycleDialogProps({
    project: surfaceProject,
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
  const workspaceSurfaceProps = {
    ...createWorkspaceSurfaceProps({
    project: surfaceProject,
    workspaces: workbookController.activeWorkbook?.workspaces ?? [],
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
    canUndo: !historyBusy
      && (!domainEngine.enabled || domainEngine.state.phase === 'ready')
      && history.past.length > 0,
    canRedo: !historyBusy
      && (!domainEngine.enabled || domainEngine.state.phase === 'ready')
      && history.future.length > 0,
    saveStatus,
    canonicalMutationBusy,
    canvasOperationLabel,
    updateAvailable: updateHighlighted,
    updateStatusLoading: updateStatusQuery.isFetching && !updateStatusQuery.data,
    canViewNotifications,
    canViewAudit,
    notificationCount: notificationQuery.data?.summary.unacknowledged ?? 0,
    registryUpdateCount: registryUpdatesQuery.data
      ? registryUpdatesQuery.data.counts.review + registryUpdatesQuery.data.counts.blocked
      : 0,
    registryUpdateSummary: registryUpdatesQuery.data?.run
      ? registryUpdatesQuery.data.run.state === 'failed'
        ? `Catalog revision ${registryUpdatesQuery.data.run.catalogRevision} evaluation failed`
        : `Latest run applied ${registryUpdatesQuery.data.run.appliedCount} updates and left ${registryUpdatesQuery.data.run.reviewCount + registryUpdatesQuery.data.run.blockedCount} for review`
      : 'No registry update run has completed yet',
    canViewRegistryUpdates: canViewRegistry,
    settingsOpen,
    inventoryOpen,
    openNotifications: () => setNotificationsOpen(true),
    openRegistryUpdates: () => setRegistryUpdatesOpen(true),
    undo: undoProjectChange,
    redo: redoProjectChange,
    updateProject,
    copyHostConfiguration,
    inventoryMetadataSaved: handleInventoryMetadataSaved,
    openInventoryMetadataSettings,
    setValidationMessage,
      showCurrentExampleStep,
    }),
      workbook: {
      workspace: workbookController.activeWorkspace,
      workspaces: workbookController.activeWorkbook?.workspaces ?? [],
      project: surfaceProject,
      selectedItemId,
      onSelectItem: canvasSelectionController.selectInventoryItem,
      onCloseInspector: navigationActions.clearCanvasSelection,
    },
    canvasRuntime: {
      activeRuntimeKey: canvasWorkspaceActive ? activeWorkspaceKey : null,
      activeReady: canvasWorkspaceActive && projectMatchesActiveWorkspace,
      retainedRuntimeKeys: getCanvasRuntimeKeys(),
    },
  }

  return (
    <AppShell
      drag={canvasWorkspaceActive ? {
        onDragStart: handleDragStart,
        onDragOver: handleDragOver,
        onDragCancel: cancelDrag,
        onDragEnd: handleDragEnd,
        overlay: (
          <InventoryDragPreview
            item={draggingItemId ? surfaceProject.items[draggingItemId] ?? null : null}
            project={surfaceProject}
            overCanvas={dragPreviewOverCanvas}
            viewportZoom={dragPreviewZoom}
          />
        ),
      } : null}
      projectControlOffset={effectiveDesktopInventoryVisible ? inventoryWidth + 12 : 12}
      projectControl={(
        <ProjectSwitcher
          projects={workbookController.workbooks.map((workbook) => workbook.project)}
          activeProjectId={workbookController.activeWorkbook.project.id}
          busy={workbookController.busy}
          error={workbookController.error}
          onSelect={(projectId) => void workbookController.selectProject(projectId)}
          onCreate={workbookController.createProject}
          onUpdate={workbookController.updateProject}
          onArchive={async (projectId) => {
            const archivedWorkbook = workbookController.workbooks.find(
              (workbook) => workbook.project.id === projectId,
            )
            await workbookController.archiveProject(projectId)
            for (const workspace of archivedWorkbook?.workspaces ?? []) {
              if (workspace.type === 'canvas') discardCanvasRuntime(projectId, workspace.id)
            }
          }}
          onRestored={workbookController.registerRestoredProject}
          onDeleted={workbookController.forgetDeletedProject}
        />
      )}
      workbookTabs={(
        <WorkbookTabStrip
          workspaces={[...workbookController.activeWorkbook.workspaces]}
          activeWorkspaceId={workbookController.activeWorkspace.id}
          busy={workbookController.busy}
          error={workbookController.error}
          onSelect={(workspaceId) => void workbookController.navigate({
            projectId: workbookController.activeWorkbook!.project.id,
            workspaceId,
          })}
          onCreate={workbookController.createWorkspace}
          onUpdate={workbookController.updateWorkspace}
          onArchive={async (workspaceId) => {
            const projectId = workbookController.activeWorkbook!.project.id
            const archivedWorkspace = workbookController.activeWorkbook!.workspaces.find(
              (workspace) => workspace.id === workspaceId,
            )
            await workbookController.archiveWorkspace(workspaceId)
            if (archivedWorkspace?.type === 'canvas') discardCanvasRuntime(projectId, workspaceId)
          }}
          onReorder={workbookController.reorderWorkspaces}
          onOpenProjectSettings={openSettings}
        />
      )}
    >
          {inventorySidebarAvailable ? <AppInventoryPanels {...inventoryPanelProps} /> : null}
          <AppWorkspaceSurface {...workspaceSurfaceProps} />
          <AppDialogs
            {...lifecycleDialogProps}
            {...releaseDialogProps}
            {...onboardingDialogProps}
            audit={{
              project: surfaceProject,
              topologyData: topologyQuery.data,
              open: auditOpen,
              onClose: () => setAuditOpen(false),
              onSelectItem: navigationActions.selectAuditItem,
              onSetWarningIgnored: canManageAudit
                ? (warningId, ignored) => {
                    updateProject(setAuditWarningIgnored(surfaceProject, warningId, ignored))
                  }
                : undefined,
            }}
            search={{
              project: surfaceProject,
              open: searchOpen,
              onOpenChange: setSearchOpen,
              onSelectItem: navigationActions.selectSearchItem,
            }}
            settings={settingsDialogProps}
            notifications={canViewNotifications ? { open: notificationsOpen, onOpenChange: setNotificationsOpen } : undefined}
            registryUpdates={canViewRegistry ? {
              open: registryUpdatesOpen,
              onOpenChange: setRegistryUpdatesOpen,
              onApplied: async (result) => {
                await queryClient.invalidateQueries({ queryKey: ['registry'], exact: true })
                if (sourceProjectId === null || !result.affectedProjectIds.includes(sourceProjectId)) return
                const canonicalProject = await loadActiveProject()
                queryClient.setQueryData(activeProjectQueryKey, canonicalProject)
                await applyInventoryCommandSnapshot(canonicalProject)
              },
            } : undefined}
          />
    </AppShell>
  )
}

export default App
