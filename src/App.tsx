import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { XYPosition } from '@xyflow/react'
import type { EngineResponse, ProjectPatch } from '../shared/engine/protocol.mjs'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuditDrawer } from '@/components/audit-drawer'
import { AssignedComponentRemovalDialog } from '@/components/assigned-component-removal-dialog'
import { DemoSessionDialog, type DemoSessionDialogState } from '@/components/demo-session-dialog'
import { DesktopInventoryShell } from '@/components/desktop-inventory-shell'
import { GlobalItemSearch } from '@/components/global-item-search'
import { InspectorPanel } from '@/components/inspector-panel'
import { NasPowerConfigurationDialog } from '@/components/nas-power-configuration-dialog'
import { ReturnToInventoryDialog } from '@/components/return-to-inventory-dialog'
import { InventorySidebar } from '@/components/inventory-sidebar'
import {
  InventoryLifecycleDialog,
  type InventoryLifecycleAction,
} from '@/components/inventory-lifecycle-dialog'
import { UpdateDialog } from '@/components/update-dialog'
import { WhatsNewDialog } from '@/components/whats-new-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import {
  snapToGrid,
  WorkbenchCanvas,
  type CanvasController,
  type CanvasFocusOptions,
  type ComponentDragData,
  getComponentDropCompatibilityStatus,
} from '@/components/workbench-canvas'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'
import { applyEngineResponsePatch } from '@/engine/project-patches'
import {
  acknowledgeOptimisticAssignments,
  applyAssignmentTransition,
  updateProjectAssignments,
} from '@/engine/assignments'
import { updateProjectPlacements } from '@/engine/placements'
import {
  createTopologyConnection,
  removeTopologyConnection,
  updateTopologyConnectionLabel,
  updateTopologyConnectionRoute,
} from '@/engine/topology'
import {
  arrangeProjectItems,
  checkProjectGroupMove,
  checkProjectPlacement,
  createProjectGeometrySnapshot,
  syncProjectGeometry,
} from '@/engine/geometry'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import {
  useCompatibleTopologyDestinations,
  useTopologyQuery,
} from '@/hooks/use-topology-query'
import type { CanvasPortDragPoint } from '@/types/canvas'
import {
  findAssignmentById,
  getAssignedComponentConnectionIds,
  moveAssignedComponent,
  tryAssignComponent,
  tryRemoveAssignedComponent,
} from '@/lib/constraints'
import {
  clearIgnoredAuditWarnings,
  enableCompatibilityForAllHosts,
  setAuditWarningIgnored,
} from '@/lib/compatibility-policy'
import { loadAgentStatus } from '@/lib/agent-api'
import {
  createInventoryItems,
  archiveInventoryItems,
  changeNasPowerConfiguration,
  deleteInventoryItems,
  duplicateInventoryItem,
  loadInventoryDependencyReports,
  loadProject,
  restoreInventoryItems,
  saveProject,
  updateInventoryItem,
  updateInventoryItemProperties,
  type InventoryItemInput,
} from '@/lib/db'
import { expireDemoSession, extendDemoSession, loadDemoSession, type DemoSessionStatus } from '@/lib/demo-api'
import { runtimeItemKey } from '@/lib/item-keys'
import {
  getInventoryDragPreviewPresentation,
  isInventoryDragOverCanvas,
} from '@/lib/inventory-drag-preview'
import { resolveCreatedConnectionSelection } from '@/lib/created-connection-selection'
import type {
  InventoryDependencyReason,
  InventoryDependencyReport,
  InventoryRef,
} from '@/lib/inventory-lifecycle'
import {
  acknowledgeReleaseNotes,
  loadReleaseNotesStatus,
  type ReleaseNotesStatus,
} from '@/lib/release-notes-api'
import {
  checkForUpdates,
  clearSkippedUpdate,
  getUpdateStatusRefetchInterval,
  loadUpdateStatus,
  shouldHighlightUpdate,
  skipAvailableUpdate,
  UPDATE_STATUS_QUERY_KEY,
  type UpdateStatus,
} from '@/lib/update-api'
import {
  DEFAULT_UI_PREFERENCES,
  clampInventoryWidth,
  getStoredAutoCenterOnSelect,
  getStoredAvoidCableCollisionsGlobally,
  getStoredDisplayCablesVisible,
  getStoredInventoryVisible,
  getStoredInventoryWidth,
  getStoredNetworkCablesVisible,
  getStoredOpenCreatedConnectionInspector,
  getStoredPowerCablesVisible,
  getStoredSnapCablesToGrid,
  getStoredSnapItemsToGrid,
  resetStoredUiPreferences,
  storeAutoCenterOnSelect,
  storeAvoidCableCollisionsGlobally,
  storeDisplayCablesVisible,
  storeInventoryVisible,
  storeInventoryWidth,
  storeNetworkCablesVisible,
  storeOpenCreatedConnectionInspector,
  storePowerCablesVisible,
  storeSnapCablesToGrid,
  storeSnapItemsToGrid,
} from '@/lib/ui-preferences'
import {
  createEmptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from '@/lib/history'
import {
  getCanvasItemHeight,
  getCanvasItemWidth,
  endpointKey,
  isCanvasItem,
  getReturnCanvasItemImpact,
  returnCanvasItemToInventory,
  upsertPlacements,
} from '@/lib/project'
import { formatCapacity, formatPortSummary } from '@/lib/format'
import { ProjectPersistenceCoordinator } from '@/lib/project-persistence-coordinator'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  InventoryItem,
  InventoryProperties,
  NasPowerConfiguration,
  NasPowerConfigurationImpact,
  ProjectState,
} from '@/types/inventory'

type PortConnectionPreview = {
  from: ConnectionEndpoint
  origin: CanvasPortDragPoint
  pointer: CanvasPortDragPoint
  mode: 'click' | 'drag'
}

const SAVE_DEBOUNCE_MS = 500
const DEMO_EXTENSION_GRACE_SECONDS = 30
const RELEASE_NOTES_STATUS_QUERY_KEY = ['release-notes-status'] as const
const DEMO_SESSION_QUERY_KEY = ['demo-session'] as const

type SaveStatus = 'saved' | 'saving' | 'error'
type ValidationSeverity = 'error' | 'unknown'

function addedConnectionId(patch: ProjectPatch): number | null {
  if (patch.kind === 'add-connection') return patch.payload.connection.id
  if (patch.kind !== 'batch') return null
  for (const childPatch of patch.payload.patches) {
    const connectionId = addedConnectionId(childPatch)
    if (connectionId !== null) return connectionId
  }
  return null
}

type InventoryLifecycleRequest = {
  action: InventoryLifecycleAction
  items: InventoryItem[]
}

type PendingNasPowerChange = {
  nasId: number
  target: NasPowerConfiguration
  impact: NasPowerConfigurationImpact
}

type PendingAssignmentRemoval = {
  assignmentId: string | number
  itemName: string
  connectionCount: number
}

function inventoryRef(item: InventoryItem): InventoryRef {
  return { type: item.type, id: item.id }
}

function aggregateDependencyReports(
  reports: InventoryDependencyReport[],
): InventoryDependencyReport {
  const grouped = new Map<string, InventoryDependencyReason>()

  for (const report of reports) {
    for (const reason of report.reasons) {
      const key = `${reason.kind}:${reason.message}`
      const current = grouped.get(key)
      grouped.set(key, current ? { ...current, count: current.count + reason.count } : { ...reason })
    }
  }

  const reasons = [...grouped.values()]
  return { blocked: reasons.length > 0, reasons }
}

function getServerIdFromOver(overId: string | null): string | null {
  if (!overId?.startsWith('server:')) {
    return null
  }

  return overId.replace('server:', '')
}

function getCanvasDropPoint(
  event: DragEndEvent,
  canvasController: CanvasController | null,
  snapItemsToGrid: boolean,
) {
  const translated = event.active.rect.current.translated

  if (!translated || !canvasController) {
    return { x: 48, y: 48 }
  }

  const flowPoint = canvasController.screenToFlowPosition({
    x: translated.left,
    y: translated.top,
  })

  return {
    x: snapItemsToGrid ? snapToGrid(flowPoint.x) : flowPoint.x,
    y: snapItemsToGrid ? snapToGrid(flowPoint.y) : flowPoint.y,
  }
}

function dragPreviewTone(item: InventoryItem): string {
  if (item.type === 'server') {
    return 'border-[#adc19b] bg-[#20242c] text-[#f8f1e8]'
  }

  if (item.type === 'nas') {
    return 'border-[#9eb6c8] bg-[#20242c] text-[#f8f1e8]'
  }

  if (item.type === 'pcBuild') {
    return 'border-[#78a6b8] bg-[#20242c] text-[#f8f1e8]'
  }

  if (item.type === 'switch') {
    return 'border-[#81a6a0] bg-[#1f3536] text-[#f3fbf9]'
  }

  if (item.type === 'patchPanel') {
    return 'border-[#a995c8] bg-[#322b45] text-[#faf7ff]'
  }

  if (item.type === 'monitor') {
    return 'border-[#7e9ab8] bg-[#354154] text-[#f5f8fb]'
  }

  if (item.type === 'ups') {
    return 'border-[#83a890] bg-[#33473f] text-[#f3faf5]'
  }

  if (item.type === 'powerStrip') {
    return 'border-[#a68ab3] bg-[#453a4d] text-[#faf4fc]'
  }

  if (item.type === 'cpu') {
    return 'border-[#8bb3bd] bg-[#8bb3bd] text-[#132126]'
  }

  if (item.type === 'ram') {
    return 'border-[#ddb668] bg-[#ddb668] text-[#2b2010]'
  }

  if (item.type === 'storage') {
    return 'border-[#b5a58f] bg-[#ded2be] text-[#3d3429]'
  }

  if (item.type === 'gpu') {
    return 'border-[#d57b69] bg-[#d57b69] text-[#2f1813]'
  }

  return 'border-[#86a989] bg-[#86a989] text-[#132117]'
}

function getDragPreviewSubtitle(item: InventoryItem): string {
  if (item.type === 'server') {
    return String(item.specs?.formFactor ?? 'Server')
  }

  if (item.type === 'nas') {
    return `${item.specs?.driveBays ?? '?'} bays / ${item.specs?.m2Slots ?? 0} M.2`
  }

  if (item.type === 'pcBuild') {
    return String(item.specs?.operatingSystem ?? 'Custom PC build')
  }

  if (item.type === 'switch' || item.type === 'patchPanel') {
    return formatPortSummary(item)
  }

  if (item.type === 'monitor') {
    return `${item.specs?.sizeInches ?? '?'} in / ${item.specs?.resolution ?? 'display'}`
  }

  if (item.type === 'ups' || item.type === 'powerStrip') {
    return `${item.specs?.outlets ?? item.ports?.length ?? 0} outlets`
  }

  if (item.type === 'cpu') {
    return `${item.specs?.cores ?? '?'}C/${item.specs?.threads ?? '?'}T`
  }

  if (item.type === 'ram') {
    return `${item.specs?.capacityGb ?? '?'}GB / ${item.specs?.generation ?? 'RAM'}`
  }

  if (item.type === 'storage') {
    return `${formatCapacity(item.specs)} / ${item.specs?.interface ?? 'storage'}`
  }

  if (item.type === 'network') {
    return `${item.specs?.ports ?? item.ports?.length ?? 1} ports / ${item.specs?.speedMbps ?? '?'}Mbps`
  }

  return item.type
}

