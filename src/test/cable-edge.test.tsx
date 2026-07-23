import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EdgeProps } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CableEdge,
  type CableEdgeData,
  type CableFlowEdge,
} from '@/components/cable-edge'

const engineMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  preview: vi.fn(),
}))

vi.mock('@/engine/routing', () => ({
  insertCableManualBend: engineMocks.insert,
  previewCableRouteSegment: engineMocks.preview,
}))

vi.mock('@/hooks/use-domain-engine', () => ({
  useDomainEngine: () => ({ enabled: true, client: {} }),
}))

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

const defaultPoints = [
  { x: 0, y: 0 },
  { x: 24, y: 0 },
  { x: 24, y: 100 },
  { x: 176, y: 100 },
  { x: 176, y: 100 },
  { x: 200, y: 100 },
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  engineMocks.insert.mockReset()
  engineMocks.preview.mockReset()
  engineMocks.insert.mockResolvedValue({
    route: {
      points: defaultPoints,
      manualAnchorPointIndexes: [2],
      usedFallback: false,
    },
    bendPoints: [{ x: 100, y: 100 }],
  })
  engineMocks.preview.mockImplementation(async (_: unknown, input: { coordinate: number }) => ({
    route: {
      points: [
        { x: 0, y: 0 },
        { x: 24, y: 0 },
        { x: 24, y: input.coordinate },
        { x: 176, y: input.coordinate },
        { x: 176, y: 100 },
        { x: 200, y: 100 },
      ],
      manualAnchorPointIndexes: [],
      usedFallback: false,
    },
    bendPoints: [
      { x: 24, y: 0 },
      { x: 24, y: input.coordinate },
      { x: 176, y: input.coordinate },
      { x: 176, y: 100 },
    ],
  }))
})

function renderCable({
  selected = false,
  hovered = false,
  editable = selected,
  snapToGrid = false,
  plannedPoints = defaultPoints,
}: {
  selected?: boolean
  hovered?: boolean
  editable?: boolean
  snapToGrid?: boolean
  plannedPoints?: Array<{ x: number; y: number }>
} = {}) {
  const onSelect = vi.fn()
  const onUpdateRoute = vi.fn()
  const data = {
    color: '#ef7d32',
    label: '1G',
    detail: 'Server NIC to switch port',
    selected,
    hovered,
    dimmed: false,
    editable,
    connectionId: 1,
    snapToGrid,
    plannedRoute: {
      points: plannedPoints,
      manualAnchorPointIndexes: [],
      usedFallback: false,
    },
    onSelect,
    onUpdateRoute,
  } satisfies CableEdgeData
  const props = {
    id: 'cable:1',
    sourceX: 0,
    sourceY: 0,
    sourcePosition: 'right',
    targetX: 200,
    targetY: 100,
    targetPosition: 'left',
    data,
  } as unknown as EdgeProps<CableFlowEdge>

  render(<svg><CableEdge {...props} /></svg>)
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
  if (!segment) throw new Error('Expected a horizontal cable segment.')
  return segment as unknown as SVGPathElement
}

describe('CableEdge route interaction', () => {
  it('renders only the matching WASM-planned route', () => {
    renderCable()
    expect(screen.getByTestId('base-cable-path')).toHaveAttribute(
      'd',
      'M 0,0 L 24,0 L 24,100 L 176,100 L 176,100 L 200,100',
    )
  })

  it('does not calculate a TypeScript fallback for a stale endpoint route', () => {
    renderCable({ plannedPoints: [{ x: 12, y: 0 }, { x: 200, y: 100 }] })
    expect(screen.getByTestId('base-cable-path')).toHaveAttribute('d', '')
  })

  it('does not expose drag hit areas until selected', () => {
    renderCable({ selected: false, hovered: true, editable: true })
    expect(screen.queryAllByLabelText(/Move (horizontal|vertical) cable segment/)).toHaveLength(0)
    expect(screen.getByTestId('base-cable-path')).toHaveStyle({ strokeWidth: '6' })
  })

  it('does not preview or save when clicked without movement', () => {
    const { onSelect, onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()
    fireEvent.pointerDown(segment, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(engineMocks.preview).not.toHaveBeenCalled()
    expect(onUpdateRoute).not.toHaveBeenCalled()
  })

  it('delegates manual bend insertion to the WASM route planner', async () => {
    const { onUpdateRoute } = renderCable({ selected: true, snapToGrid: true })
    fireEvent.doubleClick(movableHorizontalSegment(), { clientX: 101, clientY: 100 })
    await waitFor(() => expect(onUpdateRoute).toHaveBeenCalledWith(1, expect.objectContaining({
      bendPoints: [{ x: 100, y: 100 }],
    })))
    expect(engineMocks.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      connectionId: 1,
      snapToGrid: true,
    }))
  })

  it('previews and commits a dragged segment through WASM', async () => {
    const { onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()
    fireEvent.pointerDown(segment, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 120 })
    await waitFor(() => expect(screen.getByTestId('base-cable-path')).toHaveAttribute(
      'd',
      'M 0,0 L 24,0 L 24,120 L 176,120 L 176,100 L 200,100',
    ))
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 120 })
    await waitFor(() => expect(onUpdateRoute).toHaveBeenCalledTimes(1))
  })

  it('discards an active preview when the pointer is canceled', async () => {
    const { onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()
    fireEvent.pointerDown(segment, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 120 })
    await waitFor(() => expect(engineMocks.preview).toHaveBeenCalled())
    fireEvent.pointerCancel(window, { pointerId: 1, pointerType: 'mouse' })
    expect(onUpdateRoute).not.toHaveBeenCalled()
  })

  it('keeps touch dragging behind hold activation', async () => {
    vi.useFakeTimers()
    const { onUpdateRoute } = renderCable({ selected: true })
    const segment = movableHorizontalSegment()
    fireEvent.pointerDown(segment, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    act(() => vi.advanceTimersByTime(350))
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 120 })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 120 })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onUpdateRoute).toHaveBeenCalledTimes(1)
  })
})
