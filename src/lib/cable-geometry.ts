import {
  getCanvasItemHeight,
  getCanvasItemWidth,
} from '@/lib/project'
import type { ConnectionBendPoint, ProjectState } from '@/types/inventory'

export type OrthogonalPoint = { x: number; y: number }
export type OrthogonalSide = 'left' | 'right' | 'top' | 'bottom'

export type CableObstacle = {
  itemId: string
  left: number
  top: number
  right: number
  bottom: number
}

export type CableObstacleSize = {
  width: number
  height: number
}

export type CableReservedSegment = {
  start: OrthogonalPoint
  end: OrthogonalPoint
}

export type CableRouteRequest = {
  source: OrthogonalPoint
  target: OrthogonalPoint
  sourceSide: OrthogonalSide
  targetSide: OrthogonalSide
  laneOffset: number
  obstacles: readonly CableObstacle[]
  sourceItemId: string
  targetItemId: string
  manualBendPoints?: readonly ConnectionBendPoint[]
  reservedSegments?: readonly CableReservedSegment[]
  snapToGrid: boolean
}

export type CableRouteResult = {
  points: OrthogonalPoint[]
  manualAnchorPointIndexes: number[]
  usedFallback: boolean
}

export function buildCableObstacles(
  project: ProjectState,
  clearance = 12,
  measuredSizes: ReadonlyMap<string, CableObstacleSize> = new Map(),
): CableObstacle[] {
  return project.placements.flatMap((placement) => {
    const item = project.items[placement.serverId]
    if (!item) return []
    const measuredSize = measuredSizes.get(placement.serverId)
    const width = measuredSize?.width ?? getCanvasItemWidth(project, placement.serverId)
    const height = measuredSize?.height ?? getCanvasItemHeight(project, placement.serverId)
    return [{
      itemId: placement.serverId,
      left: placement.x - clearance,
      top: placement.y - clearance,
      right: placement.x + width + clearance,
      bottom: placement.y + height + clearance,
    }]
  })
}
