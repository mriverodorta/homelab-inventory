import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { EdgeProps } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CableEdge,
  type CableEdgeData,
  type CableFlowEdge,
} from '@/components/cable-edge'
import type { CableObstacle } from '@/lib/cable-obstacle-routing'

vi.mock('@xyflow/react', () => ({
  BaseEdge: ({
    path,
    interactionWidth: _interactionWidth,
    ...props
  }: {
    path: string
    interactionWidth?: number
  }) => <path data-testid="base-cable-path" d={path} {...props} />,
  useReactFlow: () => ({
    getViewport: () => ({ zoom: 1 }),
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  }),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderCable({
  selected = false,
  hovered = false,
  editable = selected,
  snapToGrid = false,
  plannedPoints,
  obstacles = [],
  sourcePosition = 'right',
  targetPosition = 'left',
}: {
  selected?: boolean
  hovered?: boolean
  editable?: boolean
  snapToGrid?: boolean
  plannedPoints?: Array<{ x: number; y: number }>
  obstacles?: CableObstacle[]
  sourcePosition?: 'left' | 'right' | 'top' | 'bottom'
  targetPosition?: 'left' | 'right' | 'top' | 'bottom'
} = {}) {
  const onSelect = vi.fn()
  const onUpdateRoute = vi.fn()
  const data = {
    color: '#ef7d32',
    label: '1G',
    detail: 'Server NIC to switch port',
    laneOffset: 24,
    selected,
    hovered,
    dimmed: false,
    editable,
    connectionId: 1,
    obstacles,
    sourceItemId: 'server:1',
    targetItemId: 'switch:1',
    snapToGrid,
    plannedRoute: plannedPoints
      ? { points: plannedPoints, manualAnchorPointIndexes: [], usedFallback: false }
      : undefined,
    onSelect,
    onUpdateRoute,
  } satisfies CableEdgeData
  const props = {
    id: 'cable:1',
    sourceX: 0,
    sourceY: 0,
    sourcePosition,
    targetX: 200,
    targetY: 100,
    targetPosition,
    data,
  } as unknown as EdgeProps<CableFlowEdge>

  render(
    <svg>
      <CableEdge {...props} />
    </svg>,
  )

  return { onSelect, onUpdateRoute }
}

function movableHorizontalSegment(): SVGPathElement {
  const segment = screen.getAllByLabelText('Move horizontal cable segment')
    .map((candidate) => {
      const coordinates = candidate.getAttribute('d')?.match(/M ([\d.-]+),([\d.-]+) L ([\d.-]+),([\d.-]+)/)
      return {
        candidate,
        length: coordinates ? Math.abs(Number(coordinates[3]) - Number(coordinates[1])) : 0,
      }
    })
    .sort((first, second) => second.length - first.length)[0]?.candidate

  if (!segment) {
    throw new Error('Expected the long horizontal cable segment to be draggable.')
  }

  return segment as unknown as SVGPathElement
}

function movableVerticalSegment(): SVGPathElement {
  const segment = screen.getAllByLabelText('Move vertical cable segment')
    .map((candidate) => {
      const coordinates = candidate.getAttribute('d')?.match(/M ([\d.-]+),([\d.-]+) L ([\d.-]+),([\d.-]+)/)
      return {
        candidate,
        length: coordinates ? Math.abs(Number(coordinates[4]) - Number(coordinates[2])) : 0,
      }
    })
    .sort((first, second) => second.length - first.length)[0]?.candidate

  if (!segment) {
    throw new Error('Expected the long vertical cable segment to be draggable.')
  }

  return segment as unknown as SVGPathElement
}

describe('CableEdge route dragging', () => {
  it('renders a matching batch-planned route', () => {
    renderCable({
      plannedPoints: [
        { x: 0, y: 0 },
        { x: 24, y: 0 },
        { x: 24, y: 120 },
        { x: 176, y: 120 },
        { x: 176, y: 100 },
        { x: 200, y: 100 },
      ],
    })

    expect(screen.getByTestId('base-cable-path')).toHaveAttribute(
      'd',
      'M 0,0 L 24,0 L 24,120 L 176,120 L 176,100 L 200,100',
    )
  })

  it('falls back to a live route while an endpoint no longer matches the batch plan', () => {
    renderCable({
      plannedPoints: [
        { x: 12, y: 0 },
        { x: 24, y: 0 },
        { x: 176, y: 100 },
        { x: 200, y: 100 },
      ],
    })

    expect(screen.getByTestId('base-cable-path')).toHaveAttribute(
      'd',
      'M 0,0 L 24,0 L 176,0 L 176,100 L 200,100',
    )
  })

  it('does not expose route drag hit areas until the cable is selected', () => {
    renderCable({ selected: false, hovered: true, editable: true })

    expect(screen.queryAllByLabelText(/Move (horizontal|vertical) cable segment/)).toHaveLength(0)
    expect(screen.getByTestId('base-cable-path')).toHaveStyle({ strokeWidth: '6' })
  })

  it('does not save a route when a selected cable is clicked without movement', () => {
    const { onSelect, onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()

    fireEvent.pointerDown(segment, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    })

    expect(onSelect).toHaveBeenCalledWith(1)
    expect(onUpdateRoute).not.toHaveBeenCalled()
  })

  it('adds one manual anchor when a selected segment is double-clicked', () => {
    const { onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()

    fireEvent.doubleClick(segment, { clientX: 101, clientY: 100 })

    expect(onUpdateRoute).toHaveBeenCalledWith(1, expect.objectContaining({
      bendPoints: [{ x: 101, y: 0 }],
    }))
  })

  it('snaps a newly inserted manual anchor to a twelve-pixel cable lane when enabled', () => {
    const { onUpdateRoute } = renderCable({ selected: true, snapToGrid: true })
    const segment = movableHorizontalSegment()

    fireEvent.doubleClick(segment, { clientX: 101, clientY: 100 })

    expect(onUpdateRoute).toHaveBeenCalledWith(1, expect.objectContaining({
      bendPoints: [{ x: 96, y: 0 }],
    }))
  })

  it('ignores movement below the four-pixel activation threshold', () => {
    const { onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()
    const originalPath = screen.getByTestId('base-cable-path').getAttribute('d')

    fireEvent.pointerDown(segment, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 102,
      clientY: 102,
    })
    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 102,
      clientY: 102,
    })

    expect(screen.getByTestId('base-cable-path')).toHaveAttribute('d', originalPath)
    expect(onUpdateRoute).not.toHaveBeenCalled()
  })

  it('previews and saves a selected cable after crossing the movement threshold', () => {
    const { onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()
    const originalPath = screen.getByTestId('base-cable-path').getAttribute('d')

    fireEvent.pointerDown(segment, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 120,
    })

    expect(screen.getByTestId('base-cable-path')).not.toHaveAttribute('d', originalPath)
    expect(onUpdateRoute).not.toHaveBeenCalled()

    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 120,
    })

    expect(onUpdateRoute).toHaveBeenCalledTimes(1)
    expect(onUpdateRoute).toHaveBeenCalledWith(1, expect.objectContaining({
      bendPoints: expect.any(Array),
    }))
  })

  it('previews and saves the simplified endpoint approach after moving a segment', () => {
    const { onUpdateRoute } = renderCable({
      selected: true,
      sourcePosition: 'left',
      targetPosition: 'top',
      plannedPoints: [
        { x: 0, y: 0 },
        { x: -24, y: 0 },
        { x: -24, y: 40 },
        { x: -80, y: 40 },
        { x: -80, y: 160 },
        { x: 200, y: 160 },
        { x: 200, y: 100 },
      ],
    })
    const segment = movableVerticalSegment()

    fireEvent.pointerDown(segment, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: -80,
      clientY: 100,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: -100,
      clientY: 100,
    })

    expect(screen.getByTestId('base-cable-path')).toHaveAttribute(
      'd',
      'M 0,0 L -100,0 L -100,160 L 200,160 L 200,100',
    )

    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: -100,
      clientY: 100,
    })

    expect(onUpdateRoute).toHaveBeenCalledWith(1, expect.objectContaining({
      bendPoints: [
        { x: -100, y: 0 },
        { x: -100, y: 160 },
        { x: 200, y: 160 },
      ],
    }))
  })

  it('keeps the existing endpoint staircase when the shorter approach crosses equipment', () => {
    renderCable({
      selected: true,
      sourcePosition: 'left',
      targetPosition: 'top',
      obstacles: [{ itemId: 'server:2', left: -70, top: -10, right: -50, bottom: 10 }],
      plannedPoints: [
        { x: 0, y: 0 },
        { x: -24, y: 0 },
        { x: -24, y: 40 },
        { x: -80, y: 40 },
        { x: -80, y: 160 },
        { x: 200, y: 160 },
        { x: 200, y: 100 },
      ],
    })
    const segment = movableVerticalSegment()

    fireEvent.pointerDown(segment, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: -80,
      clientY: 100,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: -100,
      clientY: 100,
    })

    expect(screen.getByTestId('base-cable-path')).toHaveAttribute(
      'd',
      'M 0,0 L -24,0 L -24,40 L -100,40 L -100,160 L 200,160 L 200,100',
    )
  })

  it('discards an active route preview when the pointer is canceled', () => {
    const { onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()
    const originalPath = screen.getByTestId('base-cable-path').getAttribute('d')

    fireEvent.pointerDown(segment, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 120,
    })
    expect(screen.getByTestId('base-cable-path')).not.toHaveAttribute('d', originalPath)

    fireEvent.pointerCancel(window, { pointerId: 1, pointerType: 'mouse' })

    expect(screen.getByTestId('base-cable-path')).toHaveAttribute('d', originalPath)
    expect(onUpdateRoute).not.toHaveBeenCalled()
  })

  it('keeps touch route dragging behind both selection and hold activation', () => {
    vi.useFakeTimers()
    const { onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()
    const originalPath = screen.getByTestId('base-cable-path').getAttribute('d')

    fireEvent.pointerDown(segment, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    })
    act(() => vi.advanceTimersByTime(350))
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100,
      clientY: 120,
    })

    expect(screen.getByTestId('base-cable-path')).not.toHaveAttribute('d', originalPath)

    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100,
      clientY: 120,
    })
    expect(onUpdateRoute).toHaveBeenCalledTimes(1)
  })
})
