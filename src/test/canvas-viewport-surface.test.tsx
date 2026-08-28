import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasViewportSurface } from '@/components/canvas/canvas-viewport-surface'

const flowProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      flowProps.current = props
      return <div data-testid="react-flow">{props.children}</div>
    },
    Background: () => <div data-testid="background" />,
    Controls: () => <div data-testid="controls" />,
    MiniMap: () => <div data-testid="minimap" />,
  }
})

vi.mock('@/components/canvas-command-bar', () => ({
  CanvasCommandBar: () => <div data-testid="command-bar" />,
}))

function renderSurface(active: boolean) {
  return render(<CanvasViewportSurface
    active={active}
    canvasRootRef={{ current: null }}
    droppableRef={() => undefined}
    isDropTarget={false}
    hasPlacements
    nodes={[]}
    edges={[]}
    flowEvents={{ onPaneClick: vi.fn() }}
    nodeDragThreshold={4}
    snapItemsToGrid={false}
    initialViewport={null}
    onViewportChange={vi.fn()}
    forceRenderAllNodes={false}
    nodesDraggable
    activity={null}
    validationMessage={null}
    validationSeverity="error"
    commandBar={{} as never}
  />)
}

describe('CanvasViewportSurface', () => {
  it('removes active-only chrome and interactions while parked', () => {
    renderSurface(false)

    expect(screen.queryByTestId('command-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('controls')).not.toBeInTheDocument()
    expect(screen.queryByTestId('minimap')).not.toBeInTheDocument()
    expect(flowProps.current).toMatchObject({
      connectOnClick: false,
      nodesConnectable: false,
      nodesDraggable: false,
      panOnDrag: false,
      zoomOnScroll: false,
      zoomOnPinch: false,
    })
    expect(flowProps.current.onPaneClick).toBeUndefined()
  })

  it('renders one active chrome set and preserves custom flow events while active', () => {
    renderSurface(true)

    expect(screen.getByTestId('command-bar')).toBeInTheDocument()
    expect(screen.getByTestId('controls')).toBeInTheDocument()
    expect(screen.getByTestId('minimap')).toBeInTheDocument()
    expect(flowProps.current.onPaneClick).toBeTypeOf('function')
  })
})
