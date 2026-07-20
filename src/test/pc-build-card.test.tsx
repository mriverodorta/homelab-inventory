import { fireEvent, render, screen } from '@testing-library/react'
import type { NodeProps } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { PcBuildNode, type PcBuildFlowNode } from '@/components/pc-build-card'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ComponentAssignment, InventoryItem, ProjectState } from '@/types/inventory'

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false,
  }),
}))

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type }: { id: string; type: string }) => (
    <span data-testid={`handle-${id}`} data-handle-type={type} />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
}))

const pcBuild: InventoryItem = {
  id: 1,
  key: 'pcBuild:1',
  type: 'pcBuild',
  name: 'Gaming Workstation',
  specs: { operatingSystem: 'Windows 11 Pro' },
  properties: { displayName: 'Aurora' },
}

const motherboard: InventoryItem = {
  id: 1,
  key: 'motherboard:1',
  type: 'motherboard',
  name: 'ASUS ProArt X670E',
  specs: { formFactor: 'ATX', socket: 'AM5' },
  ports: [{
    id: 1,
    kind: 'server-port',
    type: 'rj45',
    slotNumber: 1,
    speed: '2.5G',
  }],
}

const gpu: InventoryItem = {
  id: 1,
  key: 'gpu:1',
  type: 'gpu',
  name: 'NVIDIA RTX 4070',
  manufacturer: 'NVIDIA',
  model: 'RTX 4070',
  ports: [{
    id: 1,
    kind: 'server-port',
    type: 'displayport',
    slotNumber: 1,
  }],
}

function assignment(id: number, item: InventoryItem): ComponentAssignment {
  return {
    id,
    serverId: pcBuild.key!,
    itemId: item.key!,
    type: item.type as ComponentAssignment['type'],
    assignedAt: '2026-07-20T00:00:00.000Z',
  }
}

function project(items: InventoryItem[] = [], assignments: ComponentAssignment[] = []): ProjectState {
  return {
    id: 'default',
    metadata: {
      name: 'PC Build card test',
      version: 1,
      updatedAt: '2026-07-20T00:00:00.000Z',
    },
    items: Object.fromEntries([pcBuild, ...items].map((item) => [item.key!, item])),
    placements: [{ serverId: pcBuild.key!, x: 0, y: 0 }],
    assignments,
    connections: [],
  }
}

function nodeProps(
  currentProject: ProjectState,
  overrides: Partial<PcBuildFlowNode['data']> = {},
): NodeProps<PcBuildFlowNode> {
  return {
    id: pcBuild.key!,
    type: 'pcBuild',
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      project: currentProject,
      pcBuildId: pcBuild.key!,
      selectedItemId: null,
      focusedItemIds: [],
      focusActive: false,
      spotlightItemId: null,
      pendingEndpoint: null,
      draggingEndpoint: null,
      onSelect: vi.fn(),
      onRemoveAssignment: vi.fn(),
      onEndpointClick: vi.fn(),
      onEndpointDragStart: vi.fn(),
      onEndpointDrop: vi.fn(),
      ...overrides,
    },
  }
}

function renderCard(props: NodeProps<PcBuildFlowNode>) {
  return render(
    <TooltipProvider>
      <PcBuildNode {...props} />
    </TooltipProvider>,
  )
}

describe('PcBuildNode', () => {
  it('renders host metadata and every required empty component row', () => {
    renderCard(nodeProps(project()))

    expect(screen.getByText('Gaming Workstation')).toBeInTheDocument()
    expect(screen.getByText('Aurora')).toBeInTheDocument()
    expect(screen.getByText('Windows 11 Pro')).toBeInTheDocument()
    expect(screen.getByText('Motherboard drop slot')).toBeInTheDocument()
    expect(screen.getByText('CPU drop slot')).toBeInTheDocument()
    expect(screen.getByText('CPU Cooler drop slot')).toBeInTheDocument()
    expect(screen.getByText('RAM drop slot')).toBeInTheDocument()
    expect(screen.getByText('Storage drop slot')).toBeInTheDocument()
    expect(screen.getByText('Power Supply drop slot')).toBeInTheDocument()
    expect(screen.queryByText('GPU drop slot')).not.toBeInTheDocument()
  })

  it('shows motherboard I/O and optional assigned component rows', () => {
    const currentProject = project(
      [motherboard, gpu],
      [assignment(1, motherboard), assignment(2, gpu)],
    )

    renderCard(nodeProps(currentProject))

    expect(screen.getByText('Motherboard I/O')).toBeInTheDocument()
    expect(screen.getByText('ATX / AM5')).toBeInTheDocument()
    expect(screen.getByText('NVIDIA RTX 4070')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '01 2.5G' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '01 DP' })).toBeInTheDocument()
  })

  it('uses existing selection, removal, and endpoint callback contracts', () => {
    const onSelect = vi.fn()
    const onRemoveAssignment = vi.fn()
    const onEndpointClick = vi.fn()
    const currentProject = project(
      [motherboard, gpu],
      [assignment(1, motherboard), assignment(2, gpu)],
    )

    renderCard(nodeProps(currentProject, { onSelect, onRemoveAssignment, onEndpointClick }))

    fireEvent.keyDown(screen.getByText('NVIDIA RTX 4070').closest('[role="button"]')!, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('gpu:1')

    fireEvent.click(screen.getByRole('button', { name: 'Remove NVIDIA RTX 4070' }))
    expect(onRemoveAssignment).toHaveBeenCalledWith(2)

    fireEvent.click(screen.getByRole('button', { name: '01 2.5G' }), { clientX: 40, clientY: 60 })
    expect(onEndpointClick).toHaveBeenCalledWith(
      { itemId: 'pcBuild:1', hostedItemId: 'motherboard:1', portId: 1 },
      { x: 40, y: 60 },
    )
  })

  it('starts a drag from a selected assigned port', () => {
    const onEndpointDragStart = vi.fn()
    const endpoint = { itemId: 'pcBuild:1', hostedItemId: 'motherboard:1', portId: 1 }
    const currentProject = project([motherboard], [assignment(1, motherboard)])

    renderCard(nodeProps(currentProject, {
      pendingEndpoint: endpoint,
      onEndpointDragStart,
    }))

    const port = screen.getByRole('button', { name: '01 2.5G' })
    fireEvent.pointerDown(port, { pointerType: 'mouse', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 10 })

    expect(onEndpointDragStart).toHaveBeenCalledWith(endpoint, { x: 10, y: 10 })
  })

  it('applies focus and compatibility states to the host card', () => {
    const { container } = renderCard(nodeProps(project(), {
      focusActive: true,
      focusedItemIds: [],
      dropCompatibilityStatus: 'incompatible',
    }))

    const card = container.querySelector('[data-pc-build-card="pcBuild:1"]')
    expect(card).toHaveClass('opacity-35')
    expect(card).toHaveClass('ring-[#c85b4a]')
    expect(card).toHaveAttribute('data-compatibility-drop', 'incompatible')
  })
})
