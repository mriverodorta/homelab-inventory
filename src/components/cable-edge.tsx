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
import type { CableRouteResult } from '@/lib/cable-geometry'
import {
  cablePointsToPath,
  DEFAULT_ENDPOINT_SNAP_THRESHOLD,
  getEditableCableSegments,
  type OrthogonalPoint,
} from '@/lib/orthogonal-cable'
import {
  insertCableManualBend,
  previewCableRouteSegment,
} from '@/engine/routing'
import { useDomainEngine } from '@/hooks/use-domain-engine'
import type { ConnectionRoutePreferences } from '@/types/inventory'

const TOUCH_DRAG_HOLD_MS = 350
const TOUCH_DRAG_TOLERANCE_PX = 8
const POINTER_DRAG_THRESHOLD_PX = 4
const EMPTY_CABLE_POINTS: OrthogonalPoint[] = []

export type CableEdgeData = {
  color: string
  label: string
  detail: string
  selected: boolean
  hovered?: boolean
  traced?: boolean
  dimmed: boolean
  editable: boolean
  connectionId: string | number
  route?: ConnectionRoutePreferences
  snapToGrid: boolean
  plannedRoute?: CableRouteResult
  onSelect: (connectionId: string | number) => void
  onUpdateRoute: (connectionId: string | number, route: ConnectionRoutePreferences) => void
}

export type CableFlowEdge = Edge<CableEdgeData, 'cable'>

function pointsEqual(first: OrthogonalPoint | undefined, second: OrthogonalPoint): boolean {
  return first?.x === second.x && first.y === second.y
}

export function CableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<CableFlowEdge>) {
  const { getViewport, screenToFlowPosition } = useReactFlow()
  const domainEngine = useDomainEngine()
  const [draftRoute, setDraftRoute] = useState<CableRouteResult | null>(null)
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
    () => draftRoute ?? (data?.plannedRoute &&
          pointsEqual(data.plannedRoute.points[0], source) &&
          pointsEqual(data.plannedRoute.points.at(-1), target)
        ? data.plannedRoute
        : null),
    [
      data?.plannedRoute,
      draftRoute,
      source,
      target,
    ],
  )
  const cablePoints = routedCable?.points ?? EMPTY_CABLE_POINTS
  const segments = useMemo(() => getEditableCableSegments(cablePoints), [cablePoints])
  const color = data?.color ?? '#75695d'
  const selected = Boolean(data?.selected)
  const hovered = Boolean(data?.hovered)
  const editable = Boolean(data?.editable)
  const traced = Boolean(data?.traced)
  const dimmed = Boolean(data?.dimmed)
  const emphasized = selected || hovered || traced
  const renderedPath = cablePoints.length > 1 ? cablePointsToPath(cablePoints) : ''

  useEffect(() => {
    setDraftRoute(null)
  }, [data?.plannedRoute])

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
    if (!data || !selected || !editable || !routedCable || !domainEngine.enabled) return
    const connectionId = Number(data.connectionId)
    if (!Number.isSafeInteger(connectionId) || connectionId <= 0) return

    event.preventDefault()
    event.stopPropagation()
    const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false })
    void insertCableManualBend(domainEngine.client, {
      connectionId,
      segmentIndex,
      point: pointer,
      snapToGrid: data.snapToGrid,
    }).then((preview) => {
      setDraftRoute(preview.route)
      data.onUpdateRoute(data.connectionId, {
        ...data.route,
        bendPoints: preview.bendPoints,
      })
    }).catch(() => {})
  }

  function beginSegmentDrag(
    segmentIndex: number,
    origin: OrthogonalPoint,
    pointerId: number,
  ) {
    if (!data || !routedCable || !domainEngine.enabled) {
      return
    }
    const connectionId = Number(data.connectionId)
    if (!Number.isSafeInteger(connectionId) || connectionId <= 0) return
    const startingPoints = cablePoints
    const segmentStart = startingPoints[segmentIndex]
    const segmentEnd = startingPoints[segmentIndex + 1]
    if (!segmentStart || !segmentEnd) return
    const horizontal = segmentStart.y === segmentEnd.y
    const snapThreshold = DEFAULT_ENDPOINT_SNAP_THRESHOLD / getViewport().zoom
    let active = false
    let canceled = false
    let previewInFlight = false
    let queuedPreview: { coordinate: number; commit: boolean } | null = null
    const getCoordinate = (pointerEvent: PointerEvent): number => {
      const rawPoint = screenToFlowPosition({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      }, {
        snapToGrid: false,
      })
      return horizontal ? rawPoint.y : rawPoint.x
    }
    const dispatchPreview = () => {
      if (previewInFlight || !queuedPreview || canceled) return
      const next = queuedPreview
      queuedPreview = null
      previewInFlight = true
      void previewCableRouteSegment(domainEngine.client, {
        connectionId,
        segmentIndex,
        coordinate: next.coordinate,
        snapToGrid: data.snapToGrid,
        endpointSnapThreshold: snapThreshold,
      }).then((preview) => {
        if (canceled) return
        setDraftRoute(preview.route)
        if (next.commit) {
          data.onUpdateRoute(data.connectionId, {
            ...data.route,
            bendPoints: preview.bendPoints,
          })
        }
      }).catch(() => {
        if (next.commit && !canceled) setDraftRoute(null)
      }).finally(() => {
        previewInFlight = false
        dispatchPreview()
      })
    }
    const schedulePreview = (coordinate: number, commit: boolean) => {
      queuedPreview = { coordinate, commit }
      dispatchPreview()
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
        setDraftRoute(routedCable)
      }
      schedulePreview(getCoordinate(pointerEvent), false)
    }

    const stopBendDrag = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return
      }

      cleanupGesture()

      if (!active) {
        setDraftRoute(null)
        return
      }
      schedulePreview(getCoordinate(pointerEvent), true)
    }
    const cancelBendDrag = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return
      }

      cleanupGesture()
      canceled = true
      queuedPreview = null
      setDraftRoute(null)
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
