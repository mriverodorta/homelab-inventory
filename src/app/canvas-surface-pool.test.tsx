import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { useEffect, type ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasSurfacePool } from '@/app/canvas-surface-pool'
import type { WorkbenchCanvasProps } from '@/components/workbench-canvas-contract'

function canvasProps(runtimeKey: string): WorkbenchCanvasProps {
  return {
    runtimeKey,
    project: {
      id: runtimeKey,
      metadata: {
        name: runtimeKey,
        version: 1,
        updatedAt: '2026-08-26T00:00:00.000Z',
        projectId: 1,
        workspaceId: runtimeKey.charCodeAt(0),
      },
      items: {},
      placements: [],
      assignments: [],
      connections: [],
    },
    onViewportReady: vi.fn(),
  } as unknown as WorkbenchCanvasProps
}

describe('CanvasSurfacePool', () => {
  it('retains three mounted surfaces and enables interaction only for the active one', () => {
    const mounts = new Map<string, number>()
    const unmounts = new Map<string, number>()
    const TestCanvas: ComponentType<WorkbenchCanvasProps> = ({ runtimeKey, interactionEnabled }) => {
      useEffect(() => {
        mounts.set(runtimeKey!, (mounts.get(runtimeKey!) ?? 0) + 1)
        return () => {
          unmounts.set(runtimeKey!, (unmounts.get(runtimeKey!) ?? 0) + 1)
        }
      }, [runtimeKey])
      return <div data-testid={`canvas-${runtimeKey}`} data-interactive={interactionEnabled} />
    }

    const view = render(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={canvasProps('A')}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={canvasProps('B')}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="C"
        activeReady
        retainedRuntimeKeys={['A', 'B', 'C']}
        canvas={canvasProps('C')}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['B', 'C', 'A']}
        canvas={canvasProps('A')}
        renderCanvas={TestCanvas}
      />,
    )

    expect(mounts).toEqual(new Map([['A', 1], ['B', 1], ['C', 1]]))
    expect(unmounts.size).toBe(0)
    expect(screen.getByTestId('canvas-A')).toHaveAttribute('data-interactive', 'true')
    expect(screen.getByTestId('canvas-B')).toHaveAttribute('data-interactive', 'false')
    expect(screen.getByTestId('canvas-C')).toHaveAttribute('data-interactive', 'false')

    const active = screen.getByTestId('canvas-runtime-surface-A')
    const inactive = screen.getByTestId('canvas-runtime-surface-B')
    expect(active).toHaveAttribute('aria-hidden', 'false')
    expect(active).not.toHaveAttribute('inert')
    expect(inactive).toHaveAttribute('aria-hidden', 'true')
    expect(inactive).toHaveAttribute('inert')
    expect(inactive).toHaveClass('invisible', 'pointer-events-none')
  })

  it('unmounts a surface only after its matching runtime key is pruned', () => {
    const unmounted = vi.fn()
    const TestCanvas: ComponentType<WorkbenchCanvasProps> = ({ runtimeKey }) => {
      useEffect(() => () => unmounted(runtimeKey), [runtimeKey])
      return <div>{runtimeKey}</div>
    }
    const view = render(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={canvasProps('A')}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={canvasProps('B')}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['B']}
        canvas={canvasProps('B')}
        renderCanvas={TestCanvas}
      />,
    )

    expect(unmounted).toHaveBeenCalledOnce()
    expect(unmounted).toHaveBeenCalledWith('A')
    expect(screen.queryByTestId('canvas-runtime-surface-A')).not.toBeInTheDocument()
  })

  it('shows a local loader for a cold active runtime without unmounting warm surfaces', () => {
    const TestCanvas = ({ runtimeKey }: WorkbenchCanvasProps) => <div>{runtimeKey}</div>
    const view = render(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={canvasProps('A')}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady={false}
        retainedRuntimeKeys={['A', 'B']}
        canvas={canvasProps('A')}
        renderCanvas={TestCanvas}
      />,
    )

    expect(screen.getByText('Loading workspace canvas')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-runtime-surface-A')).toBeInTheDocument()
  })
})
