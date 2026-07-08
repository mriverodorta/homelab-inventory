import type { ConnectionBendPoint } from '@/types/inventory'

export type OrthogonalSide = 'left' | 'right' | 'top' | 'bottom'

export type OrthogonalPoint = {
  x: number
  y: number
}

export type OrthogonalSegment = {
  index: number
  orientation: 'horizontal' | 'vertical'
  midpoint: OrthogonalPoint
}

const DEFAULT_GRID_SIZE = 24
const MIN_SEGMENT_HANDLE_LENGTH = 18
export const DEFAULT_ENDPOINT_SNAP_THRESHOLD = 8

function pointsEqual(first: OrthogonalPoint, second: OrthogonalPoint): boolean {
  return first.x === second.x && first.y === second.y
}

function segmentLength(first: OrthogonalPoint, second: OrthogonalPoint): number {
  return Math.abs(second.x - first.x) + Math.abs(second.y - first.y)
}

function isHorizontal(first: OrthogonalPoint, second: OrthogonalPoint): boolean {
  return first.y === second.y
}

function isVertical(first: OrthogonalPoint, second: OrthogonalPoint): boolean {
  return first.x === second.x
}

function isCollinear(
  previous: OrthogonalPoint,
  current: OrthogonalPoint,
  next: OrthogonalPoint,
): boolean {
  return (previous.x === current.x && current.x === next.x) ||
    (previous.y === current.y && current.y === next.y)
}

export function snapCoordinate(value: number, gridSize = DEFAULT_GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize
}

export function snapPoint(point: OrthogonalPoint, gridSize = DEFAULT_GRID_SIZE): OrthogonalPoint {
  return {
    x: snapCoordinate(point.x, gridSize),
    y: snapCoordinate(point.y, gridSize),
  }
}

function sideOffset(point: OrthogonalPoint, side: OrthogonalSide, distance: number): OrthogonalPoint {
  if (side === 'left') {
    return { x: point.x - distance, y: point.y }
  }

  if (side === 'right') {
    return { x: point.x + distance, y: point.y }
  }

  if (side === 'top') {
    return { x: point.x, y: point.y - distance }
  }

  return { x: point.x, y: point.y + distance }
}

function normalizeOrthogonalPoints(points: OrthogonalPoint[]): OrthogonalPoint[] {
  const orthogonalized = points.reduce<OrthogonalPoint[]>((result, point) => {
    const previous = result.at(-1)

    if (!previous) {
      return [point]
    }

    if (pointsEqual(previous, point)) {
      return result
    }

    if (!isHorizontal(previous, point) && !isVertical(previous, point)) {
      result.push({ x: previous.x, y: point.y })
    }

    result.push(point)
    return result
  }, [])

  return orthogonalized.reduce<OrthogonalPoint[]>((result, point) => {
    const previous = result.at(-1)

    if (previous && pointsEqual(previous, point)) {
      return result
    }

    const beforePrevious = result.at(-2)

    if (beforePrevious && previous && isCollinear(beforePrevious, previous, point)) {
      result[result.length - 1] = point
      return result
    }

    result.push(point)
    return result
  }, [])
}

function defaultBendPoints({
  source,
  target,
  sourceSide,
  targetSide,
  laneOffset,
}: {
  source: OrthogonalPoint
  target: OrthogonalPoint
  sourceSide: OrthogonalSide
  targetSide: OrthogonalSide
  laneOffset: number
}): OrthogonalPoint[] {
  const sourceExit = sideOffset(source, sourceSide, laneOffset)
  const targetEntry = sideOffset(target, targetSide, laneOffset)
  const sourceHorizontal = sourceSide === 'left' || sourceSide === 'right'
  const elbow = sourceExit.x === targetEntry.x || sourceExit.y === targetEntry.y
    ? null
    : sourceHorizontal
      ? { x: sourceExit.x, y: targetEntry.y }
      : { x: targetEntry.x, y: sourceExit.y }

  return elbow ? [sourceExit, elbow, targetEntry] : [sourceExit, targetEntry]
}

export function buildOrthogonalCablePoints({
  source,
  target,
  sourceSide,
  targetSide,
  laneOffset,
  bendPoints,
}: {
  source: OrthogonalPoint
  target: OrthogonalPoint
  sourceSide: OrthogonalSide
  targetSide: OrthogonalSide
  laneOffset: number
  bendPoints?: ConnectionBendPoint[]
}): OrthogonalPoint[] {
  const interiorPoints = bendPoints?.length
    ? bendPoints
    : defaultBendPoints({ source, target, sourceSide, targetSide, laneOffset })

  return normalizeOrthogonalPoints([source, ...interiorPoints, target])
}

export function getCableBendPoints(points: OrthogonalPoint[]): ConnectionBendPoint[] {
  return points.slice(1, -1).map((point) => ({ x: point.x, y: point.y }))
}

export function cablePointsToPath(points: OrthogonalPoint[]): string {
  const [firstPoint, ...remainingPoints] = points

  if (!firstPoint) {
    return ''
  }

  return [
    `M ${firstPoint.x},${firstPoint.y}`,
    ...remainingPoints.map((point) => `L ${point.x},${point.y}`),
  ].join(' ')
}

