import { useCallback } from 'react'
import { snapToGrid, type CanvasPosition } from '@/components/workbench-canvas-contract'
import { arrangeProjectItems } from '@/engine/geometry'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import type { ProjectState, ServerPlacement } from '@/types/inventory'

interface PlacementCheck {
  valid: boolean
}

interface CanvasWorkspaceActionsOptions {
  project: ProjectState | null
  snapItemsToGrid: boolean
  validatePlacement(project: ProjectState, placement: ServerPlacement): Promise<PlacementCheck | null>
  validateGroupMove(project: ProjectState, placements: ServerPlacement[]): Promise<PlacementCheck | null>
  commitPlacements(placements: ServerPlacement[], fallbackMessage?: string): Promise<boolean>
  showMessage(message: string): void
  setOperationLabel(label: string | null): void
}

export function useCanvasWorkspaceActions({
  project,
  snapItemsToGrid,
  validatePlacement,
  validateGroupMove,
  commitPlacements,
  showMessage,
  setOperationLabel,
}: CanvasWorkspaceActionsOptions) {
  const domainEngine = useDomainEngine()
  const normalizePlacement = useCallback((placement: ServerPlacement): ServerPlacement => ({
    serverId: placement.serverId,
    x: snapItemsToGrid ? snapToGrid(placement.x) : placement.x,
    y: snapItemsToGrid ? snapToGrid(placement.y) : placement.y,
  }), [snapItemsToGrid])

  const moveItem = useCallback(async (itemId: string, position: CanvasPosition) => {
    if (!project) return false
    const placement = normalizePlacement({ serverId: itemId, ...position })
    const placementCheck = await validatePlacement(project, placement)

    if (!placementCheck) return false
    if (!placementCheck.valid) {
      showMessage('Canvas equipment cannot overlap. Move this item to an open space.')
      return false
    }

    return commitPlacements([placement])
  }, [commitPlacements, normalizePlacement, project, showMessage, validatePlacement])

  const moveItems = useCallback(async (placements: ServerPlacement[]) => {
    if (!project) return false
    const nextPlacements = placements.map(normalizePlacement)
    const placementCheck = await validateGroupMove(project, nextPlacements)

    if (!placementCheck) return false
    if (!placementCheck.valid) {
      showMessage('Canvas equipment cannot overlap. Move this group to an open space.')
      return false
    }

    return commitPlacements(nextPlacements)
  }, [commitPlacements, normalizePlacement, project, showMessage, validateGroupMove])

  const autoArrange = useCallback(() => {
    if (!project) return
    if (project.placements.length === 0) {
      showMessage('Drag equipment onto the canvas before arranging.')
      return
    }

    setOperationLabel('Arranging canvas')
    void arrangeProjectItems(domainEngine.client, project)
      .then(async (placements) => {
        await commitPlacements(placements, 'Canvas items could not be arranged.')
      })
      .catch((error) => {
        showMessage(error instanceof Error ? error.message : 'Canvas items could not be arranged.')
      })
      .finally(() => setOperationLabel(null))
  }, [commitPlacements, domainEngine, project, setOperationLabel, showMessage])

  return { moveItem, moveItems, autoArrange }
}
