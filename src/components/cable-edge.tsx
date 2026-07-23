import {
  BaseEdge,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  routeCableAroundObstacles,
  CABLE_ROUTING_GRID_SIZE,
  segmentCrossesObstacleInterior,
  type CableObstacle,
  type CableRouteResult,
} from '@/lib/cable-obstacle-routing'
import {
  buildOrthogonalCablePoints,
  cablePointsToPath,
  DEFAULT_ENDPOINT_SNAP_THRESHOLD,
  getCableBendPoints,
  getEditableCableSegments,
  moveOrthogonalCableSegment,
  snapPoint,
  snapCableSegmentPointerToEndpoint,
  type CableEndpoint,
  type OrthogonalPoint,
  type OrthogonalSide,
} from '@/lib/orthogonal-cable'
import type { ConnectionBendPoint, ConnectionRoutePreferences } from '@/types/inventory'

const TOUCH_DRAG_HOLD_MS = 350
const TOUCH_DRAG_TOLERANCE_PX = 8
const POINTER_DRAG_THRESHOLD_PX = 4

export type CableEdgeData = {
  color: string
  label: string
  detail: string
  laneOffset: number
  selected: boolean
  hovered?: boolean
  traced?: boolean
  dimmed: boolean
  editable: boolean
  connectionId: string | number
  route?: ConnectionRoutePreferences
  obstacles: readonly CableObstacle[]
  sourceItemId: string
  targetItemId: string
  snapToGrid: boolean
  plannedRoute?: CableRouteResult
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

function pointsEqual(first: OrthogonalPoint | undefined, second: OrthogonalPoint): boolean {
  return first?.x === second.x && first.y === second.y
}

function endpointApproachAvoidsObstacles({
  points,
  endpoint,
  obstacles,
  sourceItemId,
  targetItemId,
}: {
  points: readonly OrthogonalPoint[]
  endpoint: CableEndpoint
  obstacles: readonly CableObstacle[]
  sourceItemId: string
  targetItemId: string
}): boolean {
  return points.slice(0, -1).every((point, index) => {
    const nextPoint = points[index + 1]
    if (!nextPoint) return true

    return obstacles.every((obstacle) => {
      if (endpoint === 'source' && index === 0 && obstacle.itemId === sourceItemId) {
        return true
      }
      if (
        endpoint === 'target' &&
        index === points.length - 2 &&
        obstacle.itemId === targetItemId
      ) {
        return true
      }

      return !segmentCrossesObstacleInterior(point, nextPoint, obstacle)
    })
  })
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
  const gestureCleanupRef = useRef<(() => void) | null>(null)
  const source = useMemo<OrthogonalPoint>(
    () => ({ x: Math.round(sourceX), y: Math.round(sourceY) }),
    [sourceX, sourceY],
  )
  const target = useMemo<OrthogonalPoint>(
    () => ({ x: Math.round(targetX), y: Math.round(targetY) }),
    [targetX, targetY],
  )
  const routedCable = useMemo(
    () => draftBendPoints
      ? {
          points: buildOrthogonalCablePoints({
            source,
            target,
            sourceSide: positionToSide(sourcePosition),
            targetSide: positionToSide(targetPosition),
            laneOffset: data?.laneOffset ?? 24,
            bendPoints: draftBendPoints,
          }),
          manualAnchorPointIndexes: [],
          usedFallback: false,
        }
      : data?.plannedRoute &&
          pointsEqual(data.plannedRoute.points[0], source) &&
          pointsEqual(data.plannedRoute.points.at(-1), target)
        ? data.plannedRoute
        : routeCableAroundObstacles({
          source,
          target,
          sourceSide: positionToSide(sourcePosition),
          targetSide: positionToSide(targetPosition),
          laneOffset: data?.laneOffset ?? 24,
          obstacles: data?.obstacles ?? [],
          sourceItemId: data?.sourceItemId ?? '',
          targetItemId: data?.targetItemId ?? '',
          manualBendPoints: savedBendPoints,
          snapToGrid: data?.snapToGrid ?? false,
        }),
    [
      data?.laneOffset,
      data?.obstacles,
      data?.plannedRoute,
      data?.snapToGrid,
      data?.sourceItemId,
      data?.targetItemId,
      draftBendPoints,
      savedBendPoints,
      source,
      sourcePosition,
      target,
      targetPosition,
    ],
  )
  const cablePoints = routedCable.points
  const segments = useMemo(() => getEditableCableSegments(cablePoints), [cablePoints])
  const color = data?.color ?? '#75695d'
  const selected = Boolean(data?.selected)
  const hovered = Boolean(data?.hovered)
  const editable = Boolean(data?.editable)
  const traced = Boolean(data?.traced)
  const dimmed = Boolean(data?.dimmed)
  const emphasized = selected || hovered || traced
  const renderedPath = cablePointsToPath(cablePoints)

  useEffect(() => {
    setDraftBendPoints(null)
  }, [savedBendPoints])

  useEffect(() => () => {
    gestureCleanupRef.current?.()
  }, [])

  function getSegmentPath(segmentIndex: number): string {
    const segmentStart = cablePoints[segmentIndex]
    const segmentEnd = cablePoints[segmentIndex + 1]

    if (!segmentStart || !segmentEnd) {
      return ''
    }

    return `M ${segmentStart.x},${segmentStart.y} L ${segmentEnd.x},${segmentEnd.y}`
  }

  function startSegmentDrag(event: ReactPointerEvent<SVGPathElement>, segmentIndex: number) {
    if (!data || !selected || !editable) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    data.onSelect(data.connectionId)
    gestureCleanupRef.current?.()

    const origin = {
      x: event.clientX,
      y: event.clientY,
    }
    const pointerId = event.pointerId

    if (event.pointerType === 'touch') {
      let canceled = false
      let holdTimer: number | null = null

      const cleanupHold = () => {
        if (holdTimer != null) {
          window.clearTimeout(holdTimer)
          holdTimer = null
        }

        window.removeEventListener('pointermove', cancelIfMoved)
        window.removeEventListener('pointerup', finishHold)
        window.removeEventListener('pointercancel', finishHold)
        if (gestureCleanupRef.current === cleanupHold) {
          gestureCleanupRef.current = null
        }
      }
      const beginAfterHold = () => {
        if (canceled) {
          return
        }

        cleanupHold()
        beginSegmentDrag(segmentIndex, origin, pointerId)
      }
      const cancelIfMoved = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return
        }
        const deltaX = pointerEvent.clientX - origin.x
        const deltaY = pointerEvent.clientY - origin.y

        if (Math.hypot(deltaX, deltaY) <= TOUCH_DRAG_TOLERANCE_PX) {
          return
        }

        canceled = true
        cleanupHold()
      }
      const finishHold = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId === pointerId) {
          cleanupHold()
        }
      }

      holdTimer = window.setTimeout(beginAfterHold, TOUCH_DRAG_HOLD_MS)
      window.addEventListener('pointermove', cancelIfMoved)
      window.addEventListener('pointerup', finishHold)
      window.addEventListener('pointercancel', finishHold)
      gestureCleanupRef.current = cleanupHold
      return
    }

    beginSegmentDrag(segmentIndex, origin, pointerId)
  }

  function insertManualAnchor(event: ReactMouseEvent<SVGPathElement>, segmentIndex: number) {
    if (!data || !selected || !editable) return
    const segmentStart = cablePoints[segmentIndex]
    const segmentEnd = cablePoints[segmentIndex + 1]
    if (!segmentStart || !segmentEnd) return

    event.preventDefault()
    event.stopPropagation()
    const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false })
    const projected = segmentStart.y === segmentEnd.y
      ? {
          x: Math.min(Math.max(pointer.x, Math.min(segmentStart.x, segmentEnd.x)), Math.max(segmentStart.x, segmentEnd.x)),
          y: segmentStart.y,
        }
      : {
          x: segmentStart.x,
          y: Math.min(Math.max(pointer.y, Math.min(segmentStart.y, segmentEnd.y)), Math.max(segmentStart.y, segmentEnd.y)),
        }
    const anchor = data.snapToGrid
      ? snapPoint(projected, CABLE_ROUTING_GRID_SIZE)
      : { x: Math.round(projected.x), y: Math.round(projected.y) }
    if (
      (anchor.x === segmentStart.x && anchor.y === segmentStart.y) ||
      (anchor.x === segmentEnd.x && anchor.y === segmentEnd.y) ||
      savedBendPoints.some((bendPoint) => bendPoint.x === anchor.x && bendPoint.y === anchor.y)
    ) {
      return
    }
    const insertionIndex = routedCable.manualAnchorPointIndexes.filter((index) => index <= segmentIndex).length
    const nextBendPoints = [...savedBendPoints]
    nextBendPoints.splice(insertionIndex, 0, anchor)

    data.onUpdateRoute(data.connectionId, {
      ...data.route,
      bendPoints: nextBendPoints,
    })
  }

  function beginSegmentDrag(
    segmentIndex: number,
    origin: OrthogonalPoint,
    pointerId: number,
  ) {
    if (!data) {
      return
    }

    const startingPoints = cablePoints
    const snapThreshold = DEFAULT_ENDPOINT_SNAP_THRESHOLD / getViewport().zoom
    let active = false
    const canSimplifyEndpointApproach = (
      points: readonly OrthogonalPoint[],
      endpoint: CableEndpoint,
    ) => endpointApproachAvoidsObstacles({
      points,
      endpoint,
      obstacles: data.obstacles,
      sourceItemId: data.sourceItemId,
      targetItemId: data.targetItemId,
    })

    const getPointerPoint = (pointerEvent: PointerEvent): OrthogonalPoint => {
      const rawPoint = screenToFlowPosition({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      }, {
        snapToGrid: false,
      })

      const point = data.snapToGrid
        ? snapPoint(rawPoint, CABLE_ROUTING_GRID_SIZE)
        : rawPoint

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
      if (pointerEvent.pointerId !== pointerId) {
        return
      }
      if (!active) {
        const deltaX = pointerEvent.clientX - origin.x
        const deltaY = pointerEvent.clientY - origin.y

        if (Math.hypot(deltaX, deltaY) < POINTER_DRAG_THRESHOLD_PX) {
          return
        }

        active = true
        setDraftBendPoints(getCableBendPoints(startingPoints))
      }

      const point = getPointerPoint(pointerEvent)
      const nextPoints = moveOrthogonalCableSegment({
        points: startingPoints,
        segmentIndex,
        pointer: point,
        canSimplifyEndpointApproach,
      })

      setDraftBendPoints(getCableBendPoints(nextPoints))
    }

    const stopBendDrag = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return
      }

      cleanupGesture()

      if (!active) {
        setDraftBendPoints(null)
        return
      }

      const point = getPointerPoint(pointerEvent)
      const nextPoints = moveOrthogonalCableSegment({
        points: startingPoints,
        segmentIndex,
        pointer: point,
        canSimplifyEndpointApproach,
      })

      data.onUpdateRoute(data.connectionId, {
        ...data.route,
        bendPoints: getCableBendPoints(nextPoints),
      })
    }
    const cancelBendDrag = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return
      }

      cleanupGesture()
      setDraftBendPoints(null)
    }
    const cleanupGesture = () => {
      window.removeEventListener('pointermove', moveBend)
      window.removeEventListener('pointerup', stopBendDrag)
      window.removeEventListener('pointercancel', cancelBendDrag)
      if (gestureCleanupRef.current === cleanupGesture) {
        gestureCleanupRef.current = null
      }
    }

    window.addEventListener('pointermove', moveBend)
    window.addEventListener('pointerup', stopBendDrag)
    window.addEventListener('pointercancel', cancelBendDrag)
    gestureCleanupRef.current = cleanupGesture
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
          strokeWidth: emphasized ? 6 : 4,
          strokeDasharray: traced ? '12 8' : undefined,
          opacity: dimmed ? 0.18 : 1,
          filter: emphasized
            ? 'drop-shadow(0 2px 3px rgba(32, 36, 44, 0.22))'
            : undefined,
        }}
      />
      {editable && selected
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
              onDoubleClick={(event) => insertManualAnchor(event, segment.index)}
            />
          ))
        : null}
    </>
  )
}
