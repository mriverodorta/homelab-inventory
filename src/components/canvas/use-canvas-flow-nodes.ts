import { useMemo } from 'react'
import type { CanvasPortDragPoint } from '@/types/canvas'
import type { AgentStatusSummary } from '@/types/agent'
import type { CompatibilityStatus } from '@/types/compatibility'
import type { ConnectionEndpoint, ProjectState } from '@/types/inventory'
import type { EquipmentFlowNode } from '@/components/equipment-card'
import type { MonitorFlowNode } from '@/components/monitor-card'
import type { NasFlowNode } from '@/components/nas-card'
import type { PcBuildFlowNode } from '@/components/pc-build-card'
import type { PowerStripFlowNode } from '@/components/power-strip-card'
import type { ServerFlowNode } from '@/components/server-card'
import type { UpsFlowNode } from '@/components/ups-card'
import { getRequiredCanvasHandles, type CanvasHandleIndex } from '@/lib/canvas-handle-index'
import { buildCanvasProjectIndex } from '@/lib/canvas-project-index'
import {
  CANVAS_NODE_ACTIVE_Z_INDEX,
  CANVAS_NODE_BASE_Z_INDEX,
} from '@/lib/cable-render-stability'
import { endpointBelongsToItem, type WorkbenchFlowNode } from '@/components/canvas/flow-reconciliation'
import type { CanvasNodeProjectSnapshots } from '@/lib/canvas-node-dependencies'

const EMPTY_FOCUSED_ITEM_IDS: string[] = []

type CanvasFlowNodesOptions = {
  project: ProjectState
  registryLinkedItemKeys: ReadonlySet<string>
  canvasIndex: ReturnType<typeof buildCanvasProjectIndex>
  nodeCanvasIndexes: ReadonlyMap<string, ReturnType<typeof buildCanvasProjectIndex>>
  nodeProjectSnapshots: CanvasNodeProjectSnapshots
  canvasHandleIndex: CanvasHandleIndex
  agentStatus: AgentStatusSummary | null
  selectedItemId: string | null
  focusedItemIdSet: ReadonlySet<string>
  focusActive: boolean
  spotlightItemId: string | null
  pendingEndpoint: ConnectionEndpoint | null
  draggingEndpoint: ConnectionEndpoint | null
  dropCompatibilityByHostId: Readonly<Record<string, CompatibilityStatus | undefined>>
  onSelect: (itemId: string) => void
  onRemoveAssignment: (assignmentId: string | number) => void
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
}

