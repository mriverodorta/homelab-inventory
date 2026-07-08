import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ConnectionEndpoint } from '@/types/inventory'

type DragPoint = {
  x: number
  y: number
}

type EndpointDragStart = (endpoint: ConnectionEndpoint, point: DragPoint) => void

const PORT_DRAG_THRESHOLD_PX = 4
const TOUCH_DRAG_HOLD_MS = 350
const TOUCH_DRAG_TOLERANCE_PX = 8

export function startSelectedPortDrag(
  event: ReactPointerEvent<HTMLElement>,
  endpoint: ConnectionEndpoint,
  onEndpointDragStart: EndpointDragStart,
) {
  event.preventDefault()
  event.stopPropagation()

  const origin = {
    x: event.clientX,
    y: event.clientY,
  }
  let started = false
  let canceled = false
  let touchHoldTimer: number | null = null

  const cleanup = () => {
    if (touchHoldTimer != null) {
      window.clearTimeout(touchHoldTimer)
      touchHoldTimer = null
    }

    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerUp)
  }
  const startDrag = () => {
    if (started || canceled) {
      return
    }

    started = true
    cleanup()
    onEndpointDragStart(endpoint, origin)
  }
  const handlePointerMove = (pointerEvent: PointerEvent) => {
    if (started) {
      return
    }

    const deltaX = pointerEvent.clientX - origin.x
    const deltaY = pointerEvent.clientY - origin.y

    const distance = Math.hypot(deltaX, deltaY)

    if (event.pointerType === 'touch') {
      if (distance > TOUCH_DRAG_TOLERANCE_PX) {
        canceled = true
        cleanup()
      }

      return
    }

    if (distance < PORT_DRAG_THRESHOLD_PX) {
      return
    }

    startDrag()
  }
  const handlePointerUp = () => {
    cleanup()
  }

  if (event.pointerType === 'touch') {
    touchHoldTimer = window.setTimeout(startDrag, TOUCH_DRAG_HOLD_MS)
  }

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
}
