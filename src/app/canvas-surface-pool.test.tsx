import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { Profiler, StrictMode, useEffect, type ComponentType } from 'react'
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
  it('does not commit a continuously parked Canvas during active-only updates', () => {
    const renders = new Map<string, number>()
    const commits = new Map<string, number>()
    const TestCanvas: ComponentType<WorkbenchCanvasProps> = ({ runtimeKey, validationMessage }) => {
      renders.set(runtimeKey!, (renders.get(runtimeKey!) ?? 0) + 1)
      return (
        <Profiler
          id={runtimeKey!}
          onRender={(id) => commits.set(id, (commits.get(id) ?? 0) + 1)}
        >
          <div>{validationMessage}</div>
        </Profiler>
      )
    }
    const first = canvasProps('A')
    const second = canvasProps('B')
    const view = render(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={first}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={second}
        renderCanvas={TestCanvas}
      />,
    )
    const parkedRenders = renders.get('A')
    const parkedCommits = commits.get('A')

    for (let index = 0; index < 20; index += 1) {
      view.rerender(
        <CanvasSurfacePool
          activeRuntimeKey="B"
          activeReady
          retainedRuntimeKeys={['A', 'B']}
          canvas={{ ...second, validationMessage: `Active update ${index}` }}
          renderCanvas={TestCanvas}
        />,
      )
    }

    expect(renders.get('A')).toBe(parkedRenders)
    expect(commits.get('A')).toBe(parkedCommits)
    expect(renders.get('B')).toBe(21)

    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['B', 'A']}
        canvas={first}
        renderCanvas={TestCanvas}
      />,
    )
    expect(renders.get('A')).toBe((parkedRenders ?? 0) + 1)
    expect(renders.get('B')).toBe(22)
  })

  it('retains three mounted surfaces and enables interaction only for the active one', () => {
    const mounts = new Map<string, number>()
    const unmounts = new Map<string, number>()
    const TestCanvas: ComponentType<WorkbenchCanvasProps> = ({ runtimeKey, interactionEnabled, surfaceState }) => {
      useEffect(() => {
        mounts.set(runtimeKey!, (mounts.get(runtimeKey!) ?? 0) + 1)
        return () => {
          unmounts.set(runtimeKey!, (unmounts.get(runtimeKey!) ?? 0) + 1)
        }
      }, [runtimeKey])
      return (
        <div
          data-testid={`canvas-${runtimeKey}`}
          data-interactive={interactionEnabled}
          data-surface-state={surfaceState}
        >
          <div
            data-testid={`explicitly-visible-${runtimeKey}`}
            style={{ visibility: 'visible' }}
          />
        </div>
      )
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
    expect(screen.getByTestId('canvas-A')).toHaveAttribute('data-surface-state', 'active')
    expect(screen.getByTestId('canvas-B')).toHaveAttribute('data-surface-state', 'parked')
    expect(screen.getByTestId('canvas-C')).toHaveAttribute('data-surface-state', 'parked')

    const active = screen.getByTestId('canvas-runtime-surface-A')
    const inactive = screen.getByTestId('canvas-runtime-surface-B')
    expect(active).toHaveAttribute('aria-hidden', 'false')
    expect(active).not.toHaveAttribute('inert')
    expect(active).toHaveClass('visible', 'z-10', 'opacity-100', 'pointer-events-auto')
    expect(inactive).toHaveAttribute('aria-hidden', 'true')
    expect(inactive).toHaveAttribute('inert')
    expect(inactive).toHaveClass('invisible', 'z-0', 'opacity-0', 'pointer-events-none')
    expect(screen.getByTestId('explicitly-visible-B')).toHaveStyle({ visibility: 'visible' })
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

  it('unregisters an evicted controller once and creates a fresh controller when reopened', () => {
    const first = canvasProps('A')
    const second = canvasProps('B')
    const reopened = canvasProps('A')
    const controllers = new Map<string, { id: string }>()
    let controllerSequence = 0
    const TestCanvas: ComponentType<WorkbenchCanvasProps> = ({ runtimeKey, onViewportReady }) => {
      useEffect(() => {
        const controller = { id: `${runtimeKey}-${String(++controllerSequence)}` }
        controllers.set(controller.id, controller)
        onViewportReady(controller as never)
      }, [onViewportReady, runtimeKey])
      return <div data-testid={`canvas-${runtimeKey}`} />
    }

    const view = render(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={first}
        renderCanvas={TestCanvas}
      />,
    )
    expect(first.onViewportReady).toHaveBeenCalledOnce()
    const originalController = vi.mocked(first.onViewportReady).mock.calls[0]?.[0]

    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['B']}
        canvas={second}
        renderCanvas={TestCanvas}
      />,
    )
    expect(screen.queryByTestId('canvas-A')).not.toBeInTheDocument()

    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={reopened}
        renderCanvas={TestCanvas}
      />,
    )
    expect(reopened.onViewportReady).toHaveBeenCalledOnce()
    expect(vi.mocked(reopened.onViewportReady).mock.calls[0]?.[0]).not.toBe(originalController)
  })

  it('keeps inspector-only updates on the active surface', () => {
    const renders = new Map<string, number>()
    const TestCanvas: ComponentType<WorkbenchCanvasProps> = ({ runtimeKey, inspectorOpen }) => {
      renders.set(runtimeKey!, (renders.get(runtimeKey!) ?? 0) + 1)
      return <div data-testid={`canvas-${runtimeKey}`}>{String(inspectorOpen)}</div>
    }
    const first = canvasProps('A')
    const second = canvasProps('B')
    const view = render(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={first}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={second}
        renderCanvas={TestCanvas}
      />,
    )
    const parkedRenders = renders.get('A')

    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={{ ...second, inspectorOpen: true }}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={{ ...second, inspectorOpen: false }}
        renderCanvas={TestCanvas}
      />,
    )

    expect(renders.get('A')).toBe(parkedRenders)
    expect(renders.get('B')).toBe(3)
  })

  it('retains the latest immutable snapshot when a Canvas is parked and reopened', () => {
    const TestCanvas: ComponentType<WorkbenchCanvasProps> = ({ runtimeKey, validationMessage }) => (
      <div data-testid={`canvas-${runtimeKey}`}>{validationMessage}</div>
    )
    const first = canvasProps('A')
    const updatedFirst = { ...first, validationMessage: 'Updated snapshot' }
    const second = canvasProps('B')
    const view = render(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={first}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={updatedFirst}
        renderCanvas={TestCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={second}
        renderCanvas={TestCanvas}
      />,
    )

    expect(screen.getByTestId('canvas-A')).toHaveTextContent('Updated snapshot')
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['B', 'A']}
        canvas={updatedFirst}
        renderCanvas={TestCanvas}
      />,
    )
    expect(screen.getByTestId('canvas-A')).toHaveTextContent('Updated snapshot')
  })

  it('rerenders retained layers when the injected Canvas implementation changes', () => {
    const FirstCanvas = ({ runtimeKey }: WorkbenchCanvasProps) => <div data-testid={`first-${runtimeKey}`} />
    const SecondCanvas = ({ runtimeKey }: WorkbenchCanvasProps) => <div data-testid={`second-${runtimeKey}`} />
    const first = canvasProps('A')
    const second = canvasProps('B')
    const view = render(
      <CanvasSurfacePool
        activeRuntimeKey="A"
        activeReady
        retainedRuntimeKeys={['A']}
        canvas={first}
        renderCanvas={FirstCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={second}
        renderCanvas={FirstCanvas}
      />,
    )
    view.rerender(
      <CanvasSurfacePool
        activeRuntimeKey="B"
        activeReady
        retainedRuntimeKeys={['A', 'B']}
        canvas={second}
        renderCanvas={SecondCanvas}
      />,
    )

    expect(screen.queryByTestId('first-A')).not.toBeInTheDocument()
    expect(screen.getByTestId('second-A')).toBeInTheDocument()
    expect(screen.getByTestId('second-B')).toBeInTheDocument()
  })

  it('does not retain a stale controller after Strict Mode remounting', () => {
    const first = canvasProps('A')
    const TestCanvas: ComponentType<WorkbenchCanvasProps> = ({ runtimeKey, onViewportReady }) => {
      useEffect(() => {
        onViewportReady({ runtimeKey } as never)
      }, [onViewportReady, runtimeKey])
      return <div>{runtimeKey}</div>
    }

    const view = render(
      <StrictMode>
        <CanvasSurfacePool
          activeRuntimeKey="A"
          activeReady
          retainedRuntimeKeys={['A']}
          canvas={first}
          renderCanvas={TestCanvas}
        />
      </StrictMode>,
    )
    expect(first.onViewportReady).toHaveBeenCalled()
    const callsBeforeUnmount = vi.mocked(first.onViewportReady).mock.calls.length
    view.unmount()

    expect(vi.mocked(first.onViewportReady).mock.calls).toHaveLength(callsBeforeUnmount)
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
