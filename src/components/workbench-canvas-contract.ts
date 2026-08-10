import {
  findAssignmentById,
  moveAssignedComponent,
  tryAssignComponent,
} from '@/lib/constraints'
import { isCanvasItem } from '@/lib/project'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import type { AgentStatusSummary } from '@/types/agent'
import type { CanvasPortDragPoint } from '@/types/canvas'
import type { CompatibilityStatus } from '@/types/compatibility'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  ConnectionRouteSide,
  ProjectState,
} from '@/types/inventory'
import type { XYPosition } from '@xyflow/react'
import type { CableRouteCanonicalRepair } from '@/lib/cable-routing-coordinator'

export const GRID_SIZE = 24

export type CanvasPosition = {
  x: number
  y: number
}

export type ValidationMessageSeverity = 'error' | 'unknown'

export type ComponentDragData =
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

export function getComponentDropCompatibilityStatus(
  project: ProjectState,
  dragData: ComponentDragData,
  targetHostId: string,
): CompatibilityStatus | null {
  if (dragData.kind === 'inventory') {
    const item = project.items[dragData.itemId]

    if (!item) return 'incompatible'
    if (isCanvasItem(item)) return null

    const transition = tryAssignComponent(project, targetHostId, dragData.itemId)

    if (!transition.ok) return 'incompatible'
    return transition.unknownFindings.length > 0 ? 'unknown' : 'compatible'
  }

  const assignment = findAssignmentById(project.assignments, dragData.assignmentId)

  if (!assignment) return 'incompatible'

  const transition = moveAssignedComponent(project, assignment.id, targetHostId)

  if (!transition.ok) return 'incompatible'
  return transition.unknownFindings.length > 0 ? 'unknown' : 'compatible'
}

export type CanvasProjector = (point: CanvasPosition) => CanvasPosition
export type CanvasFocusOptions = Record<string, never>
export type CanvasController = {
  screenToFlowPosition: CanvasProjector
  getViewportZoom: () => number
  focusItem: (itemId: string, options?: CanvasFocusOptions) => void
  fitAll: () => void
}

export type WorkbenchCanvasProps = {
  project: ProjectState
  registryLinkedItemKeys: ReadonlySet<string>
  topologyData?: TopologyQueryData | null
  compatibleEndpointKeys?: ReadonlySet<string> | null
  agentStatus: AgentStatusSummary | null
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  spotlightItemId: string | null
  activeNetworkTraceConnectionIds: Array<string | number>
  activeNetworkTraceItemIds: string[]
  pendingEndpoint: ConnectionEndpoint | null
  draggingEndpoint: ConnectionEndpoint | null
  dropCompatibilityByHostId: Readonly<Record<string, CompatibilityStatus | undefined>>
  validationMessage: string | null
  validationSeverity?: ValidationMessageSeverity
  demoRemainingSeconds?: number | null
  canUndo: boolean
  canRedo: boolean
  saveStatus: 'saved' | 'saving' | 'error'
  canonicalMutationBusy: boolean
  canvasOperationLabel: string | null
  autoCenterOnSelect: boolean
  networkCablesVisible: boolean
  powerCablesVisible: boolean
  displayCablesVisible: boolean
  snapCablesToGrid: boolean
  avoidCableCollisionsGlobally: boolean
  snapItemsToGrid: boolean
  updateAvailable: boolean
  updateStatusLoading: boolean
  canViewNotifications: boolean
  notificationCount: number
  desktopInventoryVisible: boolean
  inspectorOpen: boolean
  onSelect: (itemId: string) => void
  onSelectConnection: (connectionId: string | number) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onMoveItem: (itemId: string, position: XYPosition) => Promise<boolean>
  onMoveItems: (placements: Array<{ serverId: string; x: number; y: number }>) => Promise<boolean>
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
  onUpdateConnectionRoute: (
    connectionId: string | number,
    route: ConnectionRoutePreferences,
  ) => void
  onResolveConnectionRouteSides: (changes: Array<{
    connectionId: number
    sourceSide: ConnectionRouteSide
    targetSide: ConnectionRouteSide
  }>) => Promise<void>
  onCanonicalizeConnectionRoutes: (changes: CableRouteCanonicalRepair[]) => Promise<void>
  onViewportReady: (canvasController: CanvasController) => void
  onCanvasClick: () => void
  onUndo: () => void
  onRedo: () => void
  onToggleAutoCenterOnSelect: () => void
  onAutoArrange: () => void
  onOpenAudit: () => void
  onOpenUpdate: () => void
  onOpenInventory: () => void
  onToggleNetworkCablesVisible: () => void
  onTogglePowerCablesVisible: () => void
  onToggleDisplayCablesVisible: () => void
  onOpenSettings: () => void
  onOpenNotifications: () => void
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}
