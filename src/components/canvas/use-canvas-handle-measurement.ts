import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStoreApi, useUpdateNodeInternals } from '@xyflow/react'
import type { CableFlowEdge } from '@/components/cable-edge'
import type { ProjectState } from '@/types/inventory'
import {
  getChangedCanvasHandleItemIds,
  type CanvasHandleIndex,
} from '@/lib/canvas-handle-index'
import {
  normalizeCanvasHandleGeometry,
  reconcileCanvasHandleGeometry,
  type CanvasNodeHandleGeometry,
  type MeasuredHandleNode,
} from '@/lib/canvas-handle-geometry'
import {
  getCanvasNodeId,
  type WorkbenchFlowNode,
} from '@/components/canvas/flow-reconciliation'

type UseCanvasHandleMeasurementOptions = {
  project: ProjectState
  flowNodes: WorkbenchFlowNode[]
  canvasHandleIndex: CanvasHandleIndex
  affectedItemIds: ReadonlySet<string>
}

export function useCanvasHandleMeasurement({
  project,
  flowNodes,
  canvasHandleIndex,
  affectedItemIds,
}: UseCanvasHandleMeasurementOptions) {
  const flowStore = useStoreApi<WorkbenchFlowNode, CableFlowEdge>()
  const updateNodeInternals = useUpdateNodeInternals()
  const [measuredHandleGeometry, setMeasuredHandleGeometry] = useState<CanvasNodeHandleGeometry[]>([])
  const measuredHandleGeometryRef = useRef<CanvasNodeHandleGeometry[]>([])
  const measuredProjectRef = useRef<ProjectState | null>(null)
  const measurementPassRef = useRef(0)
  const [forceRenderAllNodes, setForceRenderAllNodes] = useState(false)
  const [, setMeasurementEpoch] = useState(0)
  const previousCanvasHandleIndexRef = useRef<CanvasHandleIndex>(new Map())

  if (
    measuredProjectRef.current !== null
    && affectedItemIds.size === 0
    && measuredProjectRef.current !== project
  ) {
    measuredProjectRef.current = project
  }

  const requiredHandlesByNodeId = useMemo(
    () => new Map(flowNodes.map((node) => [node.id, node.data.requiredHandleIds])),
    [flowNodes],
  )
  const requiredHandlesByNodeIdRef = useRef(requiredHandlesByNodeId)
  requiredHandlesByNodeIdRef.current = requiredHandlesByNodeId

  const syncMeasuredHandleGeometry = useCallback(() => {
    const nextGeometry = reconcileCanvasHandleGeometry(
      measuredHandleGeometryRef.current,
      normalizeCanvasHandleGeometry(
        flowStore.getState().nodeLookup.values() as Iterable<MeasuredHandleNode>,
      ),
      requiredHandlesByNodeIdRef.current,
    )

    if (nextGeometry === measuredHandleGeometryRef.current) return

    measuredHandleGeometryRef.current = nextGeometry
    setMeasuredHandleGeometry(nextGeometry)
  }, [flowStore])

  useEffect(() => {
    let frame: number | null = null
    const scheduleGeometrySync = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        syncMeasuredHandleGeometry()
      })
    }
    const unsubscribe = flowStore.subscribe((state, previousState) => {
      if (state.nodes === previousState.nodes && state.nodeLookup === previousState.nodeLookup) {
        return
      }

      scheduleGeometrySync()
    })

    scheduleGeometrySync()
    return () => {
      unsubscribe()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [flowStore, syncMeasuredHandleGeometry])

  useEffect(() => {
    const placedItemIds = new Set(project.placements.map((placement) => placement.serverId))
    const initialMeasurement = measuredProjectRef.current === null
    const changedHandleItemIds = getChangedCanvasHandleItemIds(
      previousCanvasHandleIndexRef.current,
      canvasHandleIndex,
    )
    previousCanvasHandleIndexRef.current = canvasHandleIndex
    const changedItemIds = new Set([...affectedItemIds, ...changedHandleItemIds])
    const changedNodeIds = initialMeasurement
      ? project.placements.flatMap((placement) => {
          const item = project.items[placement.serverId]
          return item ? [getCanvasNodeId(item)] : []
        })
      : [...changedItemIds].flatMap((itemId) => {
          const item = project.items[itemId]
          return item && placedItemIds.has(itemId) ? [getCanvasNodeId(item)] : []
        })
    if (measuredProjectRef.current === project) return

    if (changedNodeIds.length === 0) {
      measuredProjectRef.current = project
      setMeasurementEpoch((current) => current + 1)
      return
    }

    const measurementPass = ++measurementPassRef.current
    let internalsFrame: number | null = null
    let syncFrame: number | null = null
    let finishFrame: number | null = null
    setForceRenderAllNodes(true)
    internalsFrame = window.requestAnimationFrame(() => {
      updateNodeInternals(changedNodeIds)
      syncFrame = window.requestAnimationFrame(() => {
        syncMeasuredHandleGeometry()
        finishFrame = window.requestAnimationFrame(() => {
          if (measurementPassRef.current !== measurementPass) return
          measuredProjectRef.current = project
          setForceRenderAllNodes(false)
          setMeasurementEpoch((current) => current + 1)
        })
      })
    })

    return () => {
      if (internalsFrame !== null) window.cancelAnimationFrame(internalsFrame)
      if (syncFrame !== null) window.cancelAnimationFrame(syncFrame)
      if (finishFrame !== null) window.cancelAnimationFrame(finishFrame)
    }
  }, [
    affectedItemIds,
    canvasHandleIndex,
    project,
    project.items,
    project.placements,
    syncMeasuredHandleGeometry,
    updateNodeInternals,
  ])

  return {
    measuredHandleGeometry,
    forceRenderAllNodes,
    geometryMeasurementPending: measuredProjectRef.current !== project,
  }
}
