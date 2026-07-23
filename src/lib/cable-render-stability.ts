import type { CableRouteResult } from '@/lib/cable-geometry'
import type {
  ConnectionEndpoint,
  InventoryConnection,
  ProjectState,
} from '@/types/inventory'

export const CANVAS_NODE_BASE_Z_INDEX = 1
export const CANVAS_NODE_ACTIVE_Z_INDEX = 1000
export const CANVAS_CABLE_Z_INDEX = 8

type CanvasNodeRuntimeState = {
  measured?: { width?: number; height?: number }
  selected?: boolean
}

export function preserveCanvasNodeRuntimeState<T extends object>(
  current: (T & CanvasNodeRuntimeState) | undefined,
  next: T,
): T & CanvasNodeRuntimeState {
  const nextRuntime = next as T & CanvasNodeRuntimeState

  if (!current) return nextRuntime

  return {
    ...next,
    measured: current.measured ?? nextRuntime.measured,
    selected: current.selected ?? nextRuntime.selected,
  }
}

function endpointsEqual(first: ConnectionEndpoint, second: ConnectionEndpoint): boolean {
  return first.itemId === second.itemId
    && first.portId === second.portId
    && first.endpointId === second.endpointId
    && first.hostedItemId === second.hostedItemId
}

function connectionsEqualForCanvasNodes(
  first: InventoryConnection,
  second: InventoryConnection,
): boolean {
  return first.id === second.id
    && first.type === second.type
    && first.negotiatedSpeedMbps === second.negotiatedSpeedMbps
    && first.label === second.label
    && first.createdAt === second.createdAt
    && endpointsEqual(first.from, second.from)
    && endpointsEqual(first.to, second.to)
    && first.route?.sourceSide === second.route?.sourceSide
    && first.route?.targetSide === second.route?.targetSide
}

export function projectsEqualForCanvasNodes(
  first: ProjectState,
  second: ProjectState,
): boolean {
  return first.items === second.items
    && first.placements === second.placements
    && first.assignments === second.assignments
    && first.compatibilityPolicy === second.compatibilityPolicy
    && first.connections.length === second.connections.length
    && first.connections.every((connection, index) => (
      connectionsEqualForCanvasNodes(connection, second.connections[index])
    ))
}

function numberArraysEqual(first: readonly number[], second: readonly number[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index])
}

export function cableRouteResultsEqual(
  first: CableRouteResult,
  second: CableRouteResult,
): boolean {
  return first.usedFallback === second.usedFallback
    && numberArraysEqual(first.manualAnchorPointIndexes, second.manualAnchorPointIndexes)
    && first.points.length === second.points.length
    && first.points.every((point, index) => (
      point.x === second.points[index].x && point.y === second.points[index].y
    ))
}

export function reconcileItemsById<T extends { id: string }>(
  current: readonly T[],
  next: readonly T[],
  equal: (first: T, second: T) => boolean,
): T[] {
  const currentById = new Map(current.map((item) => [item.id, item]))
  let changed = current.length !== next.length
  const reconciled = next.map((nextItem, index) => {
    const currentItem = currentById.get(nextItem.id)

    if (currentItem && equal(currentItem, nextItem)) {
      if (current[index] !== currentItem) changed = true
      return currentItem
    }

    changed = true
    return nextItem
  })

  return changed ? reconciled : current as T[]
}
