import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { clampInventoryWidth } from '@/lib/ui-preferences'

type InventoryPanelResizeOptions = {
  width: number
  onWidthChange: (width: number) => void
}

export function useInventoryPanelResize({
  width,
  onWidthChange,
}: InventoryPanelResizeOptions) {
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleInventoryResize = useCallback((event: PointerEvent) => {
    const resizeState = resizeStateRef.current
    if (!resizeState) return

    onWidthChange(clampInventoryWidth(
      resizeState.startWidth + event.clientX - resizeState.startX,
    ))
  }, [onWidthChange])

  const stopInventoryResize = useCallback(() => {
    resizeStateRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('pointermove', handleInventoryResize)
    window.removeEventListener('pointerup', stopInventoryResize)
  }, [handleInventoryResize])

  useEffect(() => stopInventoryResize, [stopInventoryResize])

  const startInventoryResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handleInventoryResize)
    window.addEventListener('pointerup', stopInventoryResize)
  }, [handleInventoryResize, stopInventoryResize, width])

  return startInventoryResize
}
