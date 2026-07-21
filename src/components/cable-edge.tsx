import {
  BaseEdge,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  buildOrthogonalCablePoints,
  cablePointsToPath,
  DEFAULT_ENDPOINT_SNAP_THRESHOLD,
  getCableBendPoints,
  getEditableCableSegments,
  moveOrthogonalCableSegment,
  snapCableSegmentPointerToEndpoint,
  type OrthogonalPoint,
  type OrthogonalSide,
} from '@/lib/orthogonal-cable'
import type { ConnectionBendPoint, ConnectionRoutePreferences } from '@/types/inventory'

const TOUCH_DRAG_HOLD_MS = 350
const TOUCH_DRAG_TOLERANCE_PX = 8

export type CableEdgeData = {
  color: string
  label: string
  detail: string
  laneOffset: number
  selected: boolean
  traced?: boolean
  dimmed: boolean
  editable: boolean
  connectionId: string | number
  route?: ConnectionRoutePreferences
  onSelect: (connectionId: string | number) => void
  onUpdateRoute: (connectionId: string | number, route: ConnectionRoutePreferences) => void
}

export type CableFlowEdge = Edge<CableEdgeData, 'cable'>

function positionToSide(position: unknown): OrthogonalSide {
  if (position === 'left' || position === 'right' || position === 'top' || position === 'bottom') {
    return position
  }

  return 'right'
}

export function CableEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}: EdgeProps<CableFlowEdge>) {
  const { getViewport, screenToFlowPosition } = useReactFlow()
  const savedBendPoints = useMemo(
    () => data?.route?.bendPoints ?? [],
    [data?.route?.bendPoints],
  )
  const [draftBendPoints, setDraftBendPoints] = useState<ConnectionBendPoint[] | null>(null)
  const source = useMemo<OrthogonalPoint>(
    () => ({ x: Math.round(sourceX), y: Math.round(sourceY) }),
    [sourceX, sourceY],
  )
  const target = useMemo<OrthogonalPoint>(
    () => ({ x: Math.round(targetX), y: Math.round(targetY) }),
    [targetX, targetY],
  )
  const cablePoints = useMemo(
    () => buildOrthogonalCablePoints({
      source,
      target,
      sourceSide: positionToSide(sourcePosition),
      targetSide: positionToSide(targetPosition),
      laneOffset: data?.laneOffset ?? 24,
      bendPoints: draftBendPoints ?? savedBendPoints,
    }),
    [
      data?.laneOffset,
      draftBendPoints,
      savedBendPoints,
      source,
      sourcePosition,
      target,
      targetPosition,
    ],
  )
  const segments = useMemo(() => getEditableCableSegments(cablePoints), [cablePoints])
  const color = data?.color ?? '#75695d'
  const selected = Boolean(data?.selected)
  const editable = Boolean(data?.editable)
  const traced = Boolean(data?.traced)
  const dimmed = Boolean(data?.dimmed)
  const renderedPath = cablePointsToPath(cablePoints)

  useEffect(() => {
    setDraftBendPoints(null)
  }, [savedBendPoints])

  function getSegmentPath(segmentIndex: number): string {
    const segmentStart = cablePoints[segmentIndex]
    const segmentEnd = cablePoints[segmentIndex + 1]

    if (!segmentStart || !segmentEnd) {
      return ''
    }

    return `M ${segmentStart.x},${segmentStart.y} L ${segmentEnd.x},${segmentEnd.y}`
  }

  function startSegmentDrag(event: ReactPointerEvent<SVGPathElement>, segmentIndex: number) {
    if (!data) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    data.onSelect(data.connectionId)

    const origin = {
      x: event.clientX,
      y: event.clientY,
    }

    if (event.pointerType === 'touch') {
      let canceled = false
      let holdTimer: number | null = null

      const cleanupHold = () => {
        if (holdTimer != null) {
          window.clearTimeout(holdTimer)
          holdTimer = null
        }

        window.removeEventListener('pointermove', cancelIfMoved)
        window.removeEventListener('pointerup', cleanupHold)
        window.removeEventListener('pointercancel', cleanupHold)
      }
      const beginAfterHold = () => {
        if (canceled) {
          return
        }

        cleanupHold()
        beginSegmentDrag(segmentIndex)
      }
      const cancelIfMoved = (pointerEvent: PointerEvent) => {
        const deltaX = pointerEvent.clientX - origin.x
        const deltaY = pointerEvent.clientY - origin.y

        if (Math.hypot(deltaX, deltaY) <= TOUCH_DRAG_TOLERANCE_PX) {
          return
        }

        canceled = true
        cleanupHold()
      }

      holdTimer = window.setTimeout(beginAfterHold, TOUCH_DRAG_HOLD_MS)
      window.addEventListener('pointermove', cancelIfMoved)
      window.addEventListener('pointerup', cleanupHold)
      window.addEventListener('pointercancel', cleanupHold)
      return
    }

    beginSegmentDrag(segmentIndex)
  }

  function beginSegmentDrag(segmentIndex: number) {
    if (!data) {
      return
    }

    const startingPoints = cablePoints
    const snapThreshold = DEFAULT_ENDPOINT_SNAP_THRESHOLD / getViewport().zoom

    const getPointerPoint = (pointerEvent: PointerEvent): OrthogonalPoint => {
      const point = screenToFlowPosition({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      }, {
        snapToGrid: false,
      })

      return snapCableSegmentPointerToEndpoint({
        points: startingPoints,
        segmentIndex,
        pointer: point,
        source,
        target,
        threshold: snapThreshold,
      })
    }

    const moveBend = (pointerEvent: PointerEvent) => {
      const point = getPointerPoint(pointerEvent)
      const nextPoints = moveOrthogonalCableSegment({
        points: startingPoints,
        segmentIndex,
        pointer: point,
      })

      setDraftBendPoints(getCableBendPoints(nextPoints))
    }

    const stopBendDrag = (pointerEvent: PointerEvent) => {
      const point = getPointerPoint(pointerEvent)
      const nextPoints = moveOrthogonalCableSegment({
        points: startingPoints,
        segmentIndex,
        pointer: point,
      })

      data.onUpdateRoute(data.connectionId, {
        ...data.route,
        bendPoints: getCableBendPoints(nextPoints),
      })

      window.removeEventListener('pointermove', moveBend)
      window.removeEventListener('pointerup', stopBendDrag)
    }

    setDraftBendPoints(getCableBendPoints(startingPoints))
    window.addEventListener('pointermove', moveBend)
    window.addEventListener('pointerup', stopBendDrag)
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={renderedPath}
        interactionWidth={22}
        className={traced ? 'homelab-inventory-trace-cable' : undefined}
        style={{
          stroke: color,
          strokeWidth: selected ? 6 : 4,
          strokeDasharray: traced ? '12 8' : undefined,
          opacity: dimmed ? 0.18 : 1,
          filter: selected || traced
            ? 'drop-shadow(0 2px 3px rgba(32, 36, 44, 0.22))'
            : undefined,
        }}
      />
      {editable
        ? segments.map((segment) => (
            <path
              key={`${id}-${segment.index}-interaction`}
              aria-label={`Move ${segment.orientation} cable segment`}
              className="nodrag nopan"
              d={getSegmentPath(segment.index)}
              fill="none"
              stroke="transparent"
              strokeLinecap="round"
              strokeWidth={22}
              pointerEvents="stroke"
              style={{
                cursor: segment.orientation === 'horizontal' ? 'ns-resize' : 'ew-resize',
              }}
              onPointerDown={(event) => startSegmentDrag(event, segment.index)}
            />
          ))
        : null}
    </>
  )
}
