import {
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentType,
} from 'react'
import { WorkbenchCanvas } from '@/components/lazy-workbench-canvas'
import type {
  CanvasController,
  WorkbenchCanvasProps,
} from '@/components/workbench-canvas-contract'
import { cn } from '@/lib/utils'

export interface CanvasSurfacePoolProps {
  activeRuntimeKey: string | null
  activeReady: boolean
  retainedRuntimeKeys: readonly string[]
  canvas: WorkbenchCanvasProps
  renderCanvas?: ComponentType<WorkbenchCanvasProps>
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
  const layersRef = useRef(new Map<string, HTMLDivElement>())
  const previousActiveKeyRef = useRef<string | null>(null)

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
    for (const key of layersRef.current.keys()) {
      if (!retained.has(key)) layersRef.current.delete(key)
    }
  }, [activeRuntimeKey, retainedRuntimeKeys])

  useLayoutEffect(() => {
    const previousActiveKey = previousActiveKeyRef.current
    if (previousActiveKey && previousActiveKey !== activeRuntimeKey) {
      const previousLayer = layersRef.current.get(previousActiveKey)
      const focused = document.activeElement
      if (focused instanceof HTMLElement && previousLayer?.contains(focused)) focused.blur()
    }
    previousActiveKeyRef.current = activeRuntimeKey

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
          <div
            key={runtimeKey}
            ref={(element) => {
              if (element) layersRef.current.set(runtimeKey, element)
              else layersRef.current.delete(runtimeKey)
            }}
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
              interactionEnabled={active && activeReady}
              onViewportReady={(controller) => {
                controllersRef.current.set(runtimeKey, controller)
                if (active && activeReady) canvas.onViewportReady(controller)
              }}
            />
          </div>
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
