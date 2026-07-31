import type { CableRouteResult } from '@/lib/cable-geometry'
import type { OrthogonalPoint } from '@/lib/orthogonal-cable'

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

function numberArraysEqual(first: readonly number[], second: readonly number[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index])
}

export function cableRouteResultsEqual(
  first: CableRouteResult,
  second: CableRouteResult,
): boolean {
  return first.usedFallback === second.usedFallback
    && first.sourceSide === second.sourceSide
    && first.targetSide === second.targetSide
    && numberArraysEqual(first.manualAnchorPointIndexes, second.manualAnchorPointIndexes)
    && first.points.length === second.points.length
    && first.points.every((point, index) => (
      point.x === second.points[index].x && point.y === second.points[index].y
    ))
}

export function cableRouteMatchesEndpoints(
  route: CableRouteResult | undefined,
  source: OrthogonalPoint | null,
  target: OrthogonalPoint | null,
): route is CableRouteResult {
  if (!route || !source || !target || route.points.length < 2) return false

  const first = route.points[0]
  const last = route.points.at(-1)

  return first.x === source.x
    && first.y === source.y
    && last?.x === target.x
    && last.y === target.y
}

export function selectStableCableRoute({
  planned,
  previous,
  source,
  target,
}: {
  planned: CableRouteResult | undefined
  previous: CableRouteResult | undefined
  source: OrthogonalPoint | null
  target: OrthogonalPoint | null
}): CableRouteResult | undefined {
  if (cableRouteMatchesEndpoints(planned, source, target)) return planned

  return previous ?? planned
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
