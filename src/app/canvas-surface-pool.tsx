import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { WorkbenchCanvas } from '@/components/lazy-workbench-canvas'
import type {
  CanvasController,
  WorkbenchCanvasProps,
} from '@/components/workbench-canvas-contract'
import {
  CanvasSurfaceLayer,
  type CanvasSurfaceComponent,
} from '@/app/canvas-surface-layer'

export interface CanvasSurfacePoolProps {
  activeRuntimeKey: string | null
  activeReady: boolean
  retainedRuntimeKeys: readonly string[]
  canvas: WorkbenchCanvasProps
  renderCanvas?: CanvasSurfaceComponent
}

export function CanvasSurfacePool({
  activeRuntimeKey,
  activeReady,
  retainedRuntimeKeys,
  canvas,
  renderCanvas: Canvas = WorkbenchCanvas,
}: CanvasSurfacePoolProps) {
  const snapshotsRef = useRef(new Map<string, WorkbenchCanvasProps>())
  const controllersRef = useRef(new Map<string, CanvasController>())
  const activeRuntimeKeyRef = useRef(activeRuntimeKey)
  const activeReadyRef = useRef(activeReady)
  const activeCanvasRef = useRef(canvas)
  activeRuntimeKeyRef.current = activeRuntimeKey
  activeReadyRef.current = activeReady
  activeCanvasRef.current = canvas

  const handleControllerReady = useCallback((runtimeKey: string, controller: CanvasController | null) => {
    if (controller) controllersRef.current.set(runtimeKey, controller)
    else controllersRef.current.delete(runtimeKey)
    if (
      controller
      && activeReadyRef.current
      && activeRuntimeKeyRef.current === runtimeKey
    ) activeCanvasRef.current.onViewportReady(controller)
  }, [])

  useLayoutEffect(() => {
    if (!activeRuntimeKey || !activeReady) return
    snapshotsRef.current.set(activeRuntimeKey, canvas)
  }, [activeReady, activeRuntimeKey, canvas])

  useLayoutEffect(() => {
    const retained = new Set(retainedRuntimeKeys)
    if (activeRuntimeKey) retained.add(activeRuntimeKey)
    for (const key of snapshotsRef.current.keys()) {
      if (!retained.has(key)) snapshotsRef.current.delete(key)
    }
    for (const key of controllersRef.current.keys()) {
      if (!retained.has(key)) controllersRef.current.delete(key)
    }
  }, [activeRuntimeKey, retainedRuntimeKeys])

  useLayoutEffect(() => {
    if (!activeRuntimeKey || !activeReady) return
    const controller = controllersRef.current.get(activeRuntimeKey)
    if (controller) canvas.onViewportReady(controller)
  }, [activeReady, activeRuntimeKey, canvas])

  const keys = useMemo(() => {
    const available = new Set(snapshotsRef.current.keys())
    if (activeRuntimeKey && activeReady) available.add(activeRuntimeKey)
    const orderedKeys = [...retainedRuntimeKeys]
    if (activeRuntimeKey && available.has(activeRuntimeKey) && !orderedKeys.includes(activeRuntimeKey)) {
      orderedKeys.push(activeRuntimeKey)
    }
    return orderedKeys.filter((key) => available.has(key))
  }, [activeReady, activeRuntimeKey, retainedRuntimeKeys])
  const activeHasSurface = Boolean(
    activeRuntimeKey
    && (activeReady || snapshotsRef.current.has(activeRuntimeKey)),
  )

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden" data-testid="canvas-surface-pool">
      {keys.map((runtimeKey) => {
        const active = runtimeKey === activeRuntimeKey
        const surfaceProps = active && activeReady
          ? canvas
          : snapshotsRef.current.get(runtimeKey)
        if (!surfaceProps) return null

        return (
          <CanvasSurfaceLayer
            key={runtimeKey}
            runtimeKey={runtimeKey}
            active={active && activeReady}
            surfaceProps={surfaceProps}
            Canvas={Canvas}
            onControllerReady={handleControllerReady}
          />
        )
      })}
      {activeRuntimeKey && !activeHasSurface ? (
        <div
          role="status"
          className="absolute inset-0 grid place-items-center bg-[#fbf8f1] text-sm font-semibold text-[#75695d]"
        >
          Loading workspace canvas
        </div>
      ) : null}
    </div>
  )
}
