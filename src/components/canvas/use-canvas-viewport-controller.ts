import type { ReactFlowInstance, Viewport } from '@xyflow/react'
import { useCallback, useEffect, type RefObject } from 'react'
import type { CableFlowEdge } from '@/components/cable-edge'
import type {
  CanvasController,
  CanvasFocusOptions,
} from '@/components/workbench-canvas-contract'
import { getCanvasNodeId, type WorkbenchFlowNode } from '@/components/canvas/flow-reconciliation'
import { getCanvasItemHeight, getCanvasItemWidth } from '@/lib/project'
import type { ProjectState } from '@/types/inventory'

const INSPECTOR_DRAWER_SELECTOR = '[data-testid="inspector-drawer"]'
const FOCUS_MARGIN = 72

type CanvasViewportApi = Pick<
  ReactFlowInstance<WorkbenchFlowNode, CableFlowEdge>,
  'fitView' | 'getViewport' | 'screenToFlowPosition' | 'setViewport'
>

type UseCanvasViewportControllerOptions = {
  project: ProjectState
  canvasRootRef: RefObject<HTMLElement | null>
  viewportApi: CanvasViewportApi
  onViewportReady: (canvasController: CanvasController) => void
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

export function useCanvasViewportController({
  project,
  canvasRootRef,
  viewportApi,
  onViewportReady,
}: UseCanvasViewportControllerOptions) {
  const { fitView, getViewport, screenToFlowPosition, setViewport } = viewportApi

  const correctFocusViewport = useCallback(
    (placedItemId: string) => {
      const rootRect = canvasRootRef.current?.getBoundingClientRect()
      const item = project.items[placedItemId]

      if (!rootRect || !item) return

      const nodeElement = document.querySelector(
        `[data-testid="rf__node-${getCanvasNodeId(item)}"]`,
      )
      const rectangles = [nodeElement]
        .filter((element): element is Element => Boolean(element))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)

      if (rectangles.length === 0) return

      const drawer = document.querySelector(INSPECTOR_DRAWER_SELECTOR)
      const drawerRect = drawer?.getAttribute('aria-hidden') === 'true'
        ? null
        : drawer?.getBoundingClientRect()
      const visibleRight = drawerRect
        ? Math.max(rootRect.left, Math.min(rootRect.right, drawerRect.left))
        : rootRect.right
      const bounds = {
        left: Math.min(...rectangles.map((rect) => rect.left)),
        right: Math.max(...rectangles.map((rect) => rect.right)),
        top: Math.min(...rectangles.map((rect) => rect.top)),
        bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
      }
      const viewport = getViewport()
      const horizontalMargin = 24
      const verticalMargin = 28
      const availableWidth = visibleRight - rootRect.left
      const boundsWidth = bounds.right - bounds.left
      const canFitHorizontally = boundsWidth <= availableWidth - horizontalMargin * 2
      let nextX = viewport.x
      let nextY = viewport.y

      if (bounds.right > visibleRight - horizontalMargin) {
        nextX -= bounds.right - (visibleRight - horizontalMargin)
      }

      if (canFitHorizontally && bounds.left < rootRect.left + horizontalMargin) {
        nextX += rootRect.left + horizontalMargin - bounds.left
      }

      if (bounds.bottom > rootRect.bottom - verticalMargin) {
        nextY -= bounds.bottom - (rootRect.bottom - verticalMargin)
      }

      if (bounds.top < rootRect.top + verticalMargin) {
        nextY += rootRect.top + verticalMargin - bounds.top
      }

      if (Math.abs(nextX - viewport.x) <= 1 && Math.abs(nextY - viewport.y) <= 1) return

      void setViewport({ ...viewport, x: nextX, y: nextY }, { duration: 220 })
    },
    [canvasRootRef, getViewport, project.items, setViewport],
  )

  const focusItem = useCallback(
    (itemId: string, _options: CanvasFocusOptions = {}) => {
      const placedItemId = project.placements.some((candidate) => candidate.serverId === itemId)
        ? itemId
        : project.assignments.find((assignment) => assignment.itemId === itemId)?.serverId ?? itemId
      const placement = project.placements.find((candidate) => candidate.serverId === placedItemId)
      const rootRect = canvasRootRef.current?.getBoundingClientRect()

      if (!placement || !rootRect) return

      const focusWidth = getCanvasItemWidth(project, placedItemId)
      const focusHeight = getCanvasItemHeight(project, placedItemId)
      const drawer = document.querySelector(INSPECTOR_DRAWER_SELECTOR)
      const drawerRect = drawer?.getAttribute('aria-hidden') === 'true'
        ? null
        : drawer?.getBoundingClientRect()
      const visibleRight = drawerRect
        ? Math.max(rootRect.left, Math.min(rootRect.right, drawerRect.left))
        : rootRect.right
      const availableWidth = Math.max(280, visibleRight - rootRect.left)
      const availableHeight = Math.max(280, rootRect.height)
      const zoom = clamp(
        Math.min(
          0.95,
          (availableWidth - FOCUS_MARGIN) / focusWidth,
          (availableHeight - FOCUS_MARGIN) / focusHeight,
        ),
        0.25,
        0.95,
      )
      const focusCenter = {
        x: placement.x + focusWidth / 2,
        y: placement.y + focusHeight / 2,
      }
      const viewport: Viewport = {
        x: availableWidth / 2 - focusCenter.x * zoom,
        y: availableHeight / 2 - focusCenter.y * zoom,
        zoom,
      }

      void setViewport(viewport, { duration: 500 })
      window.setTimeout(() => correctFocusViewport(placedItemId), 80)
      window.setTimeout(() => correctFocusViewport(placedItemId), 560)
    },
    [canvasRootRef, correctFocusViewport, project, setViewport],
  )

  useEffect(() => {
    onViewportReady({
      screenToFlowPosition,
      getViewportZoom: () => getViewport().zoom,
      focusItem,
      fitAll: () => {
        void fitView({
          padding: { top: '12%', right: '6%', bottom: '12%', left: '30%' },
          duration: 500,
        })
      },
    })
  }, [fitView, focusItem, getViewport, onViewportReady, screenToFlowPosition])
}
