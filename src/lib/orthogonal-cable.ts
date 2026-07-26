import type {
  CableRouteResult,
  OrthogonalPoint,
  OrthogonalSide,
} from '@/lib/cable-geometry'

export type { OrthogonalPoint } from '@/lib/cable-geometry'

export type OrthogonalSegment = {
  index: number
  orientation: 'horizontal' | 'vertical'
  midpoint: OrthogonalPoint
}

const MIN_SEGMENT_HANDLE_LENGTH = 18
export const DEFAULT_ENDPOINT_SNAP_THRESHOLD = 8
const FALLBACK_ENDPOINT_OFFSET = 24

function offsetFromSide(point: OrthogonalPoint, side: OrthogonalSide): OrthogonalPoint {
  if (side === 'left') return { x: point.x - FALLBACK_ENDPOINT_OFFSET, y: point.y }
  if (side === 'right') return { x: point.x + FALLBACK_ENDPOINT_OFFSET, y: point.y }
  if (side === 'top') return { x: point.x, y: point.y - FALLBACK_ENDPOINT_OFFSET }
  return { x: point.x, y: point.y + FALLBACK_ENDPOINT_OFFSET }
}

function pointBetween(first: number, middle: number, last: number): boolean {
  return middle >= Math.min(first, last) && middle <= Math.max(first, last)
}

function compactOrthogonalPoints(points: OrthogonalPoint[]): OrthogonalPoint[] {
  const unique = points.filter((point, index) => {
    const previous = points[index - 1]
    return !previous || previous.x !== point.x || previous.y !== point.y
  })
  const compacted: OrthogonalPoint[] = []

  for (const point of unique) {
    const previous = compacted.at(-1)
    const beforePrevious = compacted.at(-2)
    const canCollapseHorizontal = beforePrevious && previous
      && beforePrevious.y === previous.y && previous.y === point.y
      && pointBetween(beforePrevious.x, previous.x, point.x)
    const canCollapseVertical = beforePrevious && previous
      && beforePrevious.x === previous.x && previous.x === point.x
      && pointBetween(beforePrevious.y, previous.y, point.y)

    if (canCollapseHorizontal || canCollapseVertical) {
      compacted[compacted.length - 1] = point
    } else {
      compacted.push(point)
    }
  }

  return compacted
}

function fallbackDetour(): number {
  return FALLBACK_ENDPOINT_OFFSET
}

function endpointSidesFaceEachOther(
  sourceSide: OrthogonalSide,
  targetSide: OrthogonalSide,
  sourceStub: OrthogonalPoint,
  targetStub: OrthogonalPoint,
): boolean {
  if (sourceSide === 'left' && targetSide === 'right') return sourceStub.x >= targetStub.x
  if (sourceSide === 'right' && targetSide === 'left') return sourceStub.x <= targetStub.x
  if (sourceSide === 'top' && targetSide === 'bottom') return sourceStub.y >= targetStub.y
  if (sourceSide === 'bottom' && targetSide === 'top') return sourceStub.y <= targetStub.y
  return false
}

export function createOrthogonalFallbackRoute(
  source: OrthogonalPoint,
  target: OrthogonalPoint,
  sourceSide: OrthogonalSide,
  targetSide: OrthogonalSide,
): CableRouteResult {
  const sourceStub = offsetFromSide(source, sourceSide)
  const targetStub = offsetFromSide(target, targetSide)
  const sourceHorizontal = sourceSide === 'left' || sourceSide === 'right'
  const targetHorizontal = targetSide === 'left' || targetSide === 'right'
  let middlePoints: OrthogonalPoint[]

  if (
    sourceHorizontal !== targetHorizontal
    || endpointSidesFaceEachOther(sourceSide, targetSide, sourceStub, targetStub)
  ) {
    if (sourceHorizontal) {
      middlePoints = [{ x: sourceStub.x, y: targetStub.y }]
    } else {
      middlePoints = [{ x: targetStub.x, y: sourceStub.y }]
    }
  } else if (sourceHorizontal) {
    if (sourceSide === targetSide) {
      const corridorX = sourceSide === 'left'
        ? Math.min(sourceStub.x, targetStub.x) - fallbackDetour()
        : Math.max(sourceStub.x, targetStub.x) + fallbackDetour()
      middlePoints = [
        { x: corridorX, y: sourceStub.y },
        { x: corridorX, y: targetStub.y },
      ]
    } else {
      const corridorY = Math.min(sourceStub.y, targetStub.y) - fallbackDetour()
      middlePoints = [
        { x: sourceStub.x, y: corridorY },
        { x: targetStub.x, y: corridorY },
      ]
    }
  } else {
    if (sourceSide === targetSide) {
      const corridorY = sourceSide === 'top'
        ? Math.min(sourceStub.y, targetStub.y) - fallbackDetour()
        : Math.max(sourceStub.y, targetStub.y) + fallbackDetour()
      middlePoints = [
        { x: sourceStub.x, y: corridorY },
        { x: targetStub.x, y: corridorY },
      ]
    } else {
      const corridorX = Math.min(sourceStub.x, targetStub.x) - fallbackDetour()
      middlePoints = [
        { x: corridorX, y: sourceStub.y },
        { x: corridorX, y: targetStub.y },
      ]
    }
  }

  return {
    points: compactOrthogonalPoints([source, sourceStub, ...middlePoints, targetStub, target]),
    manualAnchorPointIndexes: [],
    usedFallback: true,
  }
}

function segmentLength(first: OrthogonalPoint, second: OrthogonalPoint): number {
  return Math.abs(second.x - first.x) + Math.abs(second.y - first.y)
}

export function cablePointsToPath(points: OrthogonalPoint[]): string {
  const [firstPoint, ...remainingPoints] = points
  if (!firstPoint) return ''
  return [
    `M ${firstPoint.x},${firstPoint.y}`,
    ...remainingPoints.map((point) => `L ${point.x},${point.y}`),
  ].join(' ')
}

export function getEditableCableSegments(points: OrthogonalPoint[]): OrthogonalSegment[] {
  return points.slice(0, -1).flatMap<OrthogonalSegment>((point, index) => {
    const nextPoint = points[index + 1]
    if (index === 0 || index === points.length - 2) return []
    if (!nextPoint || segmentLength(point, nextPoint) < MIN_SEGMENT_HANDLE_LENGTH) return []
    if (point.y === nextPoint.y && point.x !== nextPoint.x) {
      return [{
        index,
        orientation: 'horizontal',
        midpoint: {
          x: Math.round((point.x + nextPoint.x) / 2),
          y: point.y,
        },
      }]
    }
    if (point.x === nextPoint.x && point.y !== nextPoint.y) {
      return [{
        index,
        orientation: 'vertical',
        midpoint: {
          x: point.x,
          y: Math.round((point.y + nextPoint.y) / 2),
        },
      }]
    }
    return []
  })
}
