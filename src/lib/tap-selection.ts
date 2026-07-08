import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'

const TAP_MOVE_TOLERANCE_PX = 8
const TOUCH_HOLD_SUPPRESSION_MS = 350

type PointerTapState = {
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  startTime: number
}

export function useTapSelection<TElement extends HTMLElement>(
  onTap: (event: ReactPointerEvent<TElement> | ReactMouseEvent<TElement>) => void,
) {
  const tapStateRef = useRef<PointerTapState | null>(null)
  const suppressNextClickRef = useRef(false)

  const onPointerDown = useCallback((event: ReactPointerEvent<TElement>) => {
    if (event.button !== 0) {
      tapStateRef.current = null
      return
    }

    tapStateRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
    }
  }, [])

  const onPointerUp = useCallback((event: ReactPointerEvent<TElement>) => {
    const tapState = tapStateRef.current

    tapStateRef.current = null

    if (!tapState || tapState.pointerId !== event.pointerId) {
      return
    }

    const moved = Math.hypot(event.clientX - tapState.startX, event.clientY - tapState.startY)
    const held = tapState.pointerType === 'touch' &&
      performance.now() - tapState.startTime >= TOUCH_HOLD_SUPPRESSION_MS

    suppressNextClickRef.current = true

    if (moved > TAP_MOVE_TOLERANCE_PX || held) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    onTap(event)
  }, [onTap])

  const onPointerCancel = useCallback(() => {
    tapStateRef.current = null
    suppressNextClickRef.current = true
  }, [])

  const onClick = useCallback((event: ReactMouseEvent<TElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.detail === 0) {
      event.preventDefault()
      event.stopPropagation()
      onTap(event)
    }
  }, [onTap])

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onClick,
  }
}
