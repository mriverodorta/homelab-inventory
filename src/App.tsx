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
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuditDrawer } from '@/components/audit-drawer'
import { DemoSessionDialog, type DemoSessionDialogState } from '@/components/demo-session-dialog'
import { DesktopInventoryShell } from '@/components/desktop-inventory-shell'
import { GlobalItemSearch } from '@/components/global-item-search'
import { InspectorPanel } from '@/components/inspector-panel'
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
import type { CanvasPortDragPoint } from '@/types/canvas'
import {
  findAssignmentById,
  getAssignedComponentDropGeometryError,
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
  deleteInventoryItems,
  duplicateInventoryItem,
  loadInventoryDependencyReports,
  loadProject,
  restoreInventoryItems,
  saveProject,
  updateInventoryItem,
  type InventoryItemInput,
} from '@/lib/db'
import { expireDemoSession, extendDemoSession, loadDemoSession, type DemoSessionStatus } from '@/lib/demo-api'
import { runtimeItemKey } from '@/lib/item-keys'
import { createConnectionForEndpoints } from '@/lib/connection-endpoints'
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
  getStoredCablesVisible,
  getStoredInventoryVisible,
  getStoredInventoryWidth,
  resetStoredUiPreferences,
  storeAutoCenterOnSelect,
  storeCablesVisible,
  storeInventoryVisible,
  storeInventoryWidth,
} from '@/lib/ui-preferences'
import {
  createEmptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from '@/lib/history'
import {
  getNetworkTraceConnectionIds,
  getNetworkTraceItemIds,
  traceNetworkPath,
} from '@/lib/network-trace'
import { normalizeNetworkProject } from '@/lib/negotiated-speed'
import {
  getCanvasItemHeight,
  getCanvasItemWidth,
  autoArrangeCanvasItems,
  endpointKey,
  getNonCollidingPlacement,
  isCanvasItem,
  placementCollides,
  placementsCollide,
  removeConnection,
  getReturnCanvasItemImpact,
  returnCanvasItemToInventory,
  updateConnectionLabel,
  updateConnectionRoute,
  upsertPlacements,
  upsertPlacement,
} from '@/lib/project'
import { formatCapacity, formatPortSummary } from '@/lib/format'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  InventoryItem,
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

type InventoryLifecycleRequest = {
  action: InventoryLifecycleAction
  items: InventoryItem[]
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

function getCanvasDropPoint(event: DragEndEvent, canvasController: CanvasController | null) {
  const translated = event.active.rect.current.translated

  if (!translated || !canvasController) {
    return { x: 48, y: 48 }
  }

  const flowPoint = canvasController.screenToFlowPosition({
    x: translated.left,
    y: translated.top,
  })

  return {
    x: snapToGrid(flowPoint.x),
    y: snapToGrid(flowPoint.y),
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
}: {
  item: InventoryItem | null
  project: ProjectState
}) {
  if (!item) {
    return null
  }

  const canvasItem = isCanvasItem(item)
  const itemRuntimeKey = runtimeItemKey(item)
  const width = canvasItem ? getCanvasItemWidth(project, itemRuntimeKey) : 220
  const height = canvasItem ? getCanvasItemHeight(project, itemRuntimeKey) : 68

  return (
    <div
      className={`pointer-events-none rounded-lg border-2 p-2 opacity-95 shadow-[0_20px_48px_rgba(32,36,44,0.32)] ${dragPreviewTone(item)}`}
      style={{ width, minHeight: height }}
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
  const [project, setProject] = useState<ProjectState | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | number | null>(null)
  const [pendingConnectionEndpoint, setPendingConnectionEndpoint] = useState<ConnectionEndpoint | null>(null)
  const [validationMessage, setValidationMessageValue] = useState<string | null>(null)
  const [validationSeverity, setValidationSeverity] = useState<ValidationSeverity>('error')
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [spotlightItemId, setSpotlightItemId] = useState<string | null>(null)
  const [portConnectionPreview, setPortConnectionPreview] = useState<PortConnectionPreview | null>(null)
  const [activeNetworkTraceEndpoint, setActiveNetworkTraceEndpoint] = useState<ConnectionEndpoint | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [autosaveRevision, setAutosaveRevision] = useState(0)
  const [history, setHistory] = useState<HistoryState<ProjectState>>(() => createEmptyHistory())
  const [inventoryWidth, setInventoryWidth] = useState(getStoredInventoryWidth)
  const [desktopInventoryVisible, setDesktopInventoryVisible] = useState(getStoredInventoryVisible)
  const [mobileInventoryOpen, setMobileInventoryOpen] = useState(false)
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [activeComponentDragData, setActiveComponentDragData] = useState<ComponentDragData | null>(null)
  const [dragOverHostId, setDragOverHostId] = useState<string | null>(null)
  const [autoCenterOnSelect, setAutoCenterOnSelect] = useState(getStoredAutoCenterOnSelect)
  const [cablesVisible, setCablesVisible] = useState(getStoredCablesVisible)
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
  const canvasControllerRef = useRef<CanvasController | null>(null)
  const projectRef = useRef<ProjectState | null>(null)
  const lastPersistedProjectRef = useRef<ProjectState | null>(null)
  const queuedSaveProjectRef = useRef<{
    generation: number
    project: ProjectState
  } | null>(null)
  const saveInFlightRef = useRef(false)
  const saveGenerationRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)
  const hasHydratedProjectRef = useRef(false)
  const demoExpirationFinalizedRef = useRef(false)
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
  const processQueuedProjectSaves = useCallback(() => {
    if (saveInFlightRef.current) {
      return
    }

    saveInFlightRef.current = true

    void (async () => {
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
          }
        }
      } finally {
        saveInFlightRef.current = false
      }
    })()
  }, [persistProject])
  const enqueueProjectSave = useCallback((projectToSave: ProjectState) => {
    queuedSaveProjectRef.current = {
      generation: saveGenerationRef.current,
      project: projectToSave,
    }
    processQueuedProjectSaves()
  }, [processQueuedProjectSaves])
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

  useEffect(() => {
    storeAutoCenterOnSelect(autoCenterOnSelect)
  }, [autoCenterOnSelect])

  useEffect(() => {
    storeCablesVisible(cablesVisible)
  }, [cablesVisible])

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

  useEffect(() => {
    if (!hasHydratedProjectRef.current || autosaveRevision === 0) {
      return
    }

    const projectToSave = projectRef.current

    if (!projectToSave) {
      return
    }

    setSaveStatus('saving')

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      enqueueProjectSave(projectToSave)
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [autosaveRevision, enqueueProjectSave])

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
    () => (project && activeNetworkTraceEndpoint ? traceNetworkPath(project, activeNetworkTraceEndpoint) : null),
    [activeNetworkTraceEndpoint, project],
  )
  const activeNetworkTraceConnectionIds = useMemo(
    () => (activeNetworkTrace ? getNetworkTraceConnectionIds(activeNetworkTrace) : []),
    [activeNetworkTrace],
  )
  const activeNetworkTraceItemIds = useMemo(
    () => (activeNetworkTrace ? getNetworkTraceItemIds(activeNetworkTrace) : []),
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
    const negotiatedProject = normalizeNetworkProject(nextProject)
    const shouldRecordHistory = options.recordHistory ?? true
    const currentProject = projectRef.current

    if (shouldRecordHistory && currentProject) {
      setHistory((currentHistory) => pushHistory(currentHistory, currentProject))
    }

    projectRef.current = negotiatedProject
    setProject(negotiatedProject)

    if (negotiatedProject !== currentProject) {
      setAutosaveRevision((current) => current + 1)
    }
  }

  function setValidationMessage(
    message: string | null,
    severity: ValidationSeverity = 'error',
  ) {
    setValidationMessageValue(message)
    setValidationSeverity(message ? severity : 'error')
  }

  function applyInventoryCommandSnapshot(nextProject: ProjectState) {
    const negotiatedProject = normalizeNetworkProject(nextProject)

    saveGenerationRef.current += 1
    queuedSaveProjectRef.current = null

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    projectRef.current = negotiatedProject
    lastPersistedProjectRef.current = negotiatedProject
    setProject(negotiatedProject)
    setHistory(createEmptyHistory())
    setSelectedConnectionId(null)
    setActiveNetworkTraceEndpoint(null)
    setValidationMessage(null)
    setPersistenceWarning(null)
    setSaveStatus('saved')
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

  function createConnectionBetween(from: ConnectionEndpoint, to: ConnectionEndpoint) {
    const currentProject = projectRef.current

    if (!currentProject) {
      return
    }

    const result = createConnectionForEndpoints(currentProject, from, to)

    if (!result.ok) {
      setValidationMessage(result.message)
      return
    }

    updateProject(result.project)
    setSelectedConnectionId(result.connection.id)
    setSelectedItemId(null)
    setPendingConnectionEndpoint(null)
    setPortConnectionPreview(null)
    setValidationMessage(null)
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

    const result = createConnectionForEndpoints(project, pendingConnectionEndpoint, endpoint)

    if (!result.ok) {
      setValidationMessage(result.message)
      return
    }

    updateProject(result.project)
    setSelectedConnectionId(result.connection.id)
    setSelectedItemId(null)
    setPendingConnectionEndpoint(null)
    setValidationMessage(null)
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

  async function handleCreateInventoryItem(item: InventoryItemInput, quantity: number) {
    const currentProject = projectRef.current
    const nextProject = await createInventoryItems(item, quantity)
    const previousItemIds = new Set(Object.keys(currentProject?.items ?? {}))
    const createdItemId = Object.keys(nextProject.items).find((itemId) => !previousItemIds.has(itemId))

    applyInventoryCommandSnapshot(nextProject)

    if (createdItemId) {
      setSelectedItemId(createdItemId)
    }
  }

  async function handleUpdateInventoryItem(itemId: string, input: InventoryItemInput) {
    const currentItem = projectRef.current?.items[itemId]

    if (!currentItem) {
      throw new Error('Inventory item could not be found.')
    }

    const nextProject = await updateInventoryItem(
      { type: currentItem.type, id: currentItem.id },
      input,
    )
    applyInventoryCommandSnapshot(nextProject)
    setSelectedItemId(itemId)
  }

  async function handleDuplicateInventoryItem(item: InventoryItem) {
    setInventoryLifecycleBusy(true)
    setInventoryLifecycleError(null)

    try {
      const currentItemIds = new Set(Object.keys(projectRef.current?.items ?? {}))
      const nextProject = await duplicateInventoryItem(inventoryRef(item))
      const duplicatedItemId = Object.keys(nextProject.items).find((itemId) => !currentItemIds.has(itemId))

      applyInventoryCommandSnapshot(nextProject)
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

      applyInventoryCommandSnapshot(nextProject)
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
      applyInventoryCommandSnapshot(nextProject)
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

  function handleDragEnd(event: DragEndEvent) {
    setDraggingItemId(null)
    setActiveComponentDragData(null)
    setDragOverHostId(null)

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

      const point = getCanvasDropPoint(event, canvasControllerRef.current)
      const itemRuntimeKey = runtimeItemKey(item)
      const placement = getNonCollidingPlacement(project, { serverId: itemRuntimeKey, ...point })

      if (!placement) {
        showMessage('Canvas equipment cannot overlap. Drop this item in an open space.')
        return
      }

      updateProject(upsertPlacement(project, placement))
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

      const geometryError = getAssignedComponentDropGeometryError(
        project,
        result.project,
        assignment,
        serverId,
      )
      if (geometryError) {
        showMessage(geometryError)
        return
      }

      if (result.project !== project) updateProject(result.project)
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

    if (serverPlacement && placementCollides(nextProject, serverPlacement)) {
      showMessage('This server needs more open space before adding that component.')
      return
    }

    updateProject(nextProject)
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
    setDraggingItemId(currentAssignment?.itemId ?? data.itemId)
    setMobileInventoryOpen(false)
    setValidationMessage(null)
  }

  function handleDragOver(event: DragOverEvent) {
    setDragOverHostId(getServerIdFromOver(event.over?.id ? String(event.over.id) : null))
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
        setAutosaveRevision((current) => current + 1)
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
        setAutosaveRevision((current) => current + 1)
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
            validationMessage={validationMessage}
            validationSeverity={validationSeverity}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            saveStatus={saveStatus}
            desktopInventoryVisible={desktopInventoryVisible}
            inspectorOpen={selectedItem !== null || selectedConnection !== null}
            autoCenterOnSelect={autoCenterOnSelect}
            cablesVisible={cablesVisible}
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
            onRemoveAssignment={(assignmentId) => {
              const result = tryRemoveAssignedComponent(project, assignmentId)
              if (!result.ok) {
                showMessage(result.message)
                return
              }
              updateProject(result.project)
            }}
            onMoveItem={(itemId: string, position: XYPosition) => {
              const placement = getNonCollidingPlacement(project, {
                serverId: itemId,
                x: snapToGrid(position.x),
                y: snapToGrid(position.y),
              })

              if (!placement) {
                showMessage('Canvas equipment cannot overlap. Move this item to an open space.')
                return false
              }

              updateProject(upsertPlacement(project, placement))
              setValidationMessage(null)
              return true
            }}
            onMoveItems={(placements) => {
              const nextPlacements = placements.map((placement) => ({
                serverId: placement.serverId,
                x: snapToGrid(placement.x),
                y: snapToGrid(placement.y),
              }))

              if (placementsCollide(project, nextPlacements)) {
                showMessage('Canvas equipment cannot overlap. Move this group to an open space.')
                return false
              }

              updateProject(upsertPlacements(project, nextPlacements))
              setValidationMessage(null)
              return true
            }}
            onEndpointClick={handleCanvasEndpointClick}
            onEndpointDragStart={handleCanvasEndpointDragStart}
            onEndpointDrop={handleCanvasEndpointDrop}
            onUpdateConnectionRoute={(connectionId: string | number, route: ConnectionRoutePreferences) => {
              updateProject(updateConnectionRoute(project, connectionId, route), {
                recordHistory: false,
              })
              setValidationMessage(null)
            }}
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
            onToggleCablesVisible={() => setCablesVisible((current) => !current)}
            onAutoArrange={() => {
              if (project.placements.length === 0) {
                showMessage('Drag equipment onto the canvas before arranging.')
                return
              }

              updateProject(autoArrangeCanvasItems(project))
              setValidationMessage(null)
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
            onDuplicateItem={handleDuplicateInventoryItem}
            onArchiveItem={(item) => void requestInventoryLifecycle('archive', [item])}
            onReturnItemToInventory={requestReturnToInventory}
            lifecycleBusy={inventoryLifecycleBusy}
            onCreateConnection={(from: ConnectionEndpoint, to: ConnectionEndpoint) => {
              const result = createConnectionForEndpoints(project, from, to)

              if (!result.ok) {
                setValidationMessage(result.message)
                return
              }

              updateProject(result.project)
              setSelectedConnectionId(result.connection.id)
              setSelectedItemId(null)
              setActiveNetworkTraceEndpoint(null)
              setPendingConnectionEndpoint(null)
              setValidationMessage(null)
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
            onUpdateConnectionLabel={(connectionId, label) => {
              updateProject(updateConnectionLabel(project, connectionId, label), {
                recordHistory: false,
              })
              setValidationMessage(null)
            }}
            onUpdateConnectionRoute={(connectionId, route) => {
              updateProject(updateConnectionRoute(project, connectionId, route), {
                recordHistory: false,
              })
              setValidationMessage(null)
            }}
            onRemoveConnection={(connectionId) => {
              updateProject(removeConnection(project, connectionId))
              if (String(selectedConnectionId) === String(connectionId)) {
                setSelectedConnectionId(null)
              }
              setValidationMessage(null)
            }}
          />
          <AuditDrawer
            project={project}
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
            cablesVisible={cablesVisible}
            updateStatus={updateStatusQuery.data ?? null}
            updateLoading={updateStatusQuery.isLoading}
            updateChecking={checkForUpdatesMutation.isPending}
            updateClearingSkip={clearSkippedUpdateMutation.isPending}
            onOpenChange={setSettingsOpen}
            onProjectNameChange={(name) => {
              updateProject({
                ...project,
                metadata: {
                  ...project.metadata,
                  name,
                },
              }, { recordHistory: false })
            }}
            onInventoryVisibleChange={setDesktopInventoryVisible}
            onInventoryWidthChange={(width) => setInventoryWidth(clampInventoryWidth(width))}
            onAutoCenterOnSelectChange={setAutoCenterOnSelect}
            onCablesVisibleChange={setCablesVisible}
            onResetBrowserPreferences={() => {
              resetStoredUiPreferences()
              setDesktopInventoryVisible(DEFAULT_UI_PREFERENCES.inventoryVisible)
              setInventoryWidth(DEFAULT_UI_PREFERENCES.inventoryWidth)
              setAutoCenterOnSelect(DEFAULT_UI_PREFERENCES.autoCenterOnSelect)
              setCablesVisible(DEFAULT_UI_PREFERENCES.cablesVisible)
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
          />
        </DragOverlay>
      </DndContext>
    </TooltipProvider>
  )
}

export default App
