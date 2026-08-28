import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentType,
} from 'react'
import type {
  CanvasController,
  WorkbenchCanvasProps,
} from '@/components/workbench-canvas-contract'
import { cn } from '@/lib/utils'

export type CanvasSurfaceComponent = ComponentType<WorkbenchCanvasProps>

export type CanvasSurfaceLayerProps = Readonly<{
  runtimeKey: string
  active: boolean
  surfaceProps: WorkbenchCanvasProps
  Canvas: CanvasSurfaceComponent
  onControllerReady: (runtimeKey: string, controller: CanvasController | null) => void
}>

function CanvasSurfaceLayerComponent({
  runtimeKey,
  active,
  surfaceProps,
  Canvas,
  onControllerReady,
}: CanvasSurfaceLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const registerController = useCallback((controller: CanvasController) => {
    onControllerReady(runtimeKey, controller)
  }, [onControllerReady, runtimeKey])

  useLayoutEffect(() => {
    if (active) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && layerRef.current?.contains(focused)) focused.blur()
  }, [active])

  useEffect(() => () => {
    onControllerReady(runtimeKey, null)
  }, [onControllerReady, runtimeKey])

  return (
    <div
      ref={layerRef}
      data-canvas-runtime-surface={runtimeKey}
      data-testid={`canvas-runtime-surface-${runtimeKey}`}
      aria-hidden={!active}
      inert={!active ? true : undefined}
      className={cn(
        'absolute inset-0 flex min-h-0 min-w-0',
        active ? 'visible pointer-events-auto' : 'invisible pointer-events-none',
      )}
    >
      <Canvas
        {...surfaceProps}
        runtimeKey={runtimeKey}
        surfaceState={active ? 'active' : 'parked'}
        interactionEnabled={active}
        onViewportReady={registerController}
      />
    </div>
  )
}

export const CanvasSurfaceLayer = memo(CanvasSurfaceLayerComponent)
CanvasSurfaceLayer.displayName = 'CanvasSurfaceLayer'
