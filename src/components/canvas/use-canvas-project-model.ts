import { useMemo, useRef } from 'react'
import { createViewerIdSet } from '@homelab-inventory/viewer-model'
import type { TopologyQueryData } from '@/hooks/use-topology-query'
import { useCompatibilitySummary } from '@/hooks/use-compatibility-audit'
import { getFocusedCableItemIds } from '@/lib/cable-focus'
import { buildCanvasHandleIndex } from '@/lib/canvas-handle-index'
import {
  getAffectedCanvasItemIds,
  reconcileCanvasNodeProjectSnapshots,
  type CanvasNodeProjectSnapshots,
} from '@/lib/canvas-node-dependencies'
import { buildCanvasProjectIndex } from '@/lib/canvas-project-index'
import type { ProjectState } from '@/types/inventory'
import type { CompatibilityAuditHostSummary } from '@/types/compatibility-audit'

const EMPTY_COMPATIBILITY_HOSTS: readonly CompatibilityAuditHostSummary[] = []

export const createCanvasStringIdSet = createViewerIdSet

interface CanvasProjectModelOptions {
  enabled?: boolean
  project: ProjectState
  topologyData: TopologyQueryData | null
  compatibleEndpointKeys: ReadonlySet<string> | null
  selectedItemId: string | null
  selectedConnectionId: string | number | null
  activeNetworkTraceConnectionIds: Array<string | number>
  activeNetworkTraceItemIds: string[]
}

function useStableStringSet(values: readonly (string | number)[]): ReadonlySet<string> {
  const setRef = useRef<ReadonlySet<string>>(new Set())
  const nextValues = values.map(String)
  const currentSet = setRef.current

  if (
    currentSet.size !== nextValues.length
    || nextValues.some((value) => !currentSet.has(value))
  ) {
    setRef.current = createCanvasStringIdSet(nextValues)
  }

  return setRef.current
}

export function useCanvasProjectModel({
  enabled = true,
  project,
  topologyData,
  compatibleEndpointKeys,
  selectedItemId,
  selectedConnectionId,
  activeNetworkTraceConnectionIds,
  activeNetworkTraceItemIds,
}: CanvasProjectModelOptions) {
  const compatibilitySummary = useCompatibilitySummary(project.metadata.projectId ?? 1, enabled)
  const compatibilityHosts = compatibilitySummary.data?.hosts ?? EMPTY_COMPATIBILITY_HOSTS
  const nodeProjectTransitionRef = useRef<{
    project: ProjectState
    affectedItemIds: ReadonlySet<string>
    snapshots: CanvasNodeProjectSnapshots
  }>({
    project,
    affectedItemIds: new Set(project.placements.map((placement) => placement.serverId)),
    snapshots: new Map(project.placements.map((placement) => [placement.serverId, project])),
  })

  if (nodeProjectTransitionRef.current.project !== project) {
    const previousTransition = nodeProjectTransitionRef.current
    nodeProjectTransitionRef.current = {
      project,
      affectedItemIds: getAffectedCanvasItemIds(previousTransition.project, project),
      snapshots: reconcileCanvasNodeProjectSnapshots(
        previousTransition.project,
        project,
        previousTransition.snapshots,
      ),
    }
  }

  const nodeProjectTransition = nodeProjectTransitionRef.current
  const canvasIndexProjectRef = useRef(project)
  if (nodeProjectTransition.affectedItemIds.size > 0) {
    canvasIndexProjectRef.current = project
  }
  const canvasIndexProject = canvasIndexProjectRef.current

  const canvasGeometryProjectRef = useRef(project)
  const canvasGeometryProject = useMemo(() => {
    if (
      canvasGeometryProjectRef.current.items !== project.items
      || canvasGeometryProjectRef.current.assignments !== project.assignments
      || canvasGeometryProjectRef.current.placements !== project.placements
    ) {
      canvasGeometryProjectRef.current = project
    }
    return canvasGeometryProjectRef.current
  }, [project])

  const canvasRoutingProjectRef = useRef(project)
  const canvasRoutingProject = useMemo(() => {
    if (
      canvasRoutingProjectRef.current.items !== project.items
      || canvasRoutingProjectRef.current.assignments !== project.assignments
      || canvasRoutingProjectRef.current.connections !== project.connections
      || canvasRoutingProjectRef.current.placements !== project.placements
    ) {
      canvasRoutingProjectRef.current = project
    }
    return canvasRoutingProjectRef.current
  }, [project])

  const canvasIndex = useMemo(
    () => buildCanvasProjectIndex(
      canvasIndexProject,
      topologyData,
      compatibleEndpointKeys,
      compatibilityHosts,
    ),
    [canvasIndexProject, compatibilityHosts, compatibleEndpointKeys, topologyData],
  )
  const canvasHandleIndex = useMemo(
    () => buildCanvasHandleIndex(canvasRoutingProject),
    [canvasRoutingProject],
  )
  const nodeIndexCacheRef = useRef(new WeakMap<ProjectState, {
    topologyData: TopologyQueryData | null
    compatibleEndpointKeys: ReadonlySet<string> | null
    index: ReturnType<typeof buildCanvasProjectIndex>
  }>())
  const nodeCanvasIndexes = useMemo(() => {
    const indexes = new Map<string, ReturnType<typeof buildCanvasProjectIndex>>()

    for (const [itemId, nodeProject] of nodeProjectTransition.snapshots) {
      const cached = nodeIndexCacheRef.current.get(nodeProject)
      if (
        cached
        && cached.topologyData === topologyData
        && cached.compatibleEndpointKeys === compatibleEndpointKeys
      ) {
        indexes.set(itemId, cached.index)
        continue
      }

      const index = buildCanvasProjectIndex(nodeProject, topologyData, compatibleEndpointKeys, compatibilityHosts)
      nodeIndexCacheRef.current.set(nodeProject, {
        topologyData,
        compatibleEndpointKeys,
        index,
      })
      indexes.set(itemId, index)
    }

    return indexes
  }, [compatibilityHosts, compatibleEndpointKeys, nodeProjectTransition.snapshots, topologyData])
  const auditWarningCount = useMemo(
    () => [...canvasIndex.auditWarningCountByItemId.values()].reduce((count, value) => count + value, 0),
    [canvasIndex],
  )
  const focusedItemIds = useMemo(
    () => [
      ...new Set([
        ...getFocusedCableItemIds(canvasRoutingProject, selectedItemId, selectedConnectionId),
        ...activeNetworkTraceItemIds,
      ]),
    ],
    [activeNetworkTraceItemIds, canvasRoutingProject, selectedConnectionId, selectedItemId],
  )
  const focusedItemIdSet = useStableStringSet(focusedItemIds)
  const activeNetworkTraceConnectionIdSet = useStableStringSet(activeNetworkTraceConnectionIds)

  return {
    affectedItemIds: nodeProjectTransition.affectedItemIds,
    nodeProjectSnapshots: nodeProjectTransition.snapshots,
    canvasGeometryProject,
    canvasRoutingProject,
    canvasIndex,
    canvasHandleIndex,
    nodeCanvasIndexes,
    auditWarningCount,
    focusedItemIdSet,
    focusActive: focusedItemIds.length > 0,
    activeNetworkTraceConnectionIdSet,
  }
}