export function useCanvasFlowNodes({
  project,
  registryLinkedItemKeys,
  canvasIndex,
  nodeCanvasIndexes,
  nodeProjectSnapshots,
  canvasHandleIndex,
  agentStatus,
  selectedItemId,
  focusedItemIdSet,
  focusActive,
  spotlightItemId,
  pendingEndpoint,
  draggingEndpoint,
  dropCompatibilityByHostId,
  onSelect: stableOnSelect,
  onRemoveAssignment: stableOnRemoveAssignment,
  onEndpointClick: stableOnEndpointClick,
  onEndpointDragStart: stableOnEndpointDragStart,
  onEndpointDrop: stableOnEndpointDrop,
}: CanvasFlowNodesOptions) {
  return useMemo<WorkbenchFlowNode[]>(
    () => {
      const nextNodes: WorkbenchFlowNode[] = []

      for (const placement of project.placements) {
        const nodeProject = nodeProjectSnapshots.get(placement.serverId)
        if (!nodeProject) continue
        const nodeCanvasIndex = nodeCanvasIndexes.get(placement.serverId) ?? canvasIndex
        const item = nodeProject.items[placement.serverId] ?? project.items[placement.serverId]

        if (!item) {
          continue
        }

        const selectedBelongsToNode = selectedItemId === placement.serverId ||
          (selectedItemId != null && canvasIndex.assignedHostByItemId.get(selectedItemId) === placement.serverId)
        const nodeSelectedItemId = selectedBelongsToNode ? selectedItemId : null
        const nodeFocusedItemIds = focusedItemIdSet.has(placement.serverId)
          ? [placement.serverId]
          : EMPTY_FOCUSED_ITEM_IDS
        const nodeSpotlightItemId = spotlightItemId === placement.serverId ? spotlightItemId : null
        const nodePendingEndpoint = endpointBelongsToItem(pendingEndpoint, placement.serverId)
          ? pendingEndpoint
          : null

        if (item.type === 'server') {
          const nodeActive = selectedItemId === placement.serverId ||
            endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
            endpointBelongsToItem(draggingEndpoint, placement.serverId)
          const node: ServerFlowNode = {
            id: `server-node:${placement.serverId}`,
            type: 'server',
            position: {
              x: placement.x,
              y: placement.y,
            },
            zIndex: nodeActive ? CANVAS_NODE_ACTIVE_Z_INDEX : CANVAS_NODE_BASE_Z_INDEX,
            dragHandle: '.server-node-drag-handle',
            data: {
              project: nodeProject,
              registryLinkedItemKeys,
              canvasIndex: nodeCanvasIndex,
              requiredHandleIds: getRequiredCanvasHandles(canvasHandleIndex, placement.serverId),
              agentStatus,
              serverId: placement.serverId,
              selectedItemId: nodeSelectedItemId,
              focusedItemIds: nodeFocusedItemIds,
              focusActive,
              spotlightItemId: nodeSpotlightItemId,
              pendingEndpoint: nodePendingEndpoint,
              draggingEndpoint,
              dropCompatibilityStatus: dropCompatibilityByHostId[placement.serverId],
              onSelect: stableOnSelect,
              onRemoveAssignment: stableOnRemoveAssignment,
              onEndpointClick: stableOnEndpointClick,
              onEndpointDragStart: stableOnEndpointDragStart,
              onEndpointDrop: stableOnEndpointDrop,
            },
          }

          nextNodes.push(node)
          continue
        }

        if (item.type === 'nas') {
          const nodeActive = selectedItemId === placement.serverId ||
            endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
            endpointBelongsToItem(draggingEndpoint, placement.serverId)
          const node: NasFlowNode = {
            id: `nas-node:${placement.serverId}`,
            type: 'nas',
            position: {
              x: placement.x,
              y: placement.y,
            },
            zIndex: nodeActive ? CANVAS_NODE_ACTIVE_Z_INDEX : CANVAS_NODE_BASE_Z_INDEX,
            dragHandle: '.server-node-drag-handle',
            data: {
              project: nodeProject,
              registryLinkedItemKeys,
              canvasIndex: nodeCanvasIndex,
              requiredHandleIds: getRequiredCanvasHandles(canvasHandleIndex, placement.serverId),
              itemId: placement.serverId,
              selectedItemId: nodeSelectedItemId,
              focusedItemIds: nodeFocusedItemIds,
              focusActive,
              spotlightItemId: nodeSpotlightItemId,
              pendingEndpoint: nodePendingEndpoint,
              draggingEndpoint,
              dropCompatibilityStatus: dropCompatibilityByHostId[placement.serverId],
              onSelect: stableOnSelect,
              onRemoveAssignment: stableOnRemoveAssignment,
              onEndpointClick: stableOnEndpointClick,
              onEndpointDragStart: stableOnEndpointDragStart,
              onEndpointDrop: stableOnEndpointDrop,
            },
          }

          nextNodes.push(node)
          continue
        }

        if (item.type === 'pcBuild') {
          const nodeActive = selectedItemId === placement.serverId ||
            endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
            endpointBelongsToItem(draggingEndpoint, placement.serverId)
          const node: PcBuildFlowNode = {
            id: `pc-build-node:${placement.serverId}`,
            type: 'pcBuild',
            position: {
              x: placement.x,
              y: placement.y,
            },
            zIndex: nodeActive ? CANVAS_NODE_ACTIVE_Z_INDEX : CANVAS_NODE_BASE_Z_INDEX,
            dragHandle: '.server-node-drag-handle',
            data: {
              project: nodeProject,
              registryLinkedItemKeys,
              canvasIndex: nodeCanvasIndex,
              requiredHandleIds: getRequiredCanvasHandles(canvasHandleIndex, placement.serverId),
              pcBuildId: placement.serverId,
              selectedItemId: nodeSelectedItemId,
              focusedItemIds: nodeFocusedItemIds,
              focusActive,
              spotlightItemId: nodeSpotlightItemId,
              pendingEndpoint: nodePendingEndpoint,
              draggingEndpoint,
              dropCompatibilityStatus: dropCompatibilityByHostId[placement.serverId],
              onSelect: stableOnSelect,
              onRemoveAssignment: stableOnRemoveAssignment,
              onEndpointClick: stableOnEndpointClick,
              onEndpointDragStart: stableOnEndpointDragStart,
              onEndpointDrop: stableOnEndpointDrop,
            },
          }

          nextNodes.push(node)
          continue
        }

        const standaloneData = {
          project: nodeProject,
          registryLinkedItemKeys,
          canvasIndex: nodeCanvasIndex,
          requiredHandleIds: getRequiredCanvasHandles(canvasHandleIndex, placement.serverId),
          itemId: placement.serverId,
          selectedItemId: nodeSelectedItemId,
          focusedItemIds: nodeFocusedItemIds,
          focusActive,
          spotlightItemId: nodeSpotlightItemId,
          pendingEndpoint: nodePendingEndpoint,
          draggingEndpoint,
          onSelect: stableOnSelect,
          onEndpointClick: stableOnEndpointClick,
          onEndpointDragStart: stableOnEndpointDragStart,
          onEndpointDrop: stableOnEndpointDrop,
        }
        const standaloneNodeBase = {
          position: {
            x: placement.x,
            y: placement.y,
          },
          zIndex: selectedItemId === placement.serverId ||
            endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
            endpointBelongsToItem(draggingEndpoint, placement.serverId)
            ? CANVAS_NODE_ACTIVE_Z_INDEX
            : CANVAS_NODE_BASE_Z_INDEX,
          dragHandle: '.server-node-drag-handle',
        }

        if (item.type === 'monitor') {
          nextNodes.push({
            ...standaloneNodeBase,
            id: `monitor-node:${placement.serverId}`,
            type: 'monitor',
            data: standaloneData,
          } satisfies MonitorFlowNode)
          continue
        }

        if (item.type === 'ups') {
          nextNodes.push({
            ...standaloneNodeBase,
            id: `ups-node:${placement.serverId}`,
            type: 'ups',
            data: standaloneData,
          } satisfies UpsFlowNode)
          continue
        }

        if (item.type === 'powerStrip') {
          nextNodes.push({
            ...standaloneNodeBase,
            id: `powerStrip-node:${placement.serverId}`,
            type: 'powerStrip',
            data: standaloneData,
          } satisfies PowerStripFlowNode)
          continue
        }

        const nodeActive = selectedItemId === placement.serverId ||
          endpointBelongsToItem(pendingEndpoint, placement.serverId) ||
          endpointBelongsToItem(draggingEndpoint, placement.serverId)
        const node: EquipmentFlowNode = {
          id: `equipment-node:${placement.serverId}`,
          type: 'equipment',
          position: {
            x: placement.x,
            y: placement.y,
          },
          zIndex: nodeActive ? CANVAS_NODE_ACTIVE_Z_INDEX : CANVAS_NODE_BASE_Z_INDEX,
          dragHandle: '.server-node-drag-handle',
          data: {
            project: nodeProject,
            registryLinkedItemKeys,
            canvasIndex: nodeCanvasIndex,
            requiredHandleIds: getRequiredCanvasHandles(canvasHandleIndex, placement.serverId),
            itemId: placement.serverId,
            selectedItemId: nodeSelectedItemId,
            focusedItemIds: nodeFocusedItemIds,
            focusActive,
            spotlightItemId: nodeSpotlightItemId,
            pendingEndpoint: nodePendingEndpoint,
            draggingEndpoint,
            onSelect: stableOnSelect,
            onEndpointClick: stableOnEndpointClick,
            onEndpointDragStart: stableOnEndpointDragStart,
            onEndpointDrop: stableOnEndpointDrop,
          },
        }

        nextNodes.push(node)
      }

      return nextNodes
    },
    [
      draggingEndpoint,
      canvasHandleIndex,
      canvasIndex,
      nodeCanvasIndexes,
      nodeProjectSnapshots,
      dropCompatibilityByHostId,
      agentStatus,
      focusActive,
      focusedItemIdSet,
      pendingEndpoint,
      project.items,
      project.placements,
      registryLinkedItemKeys,
      selectedItemId,
      spotlightItemId,
      stableOnEndpointClick,
      stableOnEndpointDragStart,
      stableOnEndpointDrop,
      stableOnRemoveAssignment,
      stableOnSelect,
    ],
  )
}
