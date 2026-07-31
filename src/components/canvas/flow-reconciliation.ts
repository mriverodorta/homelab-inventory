import type { CableFlowEdge } from '@/components/cable-edge'
import type { EquipmentFlowNode } from '@/components/equipment-card'
import type { MonitorFlowNode } from '@/components/monitor-card'
import type { NasFlowNode } from '@/components/nas-card'
import type { PcBuildFlowNode } from '@/components/pc-build-card'
import type { PowerStripFlowNode } from '@/components/power-strip-card'
import type { ServerFlowNode } from '@/components/server-card'
import type { UpsFlowNode } from '@/components/ups-card'
import type { CanvasNodeHandleGeometry } from '@/lib/canvas-handle-geometry'
import {
  preserveCanvasNodeRuntimeState,
} from '@/lib/cable-render-stability'
import { runtimeItemKey } from '@/lib/item-keys'
import type { ConnectionEndpoint, InventoryItem, ProjectState } from '@/types/inventory'

export type WorkbenchFlowNode =
  | ServerFlowNode
  | EquipmentFlowNode
  | MonitorFlowNode
  | NasFlowNode
  | PcBuildFlowNode
  | PowerStripFlowNode
  | UpsFlowNode

export function sameOptionalId(
  first: string | number | null | undefined,
  second: string | number | null | undefined,
): boolean {
  return first != null && second != null && String(first) === String(second)
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function getCanvasNodeId(item: InventoryItem): string {
  const key = runtimeItemKey(item)

  if (item.type === 'server') return `server-node:${key}`
  if (item.type === 'nas') return `nas-node:${key}`
  if (item.type === 'pcBuild') return `pc-build-node:${key}`
  if (item.type === 'monitor' || item.type === 'ups' || item.type === 'powerStrip') {
    return `${item.type}-node:${key}`
  }

  return `equipment-node:${key}`
}

export function endpointBelongsToItem(
  endpoint: ConnectionEndpoint | null,
  itemId: string,
): boolean {
  return endpoint?.itemId === itemId
}

export function getItemIdFromNodeId(nodeId: string): string {
  return nodeId
    .replace('server-node:', '')
    .replace('nas-node:', '')
    .replace('pc-build-node:', '')
    .replace('monitor-node:', '')
    .replace('ups-node:', '')
    .replace('powerStrip-node:', '')
    .replace('equipment-node:', '')
}

export function getMeasuredHandlePoint({
  project,
  nodeId,
  kind,
  handleId,
  handlesByNodeId,
}: {
  project: ProjectState
  nodeId: string
  kind: 'source' | 'target'
  handleId: string
  handlesByNodeId: ReadonlyMap<string, CanvasNodeHandleGeometry>
}): { x: number; y: number } | null {
  const placement = project.placements.find(
    (candidate) => candidate.serverId === getItemIdFromNodeId(nodeId),
  )
  const handle = handlesByNodeId.get(nodeId)?.[kind].find(
    (candidate) => candidate.id === handleId,
  )

  if (!placement || !handle) return null

  const x = placement.x + handle.x
  const y = placement.y + handle.y

  if (handle.position === 'left') return { x: Math.round(x), y: Math.round(y + handle.height / 2) }
  if (handle.position === 'right') return { x: Math.round(x + handle.width), y: Math.round(y + handle.height / 2) }
  if (handle.position === 'top') return { x: Math.round(x + handle.width / 2), y: Math.round(y) }
  if (handle.position === 'bottom') return { x: Math.round(x + handle.width / 2), y: Math.round(y + handle.height) }

  return null
}

function equalNodeDataValue(first: unknown, second: unknown): boolean {
  if (first === second) return true

  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((value, index) => value === second[index])
  }

  return false
}

function equalNodeData(
  first: WorkbenchFlowNode['data'],
  second: WorkbenchFlowNode['data'],
): boolean {
  const firstRecord = first as unknown as Record<string, unknown>
  const secondRecord = second as unknown as Record<string, unknown>
  const firstKeys = Object.keys(firstRecord)

  return firstKeys.length === Object.keys(secondRecord).length &&
    firstKeys.every((key) => equalNodeDataValue(firstRecord[key], secondRecord[key]))
}

export function reconcileFlowNodes(
  currentNodes: WorkbenchFlowNode[],
  nextNodes: WorkbenchFlowNode[],
): WorkbenchFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]))
  let changed = currentNodes.length !== nextNodes.length

  const reconciledNodes = nextNodes.map((nextNode, index) => {
    const currentNode = currentById.get(nextNode.id)

    if (
      currentNode &&
      currentNode.type === nextNode.type &&
      currentNode.zIndex === nextNode.zIndex &&
      currentNode.dragHandle === nextNode.dragHandle &&
      currentNode.position.x === nextNode.position.x &&
      currentNode.position.y === nextNode.position.y &&
      equalNodeData(currentNode.data, nextNode.data)
    ) {
      if (currentNodes[index] !== currentNode) changed = true
      return currentNode
    }

    changed = true
    return preserveCanvasNodeRuntimeState(currentNode, nextNode)
  })

  return changed ? reconciledNodes : currentNodes
}

function shallowRecordEqual(
  first: Record<string, unknown> | undefined,
  second: Record<string, unknown> | undefined,
): boolean {
  if (first === second) return true
  if (!first || !second) return false
  const firstKeys = Object.keys(first)

  return firstKeys.length === Object.keys(second).length
    && firstKeys.every((key) => first[key] === second[key])
}

export function cableFlowEdgesEqual(first: CableFlowEdge, second: CableFlowEdge): boolean {
  return first.source === second.source
    && first.target === second.target
    && first.sourceHandle === second.sourceHandle
    && first.targetHandle === second.targetHandle
    && first.type === second.type
    && first.zIndex === second.zIndex
    && first.interactionWidth === second.interactionWidth
    && first.selectable === second.selectable
    && first.focusable === second.focusable
    && shallowRecordEqual(
      first.data as unknown as Record<string, unknown>,
      second.data as unknown as Record<string, unknown>,
    )
    && shallowRecordEqual(
      first.style as unknown as Record<string, unknown>,
      second.style as unknown as Record<string, unknown>,
    )
}
