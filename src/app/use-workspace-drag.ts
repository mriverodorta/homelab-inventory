import { useMemo, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import type { CanvasController, ComponentDragData } from '@/components/workbench-canvas-contract'
import type { ProjectState } from '@/types/inventory'
import { findAssignmentById, moveAssignedComponent, tryAssignComponent } from '@/lib/constraints'
import { runtimeItemKey } from '@/lib/item-keys'
import { isCanvasItem } from '@/lib/project'
import {
  getCanvasDropPoint,
  getServerIdFromOver,
  parseMemorySlotOver,
} from '@/app/project-drop-helpers'
import {
  getComponentDropCompatibilityStatus,
} from '@/components/workbench-canvas-contract'
import { isInventoryDragOverCanvas } from '@/lib/inventory-drag-preview'

type PlacementValidation = { valid: boolean } | null

type WorkspaceDragOptions = {
  project: ProjectState | null
  canvasControllerRef: MutableRefObject<CanvasController | null>
  snapItemsToGrid: boolean
  setMobileInventoryOpen: (open: boolean) => void
  setSelectedItemId: (itemId: string | null) => void
  setSelectedConnectionId: (connectionId: string | number | null) => void
  setValidationMessage: (message: string | null) => void
  showMessage: (message: string) => void
  showCompatibilityUnknownMessage: (
    action: 'Assigned' | 'Moved',
    itemName: string,
    findings: { message: string }[],
  ) => void
  focusCanvasItem: (itemId: string) => void
  validateCanvasPlacement: (
    project: ProjectState,
    placement: ProjectState['placements'][number],
  ) => Promise<PlacementValidation>
  validateCanvasGroupMove: (
    project: ProjectState,
    placements: ProjectState['placements'],
  ) => Promise<PlacementValidation>
  commitPlacementUpdates: (
    placements: ProjectState['placements'],
    fallbackMessage?: string,
  ) => Promise<boolean>
  commitAssignmentUpdate: (
    previousProject: ProjectState,
    nextProject: ProjectState,
    fallbackMessage: string,
  ) => Promise<boolean>
}

export function useWorkspaceDrag({
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
}: WorkspaceDragOptions) {
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [activeComponentDragData, setActiveComponentDragData] = useState<ComponentDragData | null>(null)
  const [dragOverHostId, setDragOverHostId] = useState<string | null>(null)
  const [dragPreviewOverCanvas, setDragPreviewOverCanvas] = useState(false)
  const [dragPreviewZoom, setDragPreviewZoom] = useState(1)

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
    const memorySlot = parseMemorySlotOver(overId)

    if (!serverId) {
      showMessage('Drop components onto a compatible host.')
      return
    }

    if (data.kind === 'assigned-component') {
      const result = moveAssignedComponent(project, data.assignmentId, serverId, memorySlot?.position)

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

    const result = tryAssignComponent(project, serverId, data.itemId, memorySlot?.position)

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


  const cancelDrag = () => {
    setDraggingItemId(null)
    setActiveComponentDragData(null)
    setDragOverHostId(null)
    setDragPreviewOverCanvas(false)
    setDragPreviewZoom(1)
  }

  const dropCompatibilityByHostId = useMemo(() => {
    if (!project || !activeComponentDragData || !dragOverHostId) return {}

    const status = getComponentDropCompatibilityStatus(
      project,
      activeComponentDragData,
      dragOverHostId,
    )
    return status ? { [dragOverHostId]: status } : {}
  }, [activeComponentDragData, dragOverHostId, project])

  return {
    draggingItemId,
    dragPreviewOverCanvas,
    dragPreviewZoom,
    dropCompatibilityByHostId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    cancelDrag,
  }
}
