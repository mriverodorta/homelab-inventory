import type { Dispatch, SetStateAction } from 'react'
import type { OnNodeDrag } from '@xyflow/react'
import { snapToGrid } from '@/components/workbench-canvas-contract'
import {
  getItemIdFromNodeId,
  type WorkbenchFlowNode,
} from '@/components/canvas/flow-reconciliation'

type UseCanvasNodeDragOptions = {
  flowNodes: WorkbenchFlowNode[]
  setNodes: Dispatch<SetStateAction<WorkbenchFlowNode[]>>
  snapItemsToGrid: boolean
  resetTouchNodeDragGate(): void
  onMoveItem(itemId: string, position: { x: number; y: number }): Promise<boolean>
  onMoveItems(placements: Array<{ serverId: string; x: number; y: number }>): Promise<boolean>
}

export function useCanvasNodeDrag({
  flowNodes,
  setNodes,
  snapItemsToGrid,
  resetTouchNodeDragGate,
  onMoveItem,
  onMoveItems,
}: UseCanvasNodeDragOptions) {
  const handleNodeDragStop: OnNodeDrag<WorkbenchFlowNode> = async (_, node, draggedNodes) => {
    resetTouchNodeDragGate()

    const activeNodes = draggedNodes.length > 0 ? draggedNodes : [node]
    const movedPlacements = activeNodes.map((activeNode) => ({
      serverId: getItemIdFromNodeId(activeNode.id),
      x: snapItemsToGrid ? snapToGrid(activeNode.position.x) : activeNode.position.x,
      y: snapItemsToGrid ? snapToGrid(activeNode.position.y) : activeNode.position.y,
    }))
    const wasMoved = await (movedPlacements.length === 1
      ? onMoveItem(movedPlacements[0].serverId, {
          x: movedPlacements[0].x,
          y: movedPlacements[0].y,
        })
      : onMoveItems(movedPlacements))
    const movedPlacementMap = new Map(
      movedPlacements.map((placement) => [placement.serverId, placement]),
    )
    const savedPositionMap = new Map(
      flowNodes.map((currentNode) => [currentNode.id, currentNode.position]),
    )

    setNodes((currentNodes) => currentNodes.map((currentNode) => {
      const itemId = getItemIdFromNodeId(currentNode.id)
      const movedPlacement = movedPlacementMap.get(itemId)

      if (!movedPlacement) return currentNode

      return {
        ...currentNode,
        position: wasMoved
          ? { x: movedPlacement.x, y: movedPlacement.y }
          : savedPositionMap.get(currentNode.id) ?? currentNode.position,
      }
    }))
  }

  return handleNodeDragStop
}
