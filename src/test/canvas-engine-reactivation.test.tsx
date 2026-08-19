import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCanvasEngineReactivation } from '@/app/use-canvas-engine-reactivation'
import type { DomainEnginePhase } from '@/engine/types'

type HookProps = {
  canvasWorkspaceActive: boolean
  engineEnabled: boolean
  enginePhase: DomainEnginePhase
  engineSession: number
  selectedItemId: string | null
  autoCenterOnSelect: boolean
}

const readyCanvas: HookProps = {
  canvasWorkspaceActive: true,
  engineEnabled: true,
  enginePhase: 'ready',
  engineSession: 1,
  selectedItemId: 'server:7',
  autoCenterOnSelect: true,
}

describe('Canvas engine reactivation', () => {
  it('focuses a preserved item once after each engine session becomes ready', () => {
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

    rerender({ ...readyCanvas, engineSession: 2 })
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
    rerender({ ...readyCanvas, engineSession: 2, selectedItemId: null })
    expect(focusCanvasItem).not.toHaveBeenCalled()
  })

  it('waits for an active Canvas and a positive ready engine session', () => {
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
    rerender({ ...readyCanvas, engineSession: 0 })
    expect(focusCanvasItem).not.toHaveBeenCalled()

    rerender(readyCanvas)
    expect(focusCanvasItem).toHaveBeenCalledOnce()
  })
})
