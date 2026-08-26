import { useEffect, useRef } from 'react'
import type { DomainEnginePhase } from '@/engine/types'

type CanvasEngineReactivationOptions = {
  canvasWorkspaceActive: boolean
  engineEnabled: boolean
  enginePhase: DomainEnginePhase
  engineRuntimeKey: string | null
  engineGeneration: number
  selectedItemId: string | null
  autoCenterOnSelect: boolean
  focusCanvasItem(itemId: string): void
}

export function useCanvasEngineReactivation({
  canvasWorkspaceActive,
  engineEnabled,
  enginePhase,
  engineRuntimeKey,
  engineGeneration,
  selectedItemId,
  autoCenterOnSelect,
  focusCanvasItem,
}: CanvasEngineReactivationOptions) {
  const handledRuntimeRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      !canvasWorkspaceActive
      || !engineEnabled
      || enginePhase !== 'ready'
      || !engineRuntimeKey
      || engineGeneration <= 0
      || handledRuntimeRef.current === `${engineRuntimeKey}:${engineGeneration}`
    ) {
      return
    }

    handledRuntimeRef.current = `${engineRuntimeKey}:${engineGeneration}`
    if (selectedItemId && autoCenterOnSelect) focusCanvasItem(selectedItemId)
  }, [
    autoCenterOnSelect,
    canvasWorkspaceActive,
    engineEnabled,
    enginePhase,
    engineGeneration,
    engineRuntimeKey,
    focusCanvasItem,
    selectedItemId,
  ])
}
