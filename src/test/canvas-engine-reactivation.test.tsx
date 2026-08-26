import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCanvasEngineReactivation } from '@/app/use-canvas-engine-reactivation'
import type { DomainEnginePhase } from '@/engine/types'

type HookProps = {
  canvasWorkspaceActive: boolean
  engineEnabled: boolean
  enginePhase: DomainEnginePhase
  engineRuntimeKey: string | null
  engineGeneration: number
  selectedItemId: string | null
  autoCenterOnSelect: boolean
}

const readyCanvas: HookProps = {
  canvasWorkspaceActive: true,
  engineEnabled: true,
  enginePhase: 'ready',
  engineRuntimeKey: 'account:1:canvas:2',
  engineGeneration: 1,
  selectedItemId: 'server:7',
  autoCenterOnSelect: true,
}

describe('Canvas engine reactivation', () => {
  it('focuses a preserved item once after each engine runtime generation becomes ready', () => {
    const focusCanvasItem = vi.fn()
    const { rerender } = renderHook(
      (props: HookProps) => useCanvasEngineReactivation({ ...props, focusCanvasItem }),
      {
        initialProps: {
          ...readyCanvas,
          enginePhase: 'loading' as const,
        } as HookProps,
      },
    )

    expect(focusCanvasItem).not.toHaveBeenCalled()
    rerender(readyCanvas)
    expect(focusCanvasItem).toHaveBeenCalledOnce()
    expect(focusCanvasItem).toHaveBeenLastCalledWith('server:7')

    rerender({ ...readyCanvas })
    expect(focusCanvasItem).toHaveBeenCalledOnce()

    rerender({ ...readyCanvas, engineGeneration: 2 })
    expect(focusCanvasItem).toHaveBeenCalledTimes(2)
  })

  it('does not focus when centering is disabled or no item is selected', () => {
    const focusCanvasItem = vi.fn()
    const { rerender } = renderHook(
      (props: HookProps) => useCanvasEngineReactivation({ ...props, focusCanvasItem }),
      {
        initialProps: {
          ...readyCanvas,
          autoCenterOnSelect: false,
        } as HookProps,
      },
    )

    expect(focusCanvasItem).not.toHaveBeenCalled()
    rerender({ ...readyCanvas, engineGeneration: 2, selectedItemId: null })
    expect(focusCanvasItem).not.toHaveBeenCalled()
  })

  it('waits for an active Canvas and a positive ready engine generation', () => {
    const focusCanvasItem = vi.fn()
    const { rerender } = renderHook(
      (props: HookProps) => useCanvasEngineReactivation({ ...props, focusCanvasItem }),
      {
        initialProps: {
          ...readyCanvas,
          canvasWorkspaceActive: false,
        } as HookProps,
      },
    )

    rerender({ ...readyCanvas, engineEnabled: false })
    rerender({ ...readyCanvas, engineGeneration: 0 })
    expect(focusCanvasItem).not.toHaveBeenCalled()

    rerender(readyCanvas)
    expect(focusCanvasItem).toHaveBeenCalledOnce()
  })
})
