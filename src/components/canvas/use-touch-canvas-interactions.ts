import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from 'react'
import type { Viewport } from '@xyflow/react'

const DEFAULT_NODE_DRAG_THRESHOLD = 6
const TOUCH_NODE_DRAG_LOCK_THRESHOLD = 100_000
const TOUCH_DRAG_HOLD_MS = 350
const TOUCH_DRAG_TOLERANCE_PX = 8

type TouchNodeDragGate = {
  timer: number | null
  startX: number
  startY: number
  lastX: number
  lastY: number
  armed: boolean
  allowNodeDrag: boolean
  canceled: boolean
  panning: boolean
}

type TouchCanvasInteractionsOptions = {
  getViewport: () => Viewport
  setViewport: (viewport: Viewport) => Promise<boolean>
}

export function useTouchCanvasInteractions({
  getViewport,
  setViewport,
}: TouchCanvasInteractionsOptions) {
  const [nodeDragThreshold, setNodeDragThreshold] = useState(DEFAULT_NODE_DRAG_THRESHOLD)
  const touchNodeDragGateRef = useRef<TouchNodeDragGate | null>(null)

  const resetTouchNodeDragGate = useCallback(() => {
    const gate = touchNodeDragGateRef.current

    if (gate?.timer != null) {
      window.clearTimeout(gate.timer)
    }

    touchNodeDragGateRef.current = null
    setNodeDragThreshold(DEFAULT_NODE_DRAG_THRESHOLD)
  }, [])

  const panViewportByScreenDelta = useCallback((deltaX: number, deltaY: number) => {
    const viewport = getViewport()

    void setViewport({
      x: viewport.x + deltaX,
      y: viewport.y + deltaY,
      zoom: viewport.zoom,
    })
  }, [getViewport, setViewport])

  const armTouchNodeDragGate = useCallback((
    startX: number,
    startY: number,
    allowNodeDrag: boolean,
  ) => {
    resetTouchNodeDragGate()
    setNodeDragThreshold(TOUCH_NODE_DRAG_LOCK_THRESHOLD)

    const gate: TouchNodeDragGate = {
      timer: null,
      startX,
      startY,
      lastX: startX,
      lastY: startY,
      armed: false,
      allowNodeDrag,
      canceled: false,
      panning: false,
    }

    if (allowNodeDrag) {
      gate.timer = window.setTimeout(() => {
        if (touchNodeDragGateRef.current !== gate || gate.canceled || gate.panning) return

        gate.armed = true
        gate.timer = null
        setNodeDragThreshold(0)
      }, TOUCH_DRAG_HOLD_MS)
    }

    touchNodeDragGateRef.current = gate
  }, [resetTouchNodeDragGate])

  const panOrCancelTouchNodeDragGate = useCallback((clientX: number, clientY: number) => {
    const gate = touchNodeDragGateRef.current

    if (!gate || gate.armed) return false

    if (gate.panning) {
      const panDeltaX = clientX - gate.lastX
      const panDeltaY = clientY - gate.lastY
      gate.lastX = clientX
      gate.lastY = clientY
      panViewportByScreenDelta(panDeltaX, panDeltaY)
      return true
    }

    if (gate.canceled) return false

    const totalDeltaX = clientX - gate.startX
    const totalDeltaY = clientY - gate.startY

    if (Math.hypot(totalDeltaX, totalDeltaY) <= TOUCH_DRAG_TOLERANCE_PX) return false

    gate.panning = true
    gate.canceled = true

    if (gate.timer != null) {
      window.clearTimeout(gate.timer)
      gate.timer = null
    }

    const panDeltaX = clientX - gate.lastX
    const panDeltaY = clientY - gate.lastY
    gate.lastX = clientX
    gate.lastY = clientY
    panViewportByScreenDelta(panDeltaX, panDeltaY)
    return true
  }, [panViewportByScreenDelta])

  const handleFlowPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return

    const target = event.target
    if (!(target instanceof Element) || !target.closest('.react-flow__node')) return

    armTouchNodeDragGate(
      event.clientX,
      event.clientY,
      Boolean(target.closest('.server-node-drag-handle')),
    )
  }, [armTouchNodeDragGate])

  const handleFlowPointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return
    if (panOrCancelTouchNodeDragGate(event.clientX, event.clientY)) event.preventDefault()
  }, [panOrCancelTouchNodeDragGate])

  const handleFlowPointerEndCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') resetTouchNodeDragGate()
  }, [resetTouchNodeDragGate])

  const handleFlowTouchStartCapture = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!touch) return

    const target = event.target
    if (!(target instanceof Element) || !target.closest('.react-flow__node')) return

    armTouchNodeDragGate(
      touch.clientX,
      touch.clientY,
      Boolean(target.closest('.server-node-drag-handle')),
    )
  }, [armTouchNodeDragGate])

  const handleFlowTouchMoveCapture = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (touch && panOrCancelTouchNodeDragGate(touch.clientX, touch.clientY)) {
      event.preventDefault()
    }
  }, [panOrCancelTouchNodeDragGate])

  useEffect(() => resetTouchNodeDragGate, [resetTouchNodeDragGate])

  return {
    nodeDragThreshold,
    resetTouchNodeDragGate,
    handleFlowPointerDownCapture,
    handleFlowPointerMoveCapture,
    handleFlowPointerEndCapture,
    handleFlowTouchStartCapture,
    handleFlowTouchMoveCapture,
  }
}
