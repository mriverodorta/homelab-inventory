import { useEffect, useState, type RefObject } from 'react'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import { useSelectedTopology } from '@/app/use-selected-topology'
import type { CanvasController, CanvasFocusOptions } from '@/components/workbench-canvas-contract'
import type { ConnectionEndpoint, ProjectState } from '@/types/inventory'

type ExampleTarget =
  | { kind: 'item'; itemId: string }
  | { kind: 'connection'; itemId: string; connectionId: string | number }

type CanvasSelectionControllerOptions = {
  project: ProjectState | null
  projectRef: RefObject<ProjectState | null>
  topologyData: TopologyQueryData | null | undefined
  canvasControllerRef: RefObject<CanvasController | null>
  autoCenterOnSelect: boolean
  closeMobileInventory(): void
}

export function useCanvasSelectionController({
  project,
  projectRef,
  topologyData,
  canvasControllerRef,
  autoCenterOnSelect,
  closeMobileInventory,
}: CanvasSelectionControllerOptions) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | number | null>(null)
  const [spotlightItemId, setSpotlightItemId] = useState<string | null>(null)
  const [activeNetworkTraceEndpoint, setActiveNetworkTraceEndpoint] = useState<ConnectionEndpoint | null>(null)

  useEffect(() => {
    if (!spotlightItemId) return
    const spotlightTimer = window.setTimeout(() => setSpotlightItemId(null), 1500)
    return () => window.clearTimeout(spotlightTimer)
  }, [spotlightItemId])

  const topologySelection = useSelectedTopology({
    project,
    selectedItemId,
    selectedConnectionId,
    activeNetworkTraceEndpoint,
    topologyData: topologyData ?? undefined,
  })

  function getCanvasFocusItemId(itemId: string): string {
    const currentProject = projectRef.current
    if (!currentProject) return itemId
    if (currentProject.placements.some((placement) => placement.serverId === itemId)) return itemId
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

  function selectInventoryItem(itemId: string) {
    setSelectedItemId(itemId)
    setSelectedConnectionId(null)
    setActiveNetworkTraceEndpoint(null)
    closeMobileInventory()
  }

  function selectCanvasItem(itemId: string) {
    setSelectedItemId(itemId)
    setSelectedConnectionId(null)
    setActiveNetworkTraceEndpoint(null)
    focusCanvasItem(itemId)
  }

  function selectConnection(connectionId: string | number) {
    setSelectedConnectionId(connectionId)
    setSelectedItemId(null)
    setActiveNetworkTraceEndpoint(null)
  }

  function selectNetworkTrace(endpoint: ConnectionEndpoint) {
    setActiveNetworkTraceEndpoint(endpoint)
    setSelectedConnectionId(null)
  }

  function clearSelection() {
    setSelectedItemId(null)
    setSelectedConnectionId(null)
    setActiveNetworkTraceEndpoint(null)
  }

  function focusExampleTarget(target: ExampleTarget) {
    closeMobileInventory()
    if (target.kind === 'item') {
      setSelectedItemId(target.itemId)
      setSelectedConnectionId(null)
    } else {
      setSelectedItemId(null)
      setSelectedConnectionId(target.connectionId)
    }

    const focusItemId = getCanvasFocusItemId(target.itemId)
    window.requestAnimationFrame(() => canvasControllerRef.current?.focusItem(focusItemId))
    setSpotlightItemId(focusItemId)
  }

  return {
    selectedItemId,
    selectedConnectionId,
    spotlightItemId,
    activeNetworkTraceEndpoint,
    setSelectedItemId,
    setSelectedConnectionId,
    setActiveNetworkTraceEndpoint,
    focusCanvasItem,
    selectInventoryItem,
    selectCanvasItem,
    selectConnection,
    selectNetworkTrace,
    clearSelection,
    focusExampleTarget,
    ...topologySelection,
  }
}
