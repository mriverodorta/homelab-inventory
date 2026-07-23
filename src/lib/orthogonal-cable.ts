import type { OrthogonalPoint } from '@/lib/cable-geometry'

export type { OrthogonalPoint } from '@/lib/cable-geometry'

export type OrthogonalSegment = {
  index: number
  orientation: 'horizontal' | 'vertical'
  midpoint: OrthogonalPoint
}

const MIN_SEGMENT_HANDLE_LENGTH = 18
export const DEFAULT_ENDPOINT_SNAP_THRESHOLD = 8

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