export function getEditableCableSegments(points: OrthogonalPoint[]): OrthogonalSegment[] {
  return points.slice(0, -1).flatMap<OrthogonalSegment>((point, index) => {
    const nextPoint = points[index + 1]

    if (!nextPoint || segmentLength(point, nextPoint) < MIN_SEGMENT_HANDLE_LENGTH) {
      return []
    }

    if (isHorizontal(point, nextPoint)) {
      return [{
        index,
        orientation: 'horizontal' as const,
        midpoint: {
          x: Math.round((point.x + nextPoint.x) / 2),
          y: point.y,
        },
      }]
    }

    if (isVertical(point, nextPoint)) {
      return [{
        index,
        orientation: 'vertical' as const,
        midpoint: {
          x: point.x,
          y: Math.round((point.y + nextPoint.y) / 2),
        },
      }]
    }

    return []
  })
}

export function getCableTooltipPoint(points: OrthogonalPoint[]): OrthogonalPoint {
  if (points.length === 0) {
    return { x: 0, y: 0 }
  }

  const totalLength = points.slice(0, -1).reduce((total, point, index) => {
    const nextPoint = points[index + 1]

    return nextPoint ? total + segmentLength(point, nextPoint) : total
  }, 0)
  const targetLength = totalLength / 2
  let walkedLength = 0

  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index]
    const nextPoint = points[index + 1]

    if (!point || !nextPoint) {
      continue
    }

    const length = segmentLength(point, nextPoint)

    if (walkedLength + length >= targetLength) {
      const remaining = targetLength - walkedLength

      if (isHorizontal(point, nextPoint)) {
        return {
          x: Math.round(point.x + Math.sign(nextPoint.x - point.x) * remaining),
          y: point.y,
        }
      }

      return {
        x: point.x,
        y: Math.round(point.y + Math.sign(nextPoint.y - point.y) * remaining),
      }
    }

    walkedLength += length
  }

  return points[Math.floor(points.length / 2)] ?? points[0]
}

function nearestSnapValue(value: number, candidates: number[], threshold: number): number {
  const snapCandidate = candidates
    .map((candidate) => ({
      candidate,
      distance: Math.abs(value - candidate),
    }))
    .filter((candidate) => candidate.distance <= threshold)
    .sort((first, second) => first.distance - second.distance)[0]

  return snapCandidate?.candidate ?? value
}

export function snapCableSegmentPointerToEndpoint({
  points,
  pointer,
  segmentIndex,
  source,
  target,
  threshold = DEFAULT_ENDPOINT_SNAP_THRESHOLD,
}: {
  points: OrthogonalPoint[]
  pointer: OrthogonalPoint
  segmentIndex: number
  source: OrthogonalPoint
  target: OrthogonalPoint
  threshold?: number
}): OrthogonalPoint {
  const segmentStart = points[segmentIndex]
  const segmentEnd = points[segmentIndex + 1]

  if (!segmentStart || !segmentEnd) {
    return pointer
  }

  if (isVertical(segmentStart, segmentEnd)) {
    return {
      ...pointer,
      x: nearestSnapValue(pointer.x, [source.x, target.x], threshold),
    }
  }

  if (isHorizontal(segmentStart, segmentEnd)) {
    return {
      ...pointer,
      y: nearestSnapValue(pointer.y, [source.y, target.y], threshold),
    }
  }

  return pointer
}

export function moveOrthogonalCableSegment({
  points,
  segmentIndex,
  pointer,
}: {
  points: OrthogonalPoint[]
  segmentIndex: number
  pointer: OrthogonalPoint
}): OrthogonalPoint[] {
  const segmentStart = points[segmentIndex]
  const segmentEnd = points[segmentIndex + 1]

  if (!segmentStart || !segmentEnd) {
    return points
  }

  const nextPoints = points.map((point) => ({ ...point }))
  const lastIndex = nextPoints.length - 1

  if (isHorizontal(segmentStart, segmentEnd)) {
    const y = Math.round(pointer.y)

    if (segmentIndex === 0 && segmentIndex + 1 === lastIndex) {
      nextPoints.splice(1, 0, { x: nextPoints[0].x, y }, { x: nextPoints[lastIndex].x, y })
    } else if (segmentIndex === 0) {
      nextPoints.splice(1, 0, { x: nextPoints[0].x, y })
      nextPoints[2].y = y
    } else if (segmentIndex + 1 === lastIndex) {
      nextPoints[segmentIndex].y = y
      nextPoints.splice(segmentIndex + 1, 0, { x: nextPoints[lastIndex].x, y })
    } else {
      nextPoints[segmentIndex].y = y
      nextPoints[segmentIndex + 1].y = y
    }

    return normalizeOrthogonalPoints(nextPoints)
  }

  if (isVertical(segmentStart, segmentEnd)) {
    const x = Math.round(pointer.x)

    if (segmentIndex === 0 && segmentIndex + 1 === lastIndex) {
      nextPoints.splice(1, 0, { x, y: nextPoints[0].y }, { x, y: nextPoints[lastIndex].y })
    } else if (segmentIndex === 0) {
      nextPoints.splice(1, 0, { x, y: nextPoints[0].y })
      nextPoints[2].x = x
    } else if (segmentIndex + 1 === lastIndex) {
      nextPoints[segmentIndex].x = x
      nextPoints.splice(segmentIndex + 1, 0, { x, y: nextPoints[lastIndex].y })
    } else {
      nextPoints[segmentIndex].x = x
      nextPoints[segmentIndex + 1].x = x
    }

    return normalizeOrthogonalPoints(nextPoints)
  }

  return points
}
