import { useEffect, useRef } from 'react'
import type { DomainEnginePhase } from '@/engine/types'

type CanvasEngineReactivationOptions = {
  canvasWorkspaceActive: boolean
  engineEnabled: boolean
  enginePhase: DomainEnginePhase
  engineSession: number
  selectedItemId: string | null
  autoCenterOnSelect: boolean
  focusCanvasItem(itemId: string): void
}

export function useCanvasEngineReactivation({
  canvasWorkspaceActive,
  engineEnabled,
  enginePhase,
  engineSession,
  selectedItemId,
  autoCenterOnSelect,
  focusCanvasItem,
}: CanvasEngineReactivationOptions) {
  const handledSessionRef = useRef(0)

  useEffect(() => {
    if (
      !canvasWorkspaceActive
      || !engineEnabled
      || enginePhase !== 'ready'
      || engineSession <= 0
      || handledSessionRef.current === engineSession
    ) {
      return
    }

    handledSessionRef.current = engineSession
    if (selectedItemId && autoCenterOnSelect) focusCanvasItem(selectedItemId)
  }, [
    autoCenterOnSelect,
    canvasWorkspaceActive,
    engineEnabled,
    enginePhase,
    engineSession,
    focusCanvasItem,
    selectedItemId,
  ])
}
