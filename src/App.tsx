import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import { InventorySidebar } from '@/components/inventory-sidebar'
import { UpdateDialog } from '@/components/update-dialog'
import { WhatsNewDialog } from '@/components/whats-new-dialog'
import {
  snapToGrid,
  WorkbenchCanvas,
  type CanvasController,
  type CanvasFocusOptions,
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
import { assignComponent, swapAssignedComponent, validateAssignment } from '@/lib/constraints'
import { loadAgentStatus } from '@/lib/agent-api'
import { createInventoryItem, loadProject, saveProject, type InventoryItemInput } from '@/lib/db'
import { expireDemoSession, extendDemoSession, loadDemoSession, type DemoSessionStatus } from '@/lib/demo-api'
import { runtimeItemKey } from '@/lib/item-keys'
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
  clampInventoryWidth,
  getStoredInventoryVisible,
  getStoredInventoryWidth,
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
  applyInventoryItemInput,
  autoArrangeCanvasItems,
  createConnection,
  endpointKey,
  getNonCollidingPlacement,
  isCanvasItem,
  placementCollides,
  placementsCollide,
  removeConnection,
  removeAssignment,
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

type DragData =
  | {
      kind: 'inventory'
      itemId: string
    }
  | {
      kind: 'assigned-component'
      assignmentId: string | number
      itemId: string
      sourceServerId: string
    }

type PortConnectionPreview = {
  from: ConnectionEndpoint
  origin: CanvasPortDragPoint
  pointer: CanvasPortDragPoint
  mode: 'click' | 'drag'
}

const SAVE_DEBOUNCE_MS = 500
const DEMO_EXTENSION_GRACE_SECONDS = 30
const AUTO_CENTER_STORAGE_KEY = 'homelab-inventory:auto-center-on-select'
const RELEASE_NOTES_STATUS_QUERY_KEY = ['release-notes-status'] as const
const DEMO_SESSION_QUERY_KEY = ['demo-session'] as const

type SaveStatus = 'saved' | 'saving' | 'error'

function getStoredAutoCenterPreference(): boolean {
  if (typeof window === 'undefined') {
    return true
  }

  return window.localStorage.getItem(AUTO_CENTER_STORAGE_KEY) !== 'false'
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

  if (item.type === 'switch') {
    return 'border-[#81a6a0] bg-[#1f3536] text-[#f3fbf9]'
  }

  if (item.type === 'patchPanel') {
    return 'border-[#a995c8] bg-[#322b45] text-[#faf7ff]'
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

  if (item.type === 'switch' || item.type === 'patchPanel') {
    return formatPortSummary(item)
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
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [spotlightItemId, setSpotlightItemId] = useState<string | null>(null)
  const [portConnectionPreview, setPortConnectionPreview] = useState<PortConnectionPreview | null>(null)
  const [activeNetworkTraceEndpoint, setActiveNetworkTraceEndpoint] = useState<ConnectionEndpoint | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [history, setHistory] = useState<HistoryState<ProjectState>>(() => createEmptyHistory())
  const [inventoryWidth, setInventoryWidth] = useState(getStoredInventoryWidth)
  const [desktopInventoryVisible, setDesktopInventoryVisible] = useState(getStoredInventoryVisible)
  const [mobileInventoryOpen, setMobileInventoryOpen] = useState(false)
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [autoCenterOnSelect, setAutoCenterOnSelect] = useState(getStoredAutoCenterPreference)
  const [releaseNotesDismissedForSession, setReleaseNotesDismissedForSession] = useState(false)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [demoRemainingSeconds, setDemoRemainingSeconds] = useState<number | null>(null)
  const [demoDialogState, setDemoDialogState] = useState<DemoSessionDialogState>('closed')
  const [demoExtensionSeconds, setDemoExtensionSeconds] = useState(DEMO_EXTENSION_GRACE_SECONDS)
  const canvasControllerRef = useRef<CanvasController | null>(null)
  const projectRef = useRef<ProjectState | null>(null)
  const skipNextSaveRef = useRef(false)
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
  const { mutate: mutateSaveProject } = useMutation({
    mutationFn: saveProject,
  })
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

    skipNextSaveRef.current = true
    hasHydratedProjectRef.current = true
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
    window.localStorage.setItem(AUTO_CENTER_STORAGE_KEY, String(autoCenterOnSelect))
  }, [autoCenterOnSelect])

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
    if (!project || !hasHydratedProjectRef.current) {
      return
    }

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }

    setSaveStatus('saving')

    const saveTimer = window.setTimeout(() => {
      mutateSaveProject(project, {
        onSuccess: () => {
          setPersistenceWarning(null)
          setSaveStatus('saved')
        },
        onError: (error) => {
          setSaveStatus('error')
          setPersistenceWarning(
            error instanceof Error ? error.message : 'Project could not be saved to the JSON database.',
          )
        },
      })
    }, SAVE_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(saveTimer)
    }
  }, [mutateSaveProject, project])

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
  const shouldShowWhatsNewDialog =
    !releaseNotesDismissedForSession &&
    releaseNotesQuery.data?.hasUnseen === true &&
    releaseNotesQuery.data.entries.length > 0
  const isDemoMode = demoSessionQuery.data?.mode === 'demo'

  function updateProject(nextProject: ProjectState, options: { recordHistory?: boolean } = {}) {
    const negotiatedProject = normalizeNetworkProject(nextProject)
    const shouldRecordHistory = options.recordHistory ?? true
    const currentProject = projectRef.current

    if (shouldRecordHistory && currentProject) {
      setHistory((currentHistory) => pushHistory(currentHistory, currentProject))
    }

    projectRef.current = negotiatedProject
    setProject(negotiatedProject)
  }

  function showMessage(message: string) {
    setValidationMessage(message)
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

    const result = createConnection(currentProject, from, to)

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

    const result = createConnection(project, pendingConnectionEndpoint, endpoint)

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

  async function handleCreateInventoryItem(item: InventoryItemInput) {
    const currentProject = projectRef.current
    const nextProject = await createInventoryItem(item)
    const previousItemIds = new Set(Object.keys(currentProject?.items ?? {}))
    const createdItemId = Object.keys(nextProject.items).find((itemId) => !previousItemIds.has(itemId))

    skipNextSaveRef.current = true
    projectRef.current = nextProject
    setProject(nextProject)
    setHistory(createEmptyHistory())
    setSelectedConnectionId(null)
    setActiveNetworkTraceEndpoint(null)
    setValidationMessage(null)
    setPersistenceWarning(null)
    setSaveStatus('saved')

    if (createdItemId) {
      setSelectedItemId(createdItemId)
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

    if (!project) {
      return
    }

    const data = event.active.data.current as DragData | undefined
    const overId = event.over?.id ? String(event.over.id) : null

    if (!data) {
      return
    }

    const item = project.items[data.itemId]

    if (!item) {
      showMessage('That inventory item no longer exists.')
      return
    }

    if (data.kind === 'inventory' && isCanvasItem(item)) {
      if (overId !== 'canvas') {
        showMessage('Drop canvas equipment onto the canvas.')
        return
      }

      const point = getCanvasDropPoint(event, canvasControllerRef.current)
      const itemRuntimeKey = runtimeItemKey(item)
      const placement = getNonCollidingPlacement(project, { serverId: itemRuntimeKey, ...point })

      if (!placement) {
        showMessage('Servers cannot overlap. Drop this server in an open space.')
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
      showMessage('Drop components onto a server.')
      return
    }

    if (data.kind === 'assigned-component') {
      if (serverId === data.sourceServerId) {
        setSelectedItemId(data.itemId)
        setSelectedConnectionId(null)
        setValidationMessage(null)
        focusCanvasItem(data.itemId)
        return
      }

      const assignment = project.assignments.find((candidate) => candidate.id === data.assignmentId)

      if (!assignment) {
        showMessage('That assigned component is no longer attached.')
        return
      }

      if (assignment.type === 'cpu' || assignment.type === 'ram') {
        const result = swapAssignedComponent(project, data.assignmentId, serverId)

        if (!result.ok) {
          showMessage(result.message)
          return
        }

        const targetPlacement = result.project.placements.find((placement) => placement.serverId === serverId)
        const sourcePlacement = result.project.placements.find((placement) => placement.serverId === data.sourceServerId)

        if (
          (targetPlacement && placementCollides(result.project, targetPlacement)) ||
          (sourcePlacement && placementCollides(result.project, sourcePlacement))
        ) {
          showMessage('This swap needs more open space before moving that component.')
          return
        }

        updateProject(result.project)
        setSelectedItemId(data.itemId)
        setSelectedConnectionId(null)
        setValidationMessage(null)
        focusCanvasItem(serverId)
        return
      }

      const projectWithoutAssignment = {
        ...project,
        assignments: project.assignments.filter((candidate) => candidate.id !== data.assignmentId),
      }
      const validation = validateAssignment(projectWithoutAssignment, serverId, data.itemId)

      if (!validation.ok) {
        showMessage(validation.message)
        return
      }

      const nextProject = assignComponent(projectWithoutAssignment, serverId, data.itemId)
      const targetPlacement = nextProject.placements.find((placement) => placement.serverId === serverId)

      if (targetPlacement && placementCollides(nextProject, targetPlacement)) {
        showMessage('This server needs more open space before moving that component.')
        return
      }

      updateProject(nextProject)
      setSelectedItemId(data.itemId)
      setSelectedConnectionId(null)
      setValidationMessage(null)
      focusCanvasItem(data.itemId)
      return
    }

    if (isCanvasItem(item)) {
      showMessage('Canvas equipment belongs on the canvas.')
      return
    }

    const validation = validateAssignment(project, serverId, data.itemId)

    if (!validation.ok) {
      showMessage(validation.message)
      return
    }

    const nextProject = assignComponent(project, serverId, data.itemId)
    const serverPlacement = nextProject.placements.find((placement) => placement.serverId === serverId)

    if (serverPlacement && placementCollides(nextProject, serverPlacement)) {
      showMessage('This server needs more open space before adding that component.')
      return
    }

    updateProject(nextProject)
    setSelectedItemId(data.itemId)
    setSelectedConnectionId(null)
    setValidationMessage(null)
    focusCanvasItem(data.itemId)
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined

    if (data?.kind === 'inventory' || data?.kind === 'assigned-component') {
      setDraggingItemId(data.itemId)
      setMobileInventoryOpen(false)
      setValidationMessage(null)
    }
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

      setProject(result.project)
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

      setProject(result.project)
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
        onDragCancel={() => setDraggingItemId(null)}
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
              width={inventoryWidth}
            />
          </DesktopInventoryShell>
          <Sheet open={mobileInventoryOpen} onOpenChange={setMobileInventoryOpen}>
            <SheetContent
              side="left"
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
            validationMessage={validationMessage}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            saveStatus={saveStatus}
            desktopInventoryVisible={desktopInventoryVisible}
            inspectorOpen={selectedItem !== null || selectedConnection !== null}
            autoCenterOnSelect={autoCenterOnSelect}
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
            onRemoveAssignment={(assignmentId) => updateProject(removeAssignment(project, assignmentId))}
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
            onAutoArrange={() => {
              if (project.placements.length === 0) {
                showMessage('Drag equipment onto the canvas before arranging.')
                return
              }

              updateProject(autoArrangeCanvasItems(project))
              setValidationMessage(null)
            }}
            onOpenAudit={() => setAuditOpen(true)}
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
            persistenceWarning={persistenceWarning}
            open={selectedItem !== null || selectedConnection !== null}
            onClose={() => {
              setSelectedItemId(null)
              setSelectedConnectionId(null)
              setPendingConnectionEndpoint(null)
            }}
            onUpdateItem={(itemId, input) => {
              const currentProject = projectRef.current

              if (!currentProject) {
                return
              }

              updateProject(applyInventoryItemInput(currentProject, itemId, input), {
                recordHistory: false,
              })
              setValidationMessage(null)
            }}
            onCreateConnection={(from: ConnectionEndpoint, to: ConnectionEndpoint) => {
              const result = createConnection(project, from, to)

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