function InventoryDragPreview({
  item,
  project,
  overCanvas,
  viewportZoom,
}: {
  item: InventoryItem | null
  project: ProjectState
  overCanvas: boolean
  viewportZoom: number
}) {
  if (!item) {
    return null
  }

  const canvasItem = isCanvasItem(item)
  const itemRuntimeKey = runtimeItemKey(item)
  const width = canvasItem ? getCanvasItemWidth(project, itemRuntimeKey) : 220
  const height = canvasItem ? getCanvasItemHeight(project, itemRuntimeKey) : 68
  const presentation = getInventoryDragPreviewPresentation(overCanvas, viewportZoom)

  return (
    <div
      className={`pointer-events-none rounded-lg border-2 p-2 opacity-95 shadow-[0_20px_48px_rgba(32,36,44,0.32)] ${dragPreviewTone(item)}`}
      style={{
        width,
        ...(canvasItem ? { height } : { minHeight: height }),
        transform: presentation.transform,
        transformOrigin: presentation.transformOrigin,
      }}
    >
      <div className="rounded-md bg-black/10 px-3 py-2">
        <div className="truncate text-sm font-black">{item.name}</div>
        <div className="mt-0.5 truncate text-xs opacity-80">{getDragPreviewSubtitle(item)}</div>
      </div>
      {canvasItem ? (
        <div className="mt-2 rounded-md border border-dashed border-current/35 px-3 py-2 text-xs font-bold opacity-75">
          Drop footprint
        </div>
      ) : (
        <div className="mt-2 text-[10px] font-black uppercase tracking-[0.12em] opacity-70">
          Drop on server / NAS
        </div>
      )}
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#e8e2d8] text-[#20242c]">
      <div className="rounded-lg border border-[#d6ccbd] bg-[#fffdf8] px-5 py-4 shadow-sm">
        Loading inventory...
      </div>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#e8e2d8] p-6 text-[#20242c]">
      <div className="max-w-md rounded-lg border border-[#dfb3a5] bg-[#fffdf8] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#a84834]" />
          <div>
            <h1 className="font-bold">Inventory could not load</h1>
            <p className="mt-2 text-sm text-[#75695d]">{message}</p>
            <Button type="button" className="mt-4" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PortConnectionPreviewOverlay({ preview }: { preview: PortConnectionPreview }) {
  const lineRef = useRef<SVGLineElement | null>(null)
  const pointerRef = useRef<SVGCircleElement | null>(null)

  useEffect(() => {
    let animationFrame = 0

    const setPointerPosition = (x: number, y: number) => {
      lineRef.current?.setAttribute('x2', String(x))
      lineRef.current?.setAttribute('y2', String(y))
      pointerRef.current?.setAttribute('cx', String(x))
      pointerRef.current?.setAttribute('cy', String(y))
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }

      animationFrame = window.requestAnimationFrame(() => {
        setPointerPosition(event.clientX, event.clientY)
      })
    }

    window.addEventListener('pointermove', handlePointerMove)

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }

      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [])

  return (
    <svg className="pointer-events-none fixed inset-0 z-30 h-screen w-screen">
      <line
        ref={lineRef}
        x1={preview.origin.x}
        y1={preview.origin.y}
        x2={preview.pointer.x}
        y2={preview.pointer.y}
        stroke="#ddb668"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="10 8"
      />
      <circle
        cx={preview.origin.x}
        cy={preview.origin.y}
        r="5"
        fill="#ddb668"
      />
      <circle
        ref={pointerRef}
        cx={preview.pointer.x}
        cy={preview.pointer.y}
        r="5"
        fill="#fff2c7"
        stroke="#ddb668"
        strokeWidth="3"
      />
    </svg>
  )
}

function App() {
  const queryClient = useQueryClient()
  const domainEngine = useDomainEngine()
  const [project, setProject] = useState<ProjectState | null>(null)
  const topologyQuery = useTopologyQuery(project)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | number | null>(null)
  const [pendingConnectionEndpoint, setPendingConnectionEndpoint] = useState<ConnectionEndpoint | null>(null)
  const compatibleTopologyDestinations = useCompatibleTopologyDestinations(
    project,
    pendingConnectionEndpoint,
  )
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
  const [spotlightItemId, setSpotlightItemId] = useState<string | null>(null)
  const [portConnectionPreview, setPortConnectionPreview] = useState<PortConnectionPreview | null>(null)
  const [activeNetworkTraceEndpoint, setActiveNetworkTraceEndpoint] = useState<ConnectionEndpoint | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [canonicalMutationBusy, setCanonicalMutationBusy] = useState(false)
  const [canvasOperationLabel, setCanvasOperationLabel] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryState<ProjectState>>(() => createEmptyHistory())
  const [inventoryWidth, setInventoryWidth] = useState(getStoredInventoryWidth)
  const [desktopInventoryVisible, setDesktopInventoryVisible] = useState(getStoredInventoryVisible)
  const [mobileInventoryOpen, setMobileInventoryOpen] = useState(false)
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [activeComponentDragData, setActiveComponentDragData] = useState<ComponentDragData | null>(null)
  const [dragOverHostId, setDragOverHostId] = useState<string | null>(null)
  const [dragPreviewOverCanvas, setDragPreviewOverCanvas] = useState(false)
  const [dragPreviewZoom, setDragPreviewZoom] = useState(1)
  const [autoCenterOnSelect, setAutoCenterOnSelect] = useState(getStoredAutoCenterOnSelect)
  const [networkCablesVisible, setNetworkCablesVisible] = useState(getStoredNetworkCablesVisible)
  const [powerCablesVisible, setPowerCablesVisible] = useState(getStoredPowerCablesVisible)
  const [displayCablesVisible, setDisplayCablesVisible] = useState(getStoredDisplayCablesVisible)
  const [openCreatedConnectionInspector, setOpenCreatedConnectionInspector] = useState(
    getStoredOpenCreatedConnectionInspector,
  )
  const [snapCablesToGrid, setSnapCablesToGrid] = useState(getStoredSnapCablesToGrid)
  const [avoidCableCollisionsGlobally, setAvoidCableCollisionsGlobally] = useState(
    getStoredAvoidCableCollisionsGlobally,
  )
  const [snapItemsToGrid, setSnapItemsToGrid] = useState(getStoredSnapItemsToGrid)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [releaseNotesDismissedForSession, setReleaseNotesDismissedForSession] = useState(false)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [demoRemainingSeconds, setDemoRemainingSeconds] = useState<number | null>(null)
  const [demoDialogState, setDemoDialogState] = useState<DemoSessionDialogState>('closed')
  const [demoExtensionSeconds, setDemoExtensionSeconds] = useState(DEMO_EXTENSION_GRACE_SECONDS)
  const [inventoryLifecycleRequest, setInventoryLifecycleRequest] = useState<InventoryLifecycleRequest | null>(null)
  const [inventoryDependencyReport, setInventoryDependencyReport] = useState<InventoryDependencyReport | null>(null)
  const [inventoryLifecycleBusy, setInventoryLifecycleBusy] = useState(false)
  const [inventoryLifecycleError, setInventoryLifecycleError] = useState<string | null>(null)
  const [inventoryLifecycleRevision, setInventoryLifecycleRevision] = useState(0)
  const [returnToInventoryItemId, setReturnToInventoryItemId] = useState<string | null>(null)
  const [returnToInventoryBusy, setReturnToInventoryBusy] = useState(false)
  const [pendingNasPowerChange, setPendingNasPowerChange] = useState<PendingNasPowerChange | null>(null)
  const [pendingAssignmentRemoval, setPendingAssignmentRemoval] = useState<PendingAssignmentRemoval | null>(null)
  const [nasPowerChangeBusy, setNasPowerChangeBusy] = useState(false)
  const [nasPowerChangeError, setNasPowerChangeError] = useState<string | null>(null)
  const canvasControllerRef = useRef<CanvasController | null>(null)
  const projectRef = useRef<ProjectState | null>(null)
  const lastPersistedProjectRef = useRef<ProjectState | null>(null)
  const queuedSaveProjectRef = useRef<{
    generation: number
    project: ProjectState
  } | null>(null)
  const pendingAutosaveProjectRef = useRef<ProjectState | null>(null)
  const saveDrainWaitersRef = useRef<Array<{
    resolve: () => void
    reject: (error: Error) => void
  }>>([])
  const saveInFlightRef = useRef(false)
  const saveGenerationRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)
  const projectNameTimerRef = useRef<number | null>(null)
  const connectionLabelTimerRef = useRef<number | null>(null)
  const hasHydratedProjectRef = useRef(false)
  const applyInventoryCommandSnapshotRef = useRef(applyInventoryCommandSnapshot)
  applyInventoryCommandSnapshotRef.current = applyInventoryCommandSnapshot
  const demoExpirationFinalizedRef = useRef(false)
  const persistenceCoordinatorRef = useRef<ProjectPersistenceCoordinator | null>(null)
  if (!persistenceCoordinatorRef.current) {
    persistenceCoordinatorRef.current = new ProjectPersistenceCoordinator(setCanonicalMutationBusy)
  }
  const resizeStateRef = useRef<{
    startX: number
    startWidth: number
  } | null>(null)
  const projectQuery = useQuery({
    queryKey: ['project'],
    queryFn: loadProject,
  })
  const agentStatusQuery = useQuery({
    queryKey: ['agent-status'],
    queryFn: loadAgentStatus,
    refetchInterval: 30_000,
  })
  const demoSessionQuery = useQuery({
    queryKey: DEMO_SESSION_QUERY_KEY,
    queryFn: loadDemoSession,
    refetchInterval: (query) => (query.state.data?.mode === 'demo' ? 60_000 : false),
  })
  const releaseNotesQuery = useQuery({
    queryKey: RELEASE_NOTES_STATUS_QUERY_KEY,
    queryFn: loadReleaseNotesStatus,
  })
  const updateStatusQuery = useQuery({
    queryKey: UPDATE_STATUS_QUERY_KEY,
    queryFn: loadUpdateStatus,
    staleTime: 6 * 60 * 60 * 1000,
    refetchInterval: (query) => getUpdateStatusRefetchInterval(query.state.data),
    retry: false,
  })
  const { mutateAsync: persistProject } = useMutation({
    mutationFn: saveProject,
  })
  const waitForQueuedProjectSaves = useCallback(() => {
    if (!saveInFlightRef.current && !queuedSaveProjectRef.current) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      saveDrainWaitersRef.current.push({ resolve, reject })
    })
  }, [])
  const processQueuedProjectSaves = useCallback(() => {
    if (saveInFlightRef.current) {
      return
    }

    saveInFlightRef.current = true

    void (async () => {
      let drainError: Error | null = null
      try {
        while (queuedSaveProjectRef.current) {
          const queuedSave = queuedSaveProjectRef.current
          queuedSaveProjectRef.current = null

          try {
            const savedProject = await persistProject(queuedSave.project)

            if (queuedSave.generation !== saveGenerationRef.current) {
              continue
            }

            lastPersistedProjectRef.current = savedProject

            if (
              !queuedSaveProjectRef.current &&
              projectRef.current === queuedSave.project
            ) {
              projectRef.current = savedProject
              queryClient.setQueryData(['project'], savedProject)
              setProject(savedProject)
              setPersistenceWarning(null)
              setSaveStatus('saved')
            }
          } catch (error) {
            if (
              queuedSave.generation !== saveGenerationRef.current ||
              queuedSaveProjectRef.current ||
              projectRef.current !== queuedSave.project
            ) {
              continue
            }

            const lastPersistedProject = lastPersistedProjectRef.current

            if (lastPersistedProject) {
              projectRef.current = lastPersistedProject
              setProject(lastPersistedProject)
            }

            setSaveStatus('error')
            setPersistenceWarning(
              error instanceof Error ? error.message : 'Project could not be saved to the JSON database.',
            )
            drainError = error instanceof Error
              ? error
              : new Error('Project could not be saved to the JSON database.')
          }
        }
      } finally {
        saveInFlightRef.current = false
        const waiters = saveDrainWaitersRef.current.splice(0)
        for (const waiter of waiters) {
          if (drainError) waiter.reject(drainError)
          else waiter.resolve()
        }
      }
    })()
  }, [persistProject, queryClient])
  const enqueueProjectSave = useCallback((projectToSave: ProjectState) => {
    queuedSaveProjectRef.current = {
      generation: saveGenerationRef.current,
      project: projectToSave,
    }
    processQueuedProjectSaves()
    return waitForQueuedProjectSaves()
  }, [processQueuedProjectSaves, waitForQueuedProjectSaves])
  const acknowledgeReleaseNotesMutation = useMutation({
    mutationFn: acknowledgeReleaseNotes,
    onSuccess: (status) => {
      queryClient.setQueryData<ReleaseNotesStatus>(RELEASE_NOTES_STATUS_QUERY_KEY, status)
      setReleaseNotesDismissedForSession(true)
    },
  })
  const checkForUpdatesMutation = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (status) => {
      queryClient.setQueryData<UpdateStatus>(UPDATE_STATUS_QUERY_KEY, status)
    },
  })
  const skipUpdateMutation = useMutation({
    mutationFn: skipAvailableUpdate,
    onSuccess: (status) => {
      queryClient.setQueryData<UpdateStatus>(UPDATE_STATUS_QUERY_KEY, status)
      setUpdateDialogOpen(false)
    },
  })
  const clearSkippedUpdateMutation = useMutation({
    mutationFn: clearSkippedUpdate,
    onSuccess: (status) => {
      queryClient.setQueryData<UpdateStatus>(UPDATE_STATUS_QUERY_KEY, status)
    },
  })
  const extendDemoSessionMutation = useMutation({
    mutationFn: extendDemoSession,
    onSuccess: (status) => {
      demoExpirationFinalizedRef.current = false
      queryClient.setQueryData<DemoSessionStatus>(DEMO_SESSION_QUERY_KEY, status)
      setDemoDialogState('closed')
      setDemoExtensionSeconds(DEMO_EXTENSION_GRACE_SECONDS)
    },
  })
  const expireDemoSessionMutation = useMutation({
    mutationFn: expireDemoSession,
    onSettled: () => {
      queryClient.clear()
      setDemoRemainingSeconds(0)
      setDemoExtensionSeconds(0)
      setDemoDialogState('expired')
    },
  })
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 350,
        tolerance: 8,
      },
    }),
  )

  useEffect(() => {
    if (!projectQuery.data || hasHydratedProjectRef.current) {
      return
    }

    const loadedProject = projectQuery.data

    hasHydratedProjectRef.current = true
    projectRef.current = loadedProject
    lastPersistedProjectRef.current = loadedProject
    setProject(loadedProject)
    setHistory(createEmptyHistory())
    setSelectedItemId((current) => (current && loadedProject.items[current] ? current : null))
    setSelectedConnectionId((current) =>
      current && loadedProject.connections.some((connection) => connection.id === current)
        ? current
        : null,
    )
    setPendingConnectionEndpoint(null)
    setActiveNetworkTraceEndpoint(null)
    setPersistenceWarning(null)
    setSaveStatus('saved')
  }, [projectQuery.data])

  useEffect(() => {
    projectRef.current = project
  }, [project])

  const geometryProjectRef = useRef(project)
  if (
    geometryProjectRef.current?.items !== project?.items
    || geometryProjectRef.current?.assignments !== project?.assignments
    || geometryProjectRef.current?.placements !== project?.placements
  ) {
    geometryProjectRef.current = project
  }
  const geometryProject = geometryProjectRef.current
  const projectGeometrySnapshot = useMemo(
    () => (geometryProject ? createProjectGeometrySnapshot(geometryProject) : null),
    [geometryProject],
  )
  const projectGeometrySnapshotRef = useRef(projectGeometrySnapshot)
  projectGeometrySnapshotRef.current = projectGeometrySnapshot

  useEffect(() => {
    const snapshot = projectGeometrySnapshotRef.current
    if (!snapshot || domainEngine.state.phase !== 'ready') return
    void syncProjectGeometry(domainEngine.client, snapshot).catch((error) => {
      setPersistenceWarning(
        error instanceof Error ? error.message : 'Canvas geometry synchronization failed.',
      )
    })
  }, [domainEngine.client, domainEngine.state.phase, projectGeometrySnapshot?.fingerprint])

  useEffect(() => {
    const event = domainEngine.syncEvent
    if (!domainEngine.enabled || !event || !hasHydratedProjectRef.current) return

    if (event.kind === 'patch') {
      if (!event.external || !projectRef.current) return
      const nextProject = applyEngineResponsePatch(projectRef.current, event.response)
      projectRef.current = nextProject
      lastPersistedProjectRef.current = nextProject
      setProject(nextProject)
      setHistory(createEmptyHistory())
      setPersistenceWarning(null)
      setSaveStatus('saved')
      return
    }

    void loadProject()
      .then(async (canonicalProject) => {
        const activeProject = projectRef.current
        const canonicalRevision = canonicalProject.revision
        const activeRevision = activeProject?.revision
        if (
          typeof canonicalRevision === 'number'
          && typeof activeRevision === 'number'
          && canonicalRevision < activeRevision
        ) return
        queryClient.setQueryData(['project'], canonicalProject)
        await applyInventoryCommandSnapshotRef.current(canonicalProject)
      })
      .catch((error) => {
        setPersistenceWarning(
          error instanceof Error ? error.message : 'Canonical project reload failed.',
        )
      })
  }, [domainEngine.enabled, domainEngine.syncEvent, queryClient])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    if (projectNameTimerRef.current !== null) {
      window.clearTimeout(projectNameTimerRef.current)
    }
    if (connectionLabelTimerRef.current !== null) {
      window.clearTimeout(connectionLabelTimerRef.current)
    }
  }, [])

  useEffect(() => {
    storeAutoCenterOnSelect(autoCenterOnSelect)
  }, [autoCenterOnSelect])

  useEffect(() => {
    storeNetworkCablesVisible(networkCablesVisible)
  }, [networkCablesVisible])

  useEffect(() => {
    storePowerCablesVisible(powerCablesVisible)
  }, [powerCablesVisible])

  useEffect(() => {
    storeDisplayCablesVisible(displayCablesVisible)
  }, [displayCablesVisible])

  useEffect(() => {
    storeOpenCreatedConnectionInspector(openCreatedConnectionInspector)
  }, [openCreatedConnectionInspector])

  useEffect(() => {
    storeSnapCablesToGrid(snapCablesToGrid)
  }, [snapCablesToGrid])

  useEffect(() => {
    storeAvoidCableCollisionsGlobally(avoidCableCollisionsGlobally)
  }, [avoidCableCollisionsGlobally])

  useEffect(() => {
    storeSnapItemsToGrid(snapItemsToGrid)
  }, [snapItemsToGrid])

  useEffect(() => {
    storeInventoryVisible(desktopInventoryVisible)
  }, [desktopInventoryVisible])

  useEffect(() => {
    storeInventoryWidth(inventoryWidth)
  }, [inventoryWidth])

  useEffect(() => {
    const status = demoSessionQuery.data

    if (!status || status.mode !== 'demo') {
      setDemoRemainingSeconds(null)
      return
    }

    const expiresAt = new Date(status.expiresAt).getTime()

    function updateDemoCountdown() {
      setDemoRemainingSeconds(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)))
    }

    updateDemoCountdown()
    const countdownTimer = window.setInterval(updateDemoCountdown, 1000)

    return () => {
      window.clearInterval(countdownTimer)
    }
  }, [demoSessionQuery.data])

  useEffect(() => {
    const status = demoSessionQuery.data

    if (
      status?.mode !== 'demo' ||
      demoRemainingSeconds !== 0 ||
      demoDialogState !== 'closed' ||
      demoExpirationFinalizedRef.current ||
      new Date(status.expiresAt).getTime() > Date.now()
    ) {
      return
    }

    setDemoExtensionSeconds(DEMO_EXTENSION_GRACE_SECONDS)
    setDemoDialogState('extend')
  }, [demoDialogState, demoRemainingSeconds, demoSessionQuery.data])

  const finalizeDemoExpiration = useCallback(() => {
    if (demoExpirationFinalizedRef.current) {
      return
    }

    demoExpirationFinalizedRef.current = true
    expireDemoSessionMutation.mutate()
  }, [expireDemoSessionMutation])

  useEffect(() => {
    if (demoDialogState !== 'extend' || demoExpirationFinalizedRef.current) {
      return
    }

    if (demoExtensionSeconds <= 0) {
      finalizeDemoExpiration()
      return
    }

    const graceTimer = window.setTimeout(() => {
      setDemoExtensionSeconds((current) => Math.max(0, current - 1))
    }, 1000)

    return () => {
      window.clearTimeout(graceTimer)
    }
  }, [demoDialogState, demoExtensionSeconds, finalizeDemoExpiration])

  useEffect(() => {
    if (!spotlightItemId) {
      return
    }

    const spotlightTimer = window.setTimeout(() => {
      setSpotlightItemId(null)
    }, 1500)

    return () => {
      window.clearTimeout(spotlightTimer)
    }
  }, [spotlightItemId])

  useEffect(() => {
    if (!portConnectionPreview) {
      return
    }

    const handlePointerUp = () => {
      setPortConnectionPreview((current) => {
        if (current?.mode === 'drag') {
          setPendingConnectionEndpoint(null)
          return null
        }

        return current
      })
    }

    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [portConnectionPreview])

  const selectedItem = useMemo(
    () => (project && selectedItemId ? project.items[selectedItemId] ?? null : null),
    [project, selectedItemId],
  )
  const selectedConnection = useMemo(
    () =>
      project && selectedConnectionId
        ? project.connections.find((connection) => String(connection.id) === String(selectedConnectionId)) ?? null
        : null,
    [project, selectedConnectionId],
  )
  const activeNetworkTrace = useMemo(
    () => (activeNetworkTraceEndpoint
      ? topologyQuery.data?.networkTraceByEndpointKey.get(endpointKey(activeNetworkTraceEndpoint)) ?? null
      : null),
    [activeNetworkTraceEndpoint, topologyQuery.data],
  )
  const activeNetworkTraceConnectionIds = useMemo(
    () => activeNetworkTrace
      ? [...new Set(activeNetworkTrace.steps.flatMap((step) =>
          step.connectionId === undefined ? [] : [step.connectionId],
        ))]
      : [],
    [activeNetworkTrace],
  )
  const activeNetworkTraceItemIds = useMemo(
    () => activeNetworkTrace
      ? [...new Set(activeNetworkTrace.steps.map((step) => step.endpoint.itemId))]
      : [],
    [activeNetworkTrace],
  )
  const dropCompatibilityByHostId = useMemo(() => {
    if (!project || !activeComponentDragData || !dragOverHostId) return {}

    const status = getComponentDropCompatibilityStatus(
      project,
      activeComponentDragData,
      dragOverHostId,
    )

    return status ? { [dragOverHostId]: status } : {}
  }, [activeComponentDragData, dragOverHostId, project])
  const shouldShowWhatsNewDialog =
    !releaseNotesDismissedForSession &&
    releaseNotesQuery.data?.hasUnseen === true &&
    releaseNotesQuery.data.entries.length > 0
  const isDemoMode = demoSessionQuery.data?.mode === 'demo'
  const returnToInventoryItem = returnToInventoryItemId
    ? project?.items[returnToInventoryItemId] ?? null
    : null
  const returnToInventoryImpact = project && returnToInventoryItemId
    ? getReturnCanvasItemImpact(project, returnToInventoryItemId)
    : null

  function updateProject(nextProject: ProjectState, options: { recordHistory?: boolean } = {}) {
    const shouldRecordHistory = options.recordHistory ?? true
    const currentProject = projectRef.current

    if (shouldRecordHistory && currentProject) {
      setHistory((currentHistory) => pushHistory(currentHistory, currentProject))
    }

    projectRef.current = nextProject
    setProject(nextProject)

    if (nextProject !== currentProject) {
      scheduleLegacyProjectSave(nextProject)
    }
  }

  function scheduleLegacyProjectSave(projectToSave: ProjectState) {
    pendingAutosaveProjectRef.current = projectToSave
    setSaveStatus('saving')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persistenceCoordinatorRef.current!
        .run(settleLegacyProjectPersistence, async () => {})
        .catch(() => {})
    }, SAVE_DEBOUNCE_MS)
  }

  async function validateCanvasPlacement(
    candidateProject: ProjectState,
    placement: ProjectState['placements'][number],
  ) {
    try {
      return await checkProjectPlacement(domainEngine.client, candidateProject, placement)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Canvas placement validation failed.')
      return null
    }
  }

  async function validateCanvasGroupMove(
    candidateProject: ProjectState,
    placements: ProjectState['placements'],
  ) {
    try {
      return await checkProjectGroupMove(domainEngine.client, candidateProject, placements)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Canvas placement validation failed.')
      return null
    }
  }

  function updateProjectName(name: string) {
    const currentProject = projectRef.current
    if (!currentProject) return
    if (!domainEngine.enabled) {
      updateProject({
        ...currentProject,
        metadata: { ...currentProject.metadata, name },
      }, { recordHistory: false })
      return
    }

    const optimisticProject = {
      ...currentProject,
      metadata: { ...currentProject.metadata, name },
    }
    projectRef.current = optimisticProject
    setProject(optimisticProject)
    setSaveStatus('saving')
    setPersistenceWarning(null)

    if (projectNameTimerRef.current !== null) {
      window.clearTimeout(projectNameTimerRef.current)
    }
    projectNameTimerRef.current = window.setTimeout(() => {
      projectNameTimerRef.current = null
      void commitEngineMutation(
        () => domainEngine.client.mutate({
          operation: { kind: 'update-project-metadata', payload: { name } },
        }),
        {
          optimisticProject: (canonicalProject) => ({
            ...canonicalProject,
            metadata: { ...canonicalProject.metadata, name },
          }),
        },
      ).catch((error) => {
        const persistedProject = lastPersistedProjectRef.current
        if (persistedProject) {
          projectRef.current = persistedProject
          setProject(persistedProject)
        }
        setSaveStatus('error')
        setPersistenceWarning(
          error instanceof Error ? error.message : 'Project name could not be saved.',
        )
      })
    }, SAVE_DEBOUNCE_MS)
  }

  function setValidationMessage(
    message: string | null,
    severity: ValidationSeverity = 'error',
  ) {
    setValidationMessageValue(message)
    setValidationSeverity(message ? severity : 'error')
  }

  async function applyInventoryCommandSnapshot(
    nextProject: ProjectState,
    options: { historySnapshot?: ProjectState } = {},
  ) {
    let synchronizedProject = nextProject
    const expectedRevision = nextProject.revision

    if (
      domainEngine.enabled
      && typeof expectedRevision === 'number'
      && Number.isSafeInteger(expectedRevision)
    ) {
      const synchronizedRevision = await domainEngine.client.synchronizeCanonicalRevision(
        expectedRevision,
        'Synchronizing inventory changes.',
      )

      if (synchronizedRevision !== expectedRevision) {
        synchronizedProject = await loadProject()
        const latestRevision = synchronizedProject.revision
        if (typeof latestRevision === 'number' && latestRevision !== synchronizedRevision) {
          await domainEngine.client.synchronizeCanonicalRevision(
            latestRevision,
            'Synchronizing concurrent inventory changes.',
          )
        }
      }
    }

    saveGenerationRef.current += 1
    queuedSaveProjectRef.current = null
    pendingAutosaveProjectRef.current = null

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    projectRef.current = synchronizedProject
    lastPersistedProjectRef.current = synchronizedProject
    queryClient.setQueryData(['project'], synchronizedProject)
    setProject(synchronizedProject)
    setHistory((currentHistory) => (
      options.historySnapshot
        ? pushHistory(currentHistory, options.historySnapshot)
        : createEmptyHistory()
    ))
    setSelectedConnectionId(null)
    setActiveNetworkTraceEndpoint(null)
    setValidationMessage(null)
    setPersistenceWarning(null)
    setSaveStatus('saved')
    return synchronizedProject
  }

  function showMessage(message: string) {
    setValidationMessage(message)
  }

  function showCompatibilityUnknownMessage(
    action: 'Assigned' | 'Moved',
    itemName: string,
    unknownFindings: { message: string }[],
  ) {
    const unknownMessage = unknownFindings[0]?.message
    setValidationMessage(
      unknownMessage
        ? `${action} ${itemName}. Compatibility could not be fully verified: ${unknownMessage}`
        : null,
      'unknown',
    )
  }

  function handleWhatsNewOpenChange(open: boolean) {
    if (!open) {
      setReleaseNotesDismissedForSession(true)
    }
  }

  function applyCreatedConnectionSelection(connectionId: string | number) {
    const currentSelection = {
      selectedItemId,
      selectedConnectionId,
      activeNetworkTraceEndpoint,
    }
    const nextSelection = resolveCreatedConnectionSelection(
      currentSelection,
      connectionId,
      openCreatedConnectionInspector,
    )

    if (nextSelection === currentSelection) {
      return
    }

    setSelectedItemId(nextSelection.selectedItemId)
    setSelectedConnectionId(nextSelection.selectedConnectionId)
    setActiveNetworkTraceEndpoint(nextSelection.activeNetworkTraceEndpoint)
  }

  async function settleLegacyProjectPersistence() {
    const hadPendingPersistence = Boolean(
      pendingAutosaveProjectRef.current
      || queuedSaveProjectRef.current
      || saveInFlightRef.current,
    )

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    const pendingProject = pendingAutosaveProjectRef.current
    pendingAutosaveProjectRef.current = null
    if (pendingProject) await enqueueProjectSave(pendingProject)
    else await waitForQueuedProjectSaves()

    if (!hadPendingPersistence || !domainEngine.enabled) return
    const canonicalProject = lastPersistedProjectRef.current
    if (
      canonicalProject
      && (
        domainEngine.client.status().phase !== 'ready'
        || domainEngine.client.status().revision !== canonicalProject.revision
      )
    ) {
      await domainEngine.client.rebuild('Synchronizing saved project changes.')
    }
  }

  async function commitEngineMutation(
    createMutation: (canonicalProject: ProjectState) => Promise<EngineResponse>,
    options: {
      recordHistory?: boolean
      optimisticProject?: (canonicalProject: ProjectState) => ProjectState
      acknowledgeOptimistic?: (
        canonicalProject: ProjectState,
        optimisticProject: ProjectState,
        response: EngineResponse,
      ) => ProjectState
    } = {},
  ): Promise<EngineResponse> {
    if (!domainEngine.enabled) {
      throw new Error('The WebAssembly workspace engine is not available.')
    }

    return persistenceCoordinatorRef.current!.run(settleLegacyProjectPersistence, async () => {
      const canonicalProject = projectRef.current
      if (!canonicalProject) throw new Error('The canonical project is unavailable.')
      const historySnapshot = options.recordHistory ? canonicalProject : null
      const optimisticProject = options.optimisticProject?.(canonicalProject)
      if (optimisticProject) {
        projectRef.current = optimisticProject
        setProject(optimisticProject)
      }

      setSaveStatus('saving')
      setPersistenceWarning(null)
      const response = await createMutation(canonicalProject)
      const activeProject = projectRef.current
      if (!activeProject || response.result.kind !== 'patch') {
        throw new Error(
          response.result.kind === 'error'
            ? response.result.payload.message
            : 'The workspace change was not committed.',
        )
      }

      const committedProject = optimisticProject && options.acknowledgeOptimistic
        ? options.acknowledgeOptimistic(canonicalProject, optimisticProject, response)
        : applyEngineResponsePatch(activeProject, response)
      projectRef.current = committedProject
      lastPersistedProjectRef.current = committedProject
      queryClient.setQueryData(['project'], committedProject)
      setProject(committedProject)
      if (historySnapshot) {
        setHistory((currentHistory) => pushHistory(currentHistory, historySnapshot))
      }
      setSaveStatus('saved')
      setPersistenceWarning(null)
      return response
    })
  }

  async function commitAssignmentUpdate(
    previousProject: ProjectState,
    nextProject: ProjectState,
    fallbackMessage = 'The component assignment could not be saved.',
    options: { recordHistory?: boolean } = {},
  ): Promise<boolean> {
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return false
    }

    try {
      await commitEngineMutation(
        (canonicalProject) => {
          const transitionedProject = applyAssignmentTransition(
            canonicalProject,
            previousProject,
            nextProject,
          )
          return updateProjectAssignments(
            domainEngine.client,
            canonicalProject,
            transitionedProject,
          ).then((response) => {
            if (!response) throw new Error('Component assignments did not change.')
            return response
          })
        },
        {
          recordHistory: options.recordHistory ?? true,
          optimisticProject: (canonicalProject) => applyAssignmentTransition(
            canonicalProject,
            previousProject,
            nextProject,
          ),
          acknowledgeOptimistic: acknowledgeOptimisticAssignments,
        },
      )
      setValidationMessage(null)
      return true
    } catch (error) {
      recoverConnectionMutation(error, fallbackMessage)
      return false
    }
  }

  function createConnectionBetween(from: ConnectionEndpoint, to: ConnectionEndpoint) {
    const currentProject = projectRef.current

    if (!currentProject) {
      return
    }
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    void commitEngineMutation(
      (canonicalProject) => createTopologyConnection(domainEngine.client, canonicalProject, from, to),
      { recordHistory: true },
    ).then((response) => {
      if (response.result.kind !== 'patch') {
        throw new Error('The connection change returned an unexpected patch.')
      }
      const connectionId = addedConnectionId(response.result.payload.forward)
      if (connectionId === null) {
        throw new Error('The connection change did not include the created connection.')
      }
      applyCreatedConnectionSelection(connectionId)
      setPendingConnectionEndpoint(null)
      setPortConnectionPreview(null)
      setValidationMessage(null)
    }).catch((error) => {
      setSaveStatus('error')
      setValidationMessage(error instanceof Error ? error.message : 'The connection could not be created.')
    })
  }

  function recoverConnectionMutation(error: unknown, fallbackMessage: string) {
    setSaveStatus('error')
    setValidationMessage(error instanceof Error ? error.message : fallbackMessage)
    void loadProject().then(async (canonicalProject) => {
      queryClient.setQueryData(['project'], canonicalProject)
      await applyInventoryCommandSnapshot(canonicalProject)
    }).catch((reloadError) => {
      setPersistenceWarning(
        reloadError instanceof Error
          ? reloadError.message
          : 'The canonical project could not be reloaded.',
      )
    })
  }

  async function commitPlacementUpdates(
    placements: ProjectState['placements'],
    fallbackMessage = 'Canvas positions could not be saved.',
  ): Promise<boolean> {
    const currentProject = projectRef.current
    if (!currentProject || !domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return false
    }

    const currentPlacements = new Map(
      currentProject.placements.map((placement) => [placement.serverId, placement]),
    )
    const changedPlacements = placements.filter((placement) => {
      const current = currentPlacements.get(placement.serverId)
      return !current || current.x !== placement.x || current.y !== placement.y
    })
    if (changedPlacements.length === 0) return true

    try {
      await commitEngineMutation(
        (canonicalProject) => updateProjectPlacements(
          domainEngine.client,
          canonicalProject,
          changedPlacements,
        ).then((response) => {
          if (!response) throw new Error('Canvas positions did not change.')
          return response
        }),
        {
          recordHistory: true,
          optimisticProject: (canonicalProject) => upsertPlacements(
            canonicalProject,
            changedPlacements,
          ),
        },
      )
      setValidationMessage(null)
      return true
    } catch (error) {
      recoverConnectionMutation(error, fallbackMessage)
      return false
    }
  }

  function updateConnectionRouteInEngine(
    connectionId: string | number,
    route: ConnectionRoutePreferences,
  ) {
    const currentProject = projectRef.current
    const numericConnectionId = Number(connectionId)
    if (!currentProject || !Number.isSafeInteger(numericConnectionId) || numericConnectionId <= 0) {
      setValidationMessage('The selected connection is no longer valid.')
      return
    }
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    void commitEngineMutation(
      () => updateTopologyConnectionRoute(domainEngine.client, numericConnectionId, route),
      {
        recordHistory: true,
        optimisticProject: (canonicalProject) => ({
          ...canonicalProject,
          connections: canonicalProject.connections.map((connection) =>
            connection.id === numericConnectionId ? { ...connection, route } : connection,
          ),
        }),
      },
    ).then(() => {
      setValidationMessage(null)
    }).catch((error) => {
      recoverConnectionMutation(error, 'The cable route could not be updated.')
    })
  }

  function updateConnectionLabelInEngine(connectionId: string | number, label: string) {
    const currentProject = projectRef.current
    const numericConnectionId = Number(connectionId)
    if (!currentProject || !Number.isSafeInteger(numericConnectionId) || numericConnectionId <= 0) {
      return
    }
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    const optimisticProject: ProjectState = {
      ...currentProject,
      connections: currentProject.connections.map((connection) =>
        connection.id === numericConnectionId ? { ...connection, label } : connection,
      ),
    }
    projectRef.current = optimisticProject
    setProject(optimisticProject)
    setSaveStatus('saving')
    if (connectionLabelTimerRef.current !== null) {
      window.clearTimeout(connectionLabelTimerRef.current)
    }
    connectionLabelTimerRef.current = window.setTimeout(() => {
      connectionLabelTimerRef.current = null
      void commitEngineMutation(
        () => updateTopologyConnectionLabel(domainEngine.client, numericConnectionId, label),
        {
          optimisticProject: (canonicalProject) => ({
            ...canonicalProject,
            connections: canonicalProject.connections.map((connection) =>
              connection.id === numericConnectionId ? { ...connection, label } : connection,
            ),
          }),
        },
      ).then(() => {
        setValidationMessage(null)
      }).catch((error) => {
        recoverConnectionMutation(error, 'The cable label could not be updated.')
      })
    }, SAVE_DEBOUNCE_MS)
  }

  function removeConnectionInEngine(connectionId: string | number) {
    const currentProject = projectRef.current
    const numericConnectionId = Number(connectionId)
    if (!currentProject || !Number.isSafeInteger(numericConnectionId) || numericConnectionId <= 0) {
      setValidationMessage('The selected connection is no longer valid.')
      return
    }
    if (!domainEngine.enabled) {
      setValidationMessage('The WebAssembly workspace engine is not available.')
      return
    }

    if (connectionLabelTimerRef.current !== null) {
      window.clearTimeout(connectionLabelTimerRef.current)
      connectionLabelTimerRef.current = null
    }
    void commitEngineMutation(
      () => removeTopologyConnection(domainEngine.client, numericConnectionId),
      { recordHistory: true },
    ).then(() => {
      if (Number(selectedConnectionId) === numericConnectionId) {
        setSelectedConnectionId(null)
      }
      setValidationMessage(null)
    }).catch((error) => {
      recoverConnectionMutation(error, 'The connection could not be removed.')
    })
  }

  function handleCanvasEndpointClick(endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) {
    void point

    if (pendingConnectionEndpoint && endpointKey(pendingConnectionEndpoint) === endpointKey(endpoint)) {
      setPendingConnectionEndpoint(null)
      setPortConnectionPreview(null)
      setValidationMessage(null)
      return
    }

    setPendingConnectionEndpoint(endpoint)
    setPortConnectionPreview(null)
    setSelectedConnectionId(null)
    setValidationMessage(null)
  }

  function handleCanvasEndpointDragStart(endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) {
    setPendingConnectionEndpoint(endpoint)
    setPortConnectionPreview({
      from: endpoint,
      origin: point,
      pointer: point,
      mode: 'drag',
    })
    setSelectedConnectionId(null)
    setValidationMessage(null)
  }

  function handleCanvasEndpointDrop(endpoint: ConnectionEndpoint) {
    const sourceEndpoint = portConnectionPreview?.from ?? pendingConnectionEndpoint

    if (!sourceEndpoint) {
      return
    }

    createConnectionBetween(sourceEndpoint, endpoint)
  }

  function getCanvasFocusItemId(itemId: string): string {
    const currentProject = projectRef.current

    if (!currentProject) {
      return itemId
    }

    if (currentProject.placements.some((placement) => placement.serverId === itemId)) {
      return itemId
    }

    return currentProject.assignments.find((assignment) => assignment.itemId === itemId)?.serverId ?? itemId
  }

  function focusCanvasItem(itemId: string, options: CanvasFocusOptions = {}) {
    const focusItemId = getCanvasFocusItemId(itemId)

    if (autoCenterOnSelect) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          canvasControllerRef.current?.focusItem(focusItemId, options)
        })
      })
    }
    setSpotlightItemId(focusItemId)
  }

  function handleEndpointConnectionClick(endpoint: ConnectionEndpoint) {
    if (!project) {
      return
    }

    if (!pendingConnectionEndpoint) {
      setPendingConnectionEndpoint(endpoint)
      setSelectedConnectionId(null)
      setValidationMessage(null)
      return
    }

    if (endpointKey(pendingConnectionEndpoint) === endpointKey(endpoint)) {
      setPendingConnectionEndpoint(null)
      setValidationMessage(null)
      return
    }

    createConnectionBetween(pendingConnectionEndpoint, endpoint)
  }

  function handleInventorySelect(itemId: string) {
    setSelectedItemId(itemId)
    setSelectedConnectionId(null)
    setActiveNetworkTraceEndpoint(null)
    setMobileInventoryOpen(false)
  }

  function requestReturnToInventory(runtimeItemId: string) {
    const currentProject = projectRef.current

    if (!currentProject || !getReturnCanvasItemImpact(currentProject, runtimeItemId)) {
      setValidationMessage('This item is no longer placed on the canvas.')
      return
    }

    setReturnToInventoryItemId(runtimeItemId)
  }

  function confirmReturnToInventory() {
    const currentProject = projectRef.current
    const runtimeItemId = returnToInventoryItemId

    if (!currentProject || !runtimeItemId) {
      return
    }

    setReturnToInventoryBusy(true)
    const result = returnCanvasItemToInventory(currentProject, runtimeItemId)

    if (!result.ok) {
      setReturnToInventoryBusy(false)
      setReturnToInventoryItemId(null)
      setValidationMessage(result.message)
      return
    }

    updateProject(result.project)
    setSelectedItemId(null)
    setSelectedConnectionId(null)
    setPendingConnectionEndpoint(null)
    setPortConnectionPreview(null)
    setActiveNetworkTraceEndpoint(null)
    setValidationMessage(null)
    setReturnToInventoryItemId(null)
    setReturnToInventoryBusy(false)
  }

  async function removeAssignedComponent(assignmentId: string | number) {
    const currentProject = projectRef.current
    if (!currentProject) return

    const result = tryRemoveAssignedComponent(currentProject, assignmentId)
    if (!result.ok) {
      showMessage(result.message)
      return
    }

    const removedConnectionIds = new Set(
      currentProject.connections
        .filter((connection) => !result.project.connections.some((candidate) => candidate.id === connection.id))
        .map((connection) => connection.id),
    )
    if (removedConnectionIds.size > 0) {
      try {
        for (const connectionId of removedConnectionIds) {
          await commitEngineMutation(
            () => removeTopologyConnection(domainEngine.client, connectionId),
          )
        }
      } catch (error) {
        recoverConnectionMutation(error, 'The component connections could not be removed.')
        return
      }

      const disconnectedProject = projectRef.current
      if (!disconnectedProject) return
      const disconnectedResult = tryRemoveAssignedComponent(disconnectedProject, assignmentId)
      if (!disconnectedResult.ok) {
        showMessage(disconnectedResult.message)
        return
      }
      if (!await commitAssignmentUpdate(
        disconnectedProject,
        disconnectedResult.project,
        'The component could not be removed.',
        { recordHistory: false },
      )) return
      setHistory((currentHistory) => pushHistory(currentHistory, currentProject))
    } else if (!await commitAssignmentUpdate(
      currentProject,
      result.project,
      'The component could not be removed.',
    )) {
      return
    }
    setPendingAssignmentRemoval(null)
  }

  function requestAssignedComponentRemoval(assignmentId: string | number) {
    const currentProject = projectRef.current
    if (!currentProject) return

    const assignment = findAssignmentById(currentProject.assignments, assignmentId)
    if (!assignment) {
      showMessage('That assigned component is no longer attached.')
      return
    }

    const connectionIds = getAssignedComponentConnectionIds(currentProject, assignmentId)
    if (connectionIds.length === 0) {
      void removeAssignedComponent(assignmentId)
      return
    }

    setPendingAssignmentRemoval({
      assignmentId,
      itemName: currentProject.items[assignment.itemId]?.name ?? 'component',
      connectionCount: connectionIds.length,
    })
  }

  async function handleCreateInventoryItem(item: InventoryItemInput, quantity: number) {
    const currentProject = projectRef.current
    const nextProject = await createInventoryItems(item, quantity)
    const previousItemIds = new Set(Object.keys(currentProject?.items ?? {}))
    const createdItemId = Object.keys(nextProject.items).find((itemId) => !previousItemIds.has(itemId))

    await applyInventoryCommandSnapshot(nextProject)

    if (createdItemId) {
      setSelectedItemId(createdItemId)
    }
  }

  async function handleUpdateInventoryItem(itemId: string, input: InventoryItemInput) {
    const currentProject = projectRef.current
    const currentItem = currentProject?.items[itemId]

    if (!currentItem) {
      throw new Error('Inventory item could not be found.')
    }

    const nextProject = await updateInventoryItem(
      { type: currentItem.type, id: currentItem.id },
      input,
    )
    await applyInventoryCommandSnapshot(nextProject, { historySnapshot: currentProject })
  }

  async function handleUpdateInventoryItemProperties(
    itemId: string,
    properties: InventoryProperties,
  ) {
    const currentProject = projectRef.current
    const currentItem = currentProject?.items[itemId]

    if (!currentItem) {
      throw new Error('Inventory item could not be found.')
    }

    const nextProject = await updateInventoryItemProperties(
      { type: currentItem.type, id: currentItem.id },
      properties,
    )
    await applyInventoryCommandSnapshot(nextProject, { historySnapshot: currentProject })
  }

  async function requestNasPowerConfigurationChange(
    item: InventoryItem,
    target: NasPowerConfiguration,
  ) {
    const currentProject = projectRef.current
    if (!currentProject || item.type !== 'nas') return

    setNasPowerChangeBusy(true)
    setNasPowerChangeError(null)
    try {
      const result = await changeNasPowerConfiguration(item.id, target, false)
      if (result.status === 'confirmation-required') {
        setPendingNasPowerChange({ nasId: item.id, target, impact: result.impact })
        return
      }
      await applyInventoryCommandSnapshot(result.project, { historySnapshot: currentProject })
    } catch (error) {
      setPersistenceWarning(
        error instanceof Error ? error.message : 'NAS power configuration could not be changed.',
      )
    } finally {
      setNasPowerChangeBusy(false)
    }
  }

  async function confirmNasPowerConfigurationChange() {
    const pending = pendingNasPowerChange
    const currentProject = projectRef.current
    if (!pending || !currentProject) return

    setNasPowerChangeBusy(true)
    setNasPowerChangeError(null)
    try {
      const result = await changeNasPowerConfiguration(pending.nasId, pending.target, true)
      if (result.status !== 'applied') {
        setPendingNasPowerChange({ ...pending, impact: result.impact })
        return
      }
      await applyInventoryCommandSnapshot(result.project, { historySnapshot: currentProject })
      setPendingNasPowerChange(null)
    } catch (error) {
      setNasPowerChangeError(
        error instanceof Error ? error.message : 'NAS power configuration could not be changed.',
      )
    } finally {
      setNasPowerChangeBusy(false)
    }
  }

  async function handleDuplicateInventoryItem(item: InventoryItem) {
    setInventoryLifecycleBusy(true)
    setInventoryLifecycleError(null)

    try {
      const currentItemIds = new Set(Object.keys(projectRef.current?.items ?? {}))
      const nextProject = await duplicateInventoryItem(inventoryRef(item))
      const duplicatedItemId = Object.keys(nextProject.items).find((itemId) => !currentItemIds.has(itemId))

      await applyInventoryCommandSnapshot(nextProject)
      setInventoryLifecycleRevision((current) => current + 1)
      if (duplicatedItemId) setSelectedItemId(duplicatedItemId)
    } catch (error) {
      setPersistenceWarning(error instanceof Error ? error.message : 'Inventory item could not be duplicated.')
    } finally {
      setInventoryLifecycleBusy(false)
    }
  }

  async function requestInventoryLifecycle(
    action: InventoryLifecycleAction,
    items: InventoryItem[],
  ) {
    if (items.length === 0) return

    setInventoryLifecycleRequest({ action, items })
    setInventoryDependencyReport(null)
    setInventoryLifecycleError(null)
    setInventoryLifecycleBusy(true)

    try {
      const reports = await loadInventoryDependencyReports(items.map(inventoryRef))
      setInventoryDependencyReport(aggregateDependencyReports(reports))
    } catch (error) {
      setInventoryLifecycleError(
        error instanceof Error ? error.message : 'Inventory dependencies could not be inspected.',
      )
    } finally {
      setInventoryLifecycleBusy(false)
    }
  }

  async function confirmInventoryLifecycle() {
    const request = inventoryLifecycleRequest

    if (!request || !inventoryDependencyReport || inventoryDependencyReport.blocked) return

    setInventoryLifecycleBusy(true)
    setInventoryLifecycleError(null)

    try {
      const refs = request.items.map(inventoryRef)
      const nextProject = request.action === 'archive'
        ? await archiveInventoryItems(refs)
        : await deleteInventoryItems(refs)
      const affectedIds = new Set(request.items.map(runtimeItemKey))

      await applyInventoryCommandSnapshot(nextProject)
      setSelectedItemId((current) => current && affectedIds.has(current) ? null : current)
      setInventoryLifecycleRevision((current) => current + 1)
      setInventoryLifecycleRequest(null)
      setInventoryDependencyReport(null)
    } catch (error) {
      setInventoryLifecycleError(
        error instanceof Error ? error.message : `Inventory items could not be ${request.action}d.`,
      )
    } finally {
      setInventoryLifecycleBusy(false)
    }
  }

  async function handleRestoreInventoryItems(items: InventoryItem[]) {
    if (items.length === 0) return

    setInventoryLifecycleBusy(true)
    setInventoryLifecycleError(null)

    try {
      const nextProject = await restoreInventoryItems(items.map(inventoryRef))
      await applyInventoryCommandSnapshot(nextProject)
      setInventoryLifecycleRevision((current) => current + 1)
    } catch (error) {
      setPersistenceWarning(error instanceof Error ? error.message : 'Inventory items could not be restored.')
    } finally {
      setInventoryLifecycleBusy(false)
    }
  }

  const handleInventoryResize = useCallback((event: PointerEvent) => {
    const resizeState = resizeStateRef.current

    if (!resizeState) {
      return
    }

    const nextWidth = clampInventoryWidth(resizeState.startWidth + event.clientX - resizeState.startX)

    setInventoryWidth(nextWidth)
  }, [])

  const stopInventoryResize = useCallback(() => {
    resizeStateRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('pointermove', handleInventoryResize)
    window.removeEventListener('pointerup', stopInventoryResize)
  }, [handleInventoryResize])

  function startInventoryResize(event: React.PointerEvent<HTMLButtonElement>) {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: inventoryWidth,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handleInventoryResize)
    window.addEventListener('pointerup', stopInventoryResize)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDraggingItemId(null)
    setActiveComponentDragData(null)
    setDragOverHostId(null)
    setDragPreviewOverCanvas(false)
    setDragPreviewZoom(1)

    if (!project) {
      return
    }

    const data = event.active.data.current as ComponentDragData | undefined
    const overId = event.over?.id ? String(event.over.id) : null

    if (!data) {
      return
    }

    const item = data.kind === 'inventory' ? project.items[data.itemId] : undefined

    if (data.kind === 'inventory' && !item) {
      showMessage('That inventory item no longer exists.')
      return
    }

    if (data.kind === 'inventory' && item && isCanvasItem(item)) {
      if (overId !== 'canvas') {
        showMessage('Drop canvas equipment onto the canvas.')
        return
      }

      const point = getCanvasDropPoint(event, canvasControllerRef.current, snapItemsToGrid)
      const itemRuntimeKey = runtimeItemKey(item)
      const placement = { serverId: itemRuntimeKey, ...point }
      const placementCheck = await validateCanvasPlacement(project, placement)

      if (!placementCheck) return
      if (!placementCheck.valid) {
        showMessage('Canvas equipment cannot overlap. Drop this item in an open space.')
        return
      }

      if (!await commitPlacementUpdates([placement], 'Canvas item could not be placed.')) return
      setSelectedItemId(itemRuntimeKey)
      setSelectedConnectionId(null)
      setValidationMessage(null)
      return
    }

    const serverId = getServerIdFromOver(overId)

    if (!serverId) {
      showMessage('Drop components onto a compatible host.')
      return
    }

    if (data.kind === 'assigned-component') {
      const result = moveAssignedComponent(project, data.assignmentId, serverId)

      if (!result.ok) {
        showMessage(result.message)
        return
      }

      const assignment = findAssignmentById(project.assignments, data.assignmentId)
      const assignedItem = assignment ? project.items[assignment.itemId] : undefined
      if (!assignment || !assignedItem) {
        showMessage('That component or server no longer exists.')
        return
      }

      const affectedPlacements = [assignment.serverId, serverId]
        .filter((itemId, index, itemIds) => itemIds.indexOf(itemId) === index)
        .flatMap((itemId) => {
          const placement = result.project.placements.find((candidate) => candidate.serverId === itemId)
          return placement ? [placement] : []
        })
      const placementCheck = await validateCanvasGroupMove(
        result.project,
        affectedPlacements,
      )
      if (!placementCheck) return
      if (!placementCheck.valid) {
        showMessage('This server needs more open space before moving that component.')
        return
      }

      if (
        result.project !== project
        && !await commitAssignmentUpdate(
          project,
          result.project,
          'The component could not be moved.',
        )
      ) return
      setSelectedItemId(assignment.itemId)
      setSelectedConnectionId(null)
      showCompatibilityUnknownMessage('Moved', assignedItem.name, result.unknownFindings)
      focusCanvasItem(serverId)
      return
    }

    if (!item) {
      showMessage('That inventory item no longer exists.')
      return
    }

    if (isCanvasItem(item)) {
      showMessage('Canvas equipment belongs on the canvas.')
      return
    }

    const result = tryAssignComponent(project, serverId, data.itemId)

    if (!result.ok) {
      showMessage(result.message)
      return
    }

    const nextProject = result.project
    const serverPlacement = nextProject.placements.find((placement) => placement.serverId === serverId)

    if (serverPlacement) {
      const placementCheck = await validateCanvasPlacement(nextProject, serverPlacement)
      if (!placementCheck) return
      if (!placementCheck.valid) {
        showMessage('This server needs more open space before adding that component.')
        return
      }
    }

    if (!await commitAssignmentUpdate(
      project,
      nextProject,
      'The component could not be assigned.',
    )) return
    setSelectedItemId(data.itemId)
    setSelectedConnectionId(null)
    showCompatibilityUnknownMessage('Assigned', item.name, result.unknownFindings)
    focusCanvasItem(data.itemId)
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as ComponentDragData | undefined

    if (!data || (data.kind !== 'inventory' && data.kind !== 'assigned-component')) return

    const currentDragData: ComponentDragData = data.kind === 'inventory'
      ? { kind: 'inventory', itemId: data.itemId }
      : {
          kind: 'assigned-component',
          assignmentId: data.assignmentId,
          itemId: data.itemId,
          sourceServerId: data.sourceServerId,
        }
    const currentAssignment = data.kind === 'assigned-component' && project
      ? findAssignmentById(project.assignments, data.assignmentId)
      : undefined

    setActiveComponentDragData(currentDragData)
    setDragOverHostId(null)
    setDragPreviewOverCanvas(false)
    setDragPreviewZoom(1)
    setDraggingItemId(currentAssignment?.itemId ?? data.itemId)
    setMobileInventoryOpen(false)
    setValidationMessage(null)
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id ? String(event.over.id) : null
    const overCanvas = isInventoryDragOverCanvas(overId)

    setDragOverHostId(getServerIdFromOver(overId))
    setDragPreviewOverCanvas(overCanvas)
    setDragPreviewZoom(overCanvas ? canvasControllerRef.current?.getViewportZoom() ?? 1 : 1)
  }

  function undoProjectChange() {
    setHistory((currentHistory) => {
      const currentProject = projectRef.current

      if (!currentProject) {
        return currentHistory
      }

      const result = undoHistory(currentHistory, currentProject)

      if (!result) {
        return currentHistory
      }

      projectRef.current = result.project
      setProject(result.project)

      if (result.project !== currentProject) {
        scheduleLegacyProjectSave(result.project)
      }
      setSelectedItemId((current) => (current && result.project.items[current] ? current : null))
      setSelectedConnectionId((current) =>
        current && result.project.connections.some((connection) => connection.id === current)
          ? current
          : null,
      )
      setValidationMessage(null)

      return result.history
    })
  }

  function redoProjectChange() {
    setHistory((currentHistory) => {
      const currentProject = projectRef.current

      if (!currentProject) {
        return currentHistory
      }

      const result = redoHistory(currentHistory, currentProject)

      if (!result) {
        return currentHistory
      }

      projectRef.current = result.project
      setProject(result.project)

      if (result.project !== currentProject) {
        scheduleLegacyProjectSave(result.project)
      }
      setSelectedItemId((current) => (current && result.project.items[current] ? current : null))
      setSelectedConnectionId((current) =>
        current && result.project.connections.some((connection) => connection.id === current)
          ? current
          : null,
      )
      setValidationMessage(null)

      return result.history
    })
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

  return (
    <TooltipProvider>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={() => {
          setDraggingItemId(null)
          setActiveComponentDragData(null)
          setDragOverHostId(null)
          setDragPreviewOverCanvas(false)
          setDragPreviewZoom(1)
        }}
        onDragEnd={handleDragEnd}
      >
        <div className="relative flex h-dvh w-screen overflow-hidden bg-[#e8e2d8] lg:min-w-[1080px]">
          <DesktopInventoryShell
            expanded={desktopInventoryVisible}
            width={inventoryWidth}
            onResizePointerDown={startInventoryResize}
          >
            <InventorySidebar
              project={project}
              onSelect={handleInventorySelect}
              onCreateItem={handleCreateInventoryItem}
              onDuplicateItem={handleDuplicateInventoryItem}
              onArchiveItems={(items) => void requestInventoryLifecycle('archive', items)}
              onRestoreItems={(items) => void handleRestoreInventoryItems(items)}
              onDeleteItems={(items) => void requestInventoryLifecycle('delete', items)}
              lifecycleRevision={inventoryLifecycleRevision}
              lifecycleBusy={inventoryLifecycleBusy}
              width={inventoryWidth}
            />
          </DesktopInventoryShell>
          <Sheet open={mobileInventoryOpen} onOpenChange={setMobileInventoryOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="!w-[min(94vw,430px)] max-w-none gap-0 border-r-0 bg-[#20242c] p-0 text-[#f7f1e8] sm:max-w-none"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Inventory</SheetTitle>
                <SheetDescription>Browse and drag inventory items onto the canvas.</SheetDescription>
              </SheetHeader>
              <InventorySidebar
                project={project}
                onSelect={handleInventorySelect}
                onCreateItem={handleCreateInventoryItem}
                onDuplicateItem={handleDuplicateInventoryItem}
                onArchiveItems={(items) => void requestInventoryLifecycle('archive', items)}
                onRestoreItems={(items) => void handleRestoreInventoryItems(items)}
                onDeleteItems={(items) => void requestInventoryLifecycle('delete', items)}
                lifecycleRevision={inventoryLifecycleRevision}
                lifecycleBusy={inventoryLifecycleBusy}
                onClose={() => setMobileInventoryOpen(false)}
                className="h-full w-full"
              />
            </SheetContent>
          </Sheet>
          <WorkbenchCanvas
            project={project}
            topologyData={topologyQuery.data}
            compatibleEndpointKeys={compatibleTopologyDestinations.endpointKeys}
            agentStatus={agentStatusQuery.data ?? null}
            demoRemainingSeconds={demoRemainingSeconds}
            selectedItemId={selectedItem ? runtimeItemKey(selectedItem) : null}
            selectedConnectionId={selectedConnection?.id ?? null}
            spotlightItemId={spotlightItemId}
            activeNetworkTraceConnectionIds={activeNetworkTraceConnectionIds}
            activeNetworkTraceItemIds={activeNetworkTraceItemIds}
            pendingEndpoint={pendingConnectionEndpoint}
            draggingEndpoint={portConnectionPreview?.mode === 'drag' ? portConnectionPreview.from : null}
            dropCompatibilityByHostId={dropCompatibilityByHostId}
            validationMessage={validationMessage ?? topologyStatus?.message ?? null}
            validationSeverity={validationMessage ? validationSeverity : topologyStatus?.severity ?? validationSeverity}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            saveStatus={saveStatus}
            canonicalMutationBusy={canonicalMutationBusy}
            canvasOperationLabel={canvasOperationLabel}
            desktopInventoryVisible={desktopInventoryVisible}
            inspectorOpen={selectedItem !== null || selectedConnection !== null}
            autoCenterOnSelect={autoCenterOnSelect}
            networkCablesVisible={networkCablesVisible}
            powerCablesVisible={powerCablesVisible}
            displayCablesVisible={displayCablesVisible}
            snapCablesToGrid={snapCablesToGrid}
            avoidCableCollisionsGlobally={avoidCableCollisionsGlobally}
            snapItemsToGrid={snapItemsToGrid}
            updateAvailable={shouldHighlightUpdate(updateStatusQuery.data)}
            updateStatusLoading={updateStatusQuery.isFetching && !updateStatusQuery.data}
            onSelect={(itemId) => {
              setSelectedItemId(itemId)
              setSelectedConnectionId(null)
              setActiveNetworkTraceEndpoint(null)
              focusCanvasItem(itemId)
            }}
            onSelectConnection={(connectionId) => {
              setSelectedConnectionId(connectionId)
              setSelectedItemId(null)
              setActiveNetworkTraceEndpoint(null)
            }}
            onRemoveAssignment={requestAssignedComponentRemoval}
            onMoveItem={async (itemId: string, position: XYPosition) => {
              const placement = {
                serverId: itemId,
                x: snapItemsToGrid ? snapToGrid(position.x) : position.x,
                y: snapItemsToGrid ? snapToGrid(position.y) : position.y,
              }
              const placementCheck = await validateCanvasPlacement(project, placement)

              if (!placementCheck) return false
              if (!placementCheck.valid) {
                showMessage('Canvas equipment cannot overlap. Move this item to an open space.')
                return false
              }

              return commitPlacementUpdates([placement])
            }}
            onMoveItems={async (placements) => {
              const nextPlacements = placements.map((placement) => ({
                serverId: placement.serverId,
                x: snapItemsToGrid ? snapToGrid(placement.x) : placement.x,
                y: snapItemsToGrid ? snapToGrid(placement.y) : placement.y,
              }))

              const placementCheck = await validateCanvasGroupMove(project, nextPlacements)
              if (!placementCheck) return false
              if (!placementCheck.valid) {
                showMessage('Canvas equipment cannot overlap. Move this group to an open space.')
                return false
              }

              return commitPlacementUpdates(nextPlacements)
            }}
            onEndpointClick={handleCanvasEndpointClick}
            onEndpointDragStart={handleCanvasEndpointDragStart}
            onEndpointDrop={handleCanvasEndpointDrop}
            onUpdateConnectionRoute={updateConnectionRouteInEngine}
            onViewportReady={(canvasController) => {
              canvasControllerRef.current = canvasController
            }}
            onCanvasClick={() => {
              setSelectedItemId(null)
              setSelectedConnectionId(null)
              setPendingConnectionEndpoint(null)
              setPortConnectionPreview(null)
              setActiveNetworkTraceEndpoint(null)
            }}
            onUndo={undoProjectChange}
            onRedo={redoProjectChange}
            onOpenInventory={() => {
              if (window.matchMedia('(min-width: 1024px)').matches) {
                setDesktopInventoryVisible((current) => !current)
                return
              }

              setMobileInventoryOpen(true)
            }}
            onToggleAutoCenterOnSelect={() => setAutoCenterOnSelect((current) => !current)}
            onToggleNetworkCablesVisible={() => setNetworkCablesVisible((current) => !current)}
            onTogglePowerCablesVisible={() => setPowerCablesVisible((current) => !current)}
            onToggleDisplayCablesVisible={() => setDisplayCablesVisible((current) => !current)}
            onAutoArrange={() => {
              if (project.placements.length === 0) {
                showMessage('Drag equipment onto the canvas before arranging.')
                return
              }

              setCanvasOperationLabel('Arranging canvas')
              void arrangeProjectItems(domainEngine.client, project)
                .then(async (placements) => {
                  await commitPlacementUpdates(placements, 'Canvas items could not be arranged.')
                })
                .catch((error) => {
                  showMessage(error instanceof Error ? error.message : 'Canvas items could not be arranged.')
                })
                .finally(() => setCanvasOperationLabel(null))
            }}
            onOpenAudit={() => setAuditOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenUpdate={() => {
              if (updateStatusQuery.data) {
                setUpdateDialogOpen(true)
                return
              }

              void updateStatusQuery.refetch().then((result) => {
                if (result.data) setUpdateDialogOpen(true)
              })
            }}
          />
          {portConnectionPreview ? (
            <PortConnectionPreviewOverlay preview={portConnectionPreview} />
          ) : null}
          <InspectorPanel
            project={project}
            topologyData={topologyQuery.data}
            topologyStatusMessage={topologyStatus?.message ?? null}
            topologyStatusIsError={topologyStatus?.severity === 'error'}
            compatibleEndpointKeys={compatibleTopologyDestinations.endpointKeys}
            agentStatus={agentStatusQuery.data ?? null}
            demoMode={isDemoMode}
            selectedItemId={selectedItem ? runtimeItemKey(selectedItem) : null}
            selectedConnectionId={selectedConnection?.id ?? null}
            activeNetworkTraceKey={activeNetworkTraceEndpoint ? endpointKey(activeNetworkTraceEndpoint) : null}
            pendingConnectionEndpoint={pendingConnectionEndpoint}
            validationMessage={validationMessage}
            validationSeverity={validationSeverity}
            persistenceWarning={persistenceWarning}
            open={selectedItem !== null || selectedConnection !== null}
            onClose={() => {
              setSelectedItemId(null)
              setSelectedConnectionId(null)
              setPendingConnectionEndpoint(null)
            }}
            onUpdateProject={updateProject}
            onUpdateItem={handleUpdateInventoryItem}
            onRequestNasPowerConfigurationChange={(item, powerConfiguration) => {
              void requestNasPowerConfigurationChange(item, powerConfiguration)
            }}
            onSetWarningIgnored={(warningId, ignored) => {
              updateProject(setAuditWarningIgnored(project, warningId, ignored))
            }}
            onUpdateItemProperties={handleUpdateInventoryItemProperties}
            onDuplicateItem={handleDuplicateInventoryItem}
            onArchiveItem={(item) => void requestInventoryLifecycle('archive', [item])}
            onReturnItemToInventory={requestReturnToInventory}
            lifecycleBusy={inventoryLifecycleBusy}
            onCreateConnection={(from: ConnectionEndpoint, to: ConnectionEndpoint) => {
              createConnectionBetween(from, to)
            }}
            onSelectNetworkTrace={(endpoint) => {
              setActiveNetworkTraceEndpoint(endpoint)
              setSelectedConnectionId(null)
              setPendingConnectionEndpoint(null)
              setPortConnectionPreview(null)
            }}
            onEndpointConnectionClick={handleEndpointConnectionClick}
            onCancelPendingConnection={() => {
              setPendingConnectionEndpoint(null)
              setValidationMessage(null)
            }}
            onUpdateConnectionLabel={updateConnectionLabelInEngine}
            onUpdateConnectionRoute={updateConnectionRouteInEngine}
            onRemoveConnection={removeConnectionInEngine}
          />
          <AuditDrawer
            project={project}
            topologyData={topologyQuery.data}
            open={auditOpen}
            onClose={() => setAuditOpen(false)}
            onSelectItem={(itemId) => {
              setSelectedItemId(itemId)
              setSelectedConnectionId(null)
              setPendingConnectionEndpoint(null)
              setAuditOpen(false)
              setActiveNetworkTraceEndpoint(null)
              focusCanvasItem(itemId)
            }}
            onSetWarningIgnored={(warningId, ignored) => {
              updateProject(setAuditWarningIgnored(project, warningId, ignored))
            }}
          />
          <GlobalItemSearch
            project={project}
            open={searchOpen}
            onOpenChange={setSearchOpen}
            onSelectItem={(itemId) => {
              setSelectedItemId(itemId)
              setSelectedConnectionId(null)
              setPendingConnectionEndpoint(null)
              setActiveNetworkTraceEndpoint(null)
              focusCanvasItem(itemId)
            }}
          />
          <InventoryLifecycleDialog
            open={inventoryLifecycleRequest !== null}
            action={inventoryLifecycleRequest?.action ?? 'archive'}
            itemNames={inventoryLifecycleRequest?.items.map((item) => item.name) ?? []}
            dependencyReport={inventoryDependencyReport}
            loading={inventoryLifecycleBusy}
            error={inventoryLifecycleError}
            onOpenChange={(open) => {
              if (open) return
              setInventoryLifecycleRequest(null)
              setInventoryDependencyReport(null)
              setInventoryLifecycleError(null)
            }}
            onConfirm={() => void confirmInventoryLifecycle()}
          />
          <ReturnToInventoryDialog
            open={returnToInventoryItemId !== null}
            itemName={returnToInventoryItem?.name ?? 'Canvas item'}
            itemType={returnToInventoryItem?.type ?? 'item'}
            impact={returnToInventoryImpact ?? {
              placementsRemoved: 0,
              assignmentsReleased: 0,
              connectionsRemoved: 0,
            }}
            busy={returnToInventoryBusy}
            onOpenChange={(open) => {
              if (!open && !returnToInventoryBusy) setReturnToInventoryItemId(null)
            }}
            onConfirm={confirmReturnToInventory}
          />
          <NasPowerConfigurationDialog
            open={pendingNasPowerChange !== null}
            nasName={pendingNasPowerChange
              ? project.items[`nas:${pendingNasPowerChange.nasId}`]?.name ?? 'NAS'
              : 'NAS'}
            impact={pendingNasPowerChange?.impact ?? null}
            busy={nasPowerChangeBusy}
            error={nasPowerChangeError}
            onOpenChange={(open) => {
              if (!open && !nasPowerChangeBusy) {
                setPendingNasPowerChange(null)
                setNasPowerChangeError(null)
              }
            }}
            onConfirm={() => void confirmNasPowerConfigurationChange()}
          />
          <AssignedComponentRemovalDialog
            open={pendingAssignmentRemoval !== null}
            itemName={pendingAssignmentRemoval?.itemName ?? 'component'}
            connectionCount={pendingAssignmentRemoval?.connectionCount ?? 0}
            onOpenChange={(open) => {
              if (!open) setPendingAssignmentRemoval(null)
            }}
            onConfirm={() => {
              if (pendingAssignmentRemoval) {
                void removeAssignedComponent(pendingAssignmentRemoval.assignmentId)
              }
            }}
          />
          {releaseNotesQuery.data ? (
            <WhatsNewDialog
              open={shouldShowWhatsNewDialog}
              currentVersion={releaseNotesQuery.data.currentVersion}
              entries={releaseNotesQuery.data.entries}
              acknowledging={acknowledgeReleaseNotesMutation.isPending}
              onAcknowledge={() => acknowledgeReleaseNotesMutation.mutate()}
              onOpenChange={handleWhatsNewOpenChange}
            />
          ) : null}
          {updateStatusQuery.data ? (
            <UpdateDialog
              open={updateDialogOpen}
              status={updateStatusQuery.data}
              checking={checkForUpdatesMutation.isPending}
              skipping={skipUpdateMutation.isPending}
              clearingSkip={clearSkippedUpdateMutation.isPending}
              onOpenChange={setUpdateDialogOpen}
              onCheck={() => checkForUpdatesMutation.mutate()}
              onSkip={() => skipUpdateMutation.mutate()}
              onClearSkip={() => clearSkippedUpdateMutation.mutate()}
            />
          ) : null}
          <SettingsDialog
            open={settingsOpen}
            projectName={project.metadata.name}
            saveStatus={saveStatus}
            inventoryVisible={desktopInventoryVisible}
            inventoryWidth={inventoryWidth}
            autoCenterOnSelect={autoCenterOnSelect}
            networkCablesVisible={networkCablesVisible}
            powerCablesVisible={powerCablesVisible}
            displayCablesVisible={displayCablesVisible}
            openCreatedConnectionInspector={openCreatedConnectionInspector}
            snapCablesToGrid={snapCablesToGrid}
            avoidCableCollisionsGlobally={avoidCableCollisionsGlobally}
            snapItemsToGrid={snapItemsToGrid}
            updateStatus={updateStatusQuery.data ?? null}
            updateLoading={updateStatusQuery.isLoading}
            updateChecking={checkForUpdatesMutation.isPending}
            updateClearingSkip={clearSkippedUpdateMutation.isPending}
            onOpenChange={setSettingsOpen}
            onProjectNameChange={updateProjectName}
            onInventoryVisibleChange={setDesktopInventoryVisible}
            onInventoryWidthChange={(width) => setInventoryWidth(clampInventoryWidth(width))}
            onAutoCenterOnSelectChange={setAutoCenterOnSelect}
            onNetworkCablesVisibleChange={setNetworkCablesVisible}
            onPowerCablesVisibleChange={setPowerCablesVisible}
            onDisplayCablesVisibleChange={setDisplayCablesVisible}
            onOpenCreatedConnectionInspectorChange={setOpenCreatedConnectionInspector}
            onSnapCablesToGridChange={setSnapCablesToGrid}
            onAvoidCableCollisionsGloballyChange={setAvoidCableCollisionsGlobally}
            onSnapItemsToGridChange={setSnapItemsToGrid}
            onResetBrowserPreferences={() => {
              resetStoredUiPreferences()
              setDesktopInventoryVisible(DEFAULT_UI_PREFERENCES.inventoryVisible)
              setInventoryWidth(DEFAULT_UI_PREFERENCES.inventoryWidth)
              setAutoCenterOnSelect(DEFAULT_UI_PREFERENCES.autoCenterOnSelect)
              setNetworkCablesVisible(DEFAULT_UI_PREFERENCES.networkCablesVisible)
              setPowerCablesVisible(DEFAULT_UI_PREFERENCES.powerCablesVisible)
              setDisplayCablesVisible(DEFAULT_UI_PREFERENCES.displayCablesVisible)
              setOpenCreatedConnectionInspector(
                DEFAULT_UI_PREFERENCES.openCreatedConnectionInspector,
              )
              setSnapCablesToGrid(DEFAULT_UI_PREFERENCES.snapCablesToGrid)
              setAvoidCableCollisionsGlobally(
                DEFAULT_UI_PREFERENCES.avoidCableCollisionsGlobally,
              )
              setSnapItemsToGrid(DEFAULT_UI_PREFERENCES.snapItemsToGrid)
            }}
            onClearIgnoredWarnings={() => {
              updateProject(clearIgnoredAuditWarnings(project))
            }}
            onEnableCompatibilityForAllHosts={() => {
              updateProject(enableCompatibilityForAllHosts(project))
            }}
            onCheckForUpdates={() => checkForUpdatesMutation.mutate()}
            onClearSkippedUpdate={() => clearSkippedUpdateMutation.mutate()}
          />
          <DemoSessionDialog
            state={demoDialogState}
            secondsRemaining={demoExtensionSeconds}
            onExtend={() => extendDemoSessionMutation.mutate()}
            onExpire={finalizeDemoExpiration}
          />
        </div>
        <DragOverlay dropAnimation={null} zIndex={80}>
          <InventoryDragPreview
            item={draggingItemId ? project.items[draggingItemId] ?? null : null}
            project={project}
            overCanvas={dragPreviewOverCanvas}
            viewportZoom={dragPreviewZoom}
          />
        </DragOverlay>
      </DndContext>
    </TooltipProvider>
  )
}

export default App
