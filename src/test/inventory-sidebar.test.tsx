import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InventorySidebar } from '@/components/inventory-sidebar'
import { getInventoryDragRole } from '@/lib/inventory-capabilities'
import { createInventoryVirtualRows } from '@/lib/inventory-virtual-rows'
import { renderWithOpenAuth } from '@/test/open-auth-test-render'
import type { InventoryItem, InventoryType, ProjectState } from '@/types/inventory'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: {
    count: number
    estimateSize(index: number): number
  }) => {
    const sizes = Array.from({ length: count }, (_, index) => estimateSize(index))
    return {
      getTotalSize: () => sizes.reduce((total, size) => total + size, 0),
      getVirtualItems: () => sizes.map((size, index) => ({
        index,
        key: index,
        size,
        start: sizes.slice(0, index).reduce((total, value) => total + value, 0),
      })),
      measureElement: vi.fn(),
    }
  },
}))

function render(element: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithOpenAuth(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  )
}

const project: ProjectState = {
  id: 'default',
  metadata: {
    name: 'Test Project',
    version: 1,
    updatedAt: '2026-07-19T00:00:00.000Z',
  },
  items: {},
  placements: [],
  assignments: [],
  connections: [],
}

const projectWithInventory: ProjectState = {
  ...project,
  items: {
    'switch:1': {
      id: 1,
      type: 'switch',
      name: 'NETGEAR GS108T #1',
      manufacturer: 'NETGEAR',
      model: 'GS108T',
      ports: [
        {
          id: 1,
          kind: 'switch-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '1G',
        },
      ],
    },
  },
}

const orderedTypes: InventoryType[] = [
  'server', 'pcBuild', 'cpu', 'cpuCooler', 'motherboard', 'ram', 'storage', 'gpu',
  'network', 'soundCard', 'case', 'powerSupply', 'powerAdapter', 'nas',
  'switch', 'patchPanel', 'monitor', 'ups', 'powerStrip',
]

const orderedLabels = [
  'Server', 'PC Build', 'CPU', 'CPU Cooler', 'Motherboard', 'RAM', 'Storage', 'GPU',
  'Network Adapter', 'Sound Card', 'Case', 'Power Supply', 'Power Adapter', 'NAS',
  'Switch', 'Patch Panel', 'Monitor', 'UPS', 'Power Strip',
]

const completeInventoryProject: ProjectState = {
  ...project,
  items: Object.fromEntries(orderedTypes.map((type, index) => {
    const key = `${type}:${index + 1}`
    const item: InventoryItem = {
      id: index + 1,
      key,
      type,
      name: `${orderedLabels[index]} item`,
    }
    return [key, item]
  })),
}

describe('InventorySidebar', () => {
  beforeEach(() => window.localStorage.clear())

  it('renders separate Add and mobile close actions', () => {
    const onClose = vi.fn()

    render(
      <InventorySidebar
        project={project}
        onSelect={vi.fn()}
        onCreateItem={vi.fn()}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close inventory' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Add inventory item' })).not.toBeInTheDocument()
  })

  it('omits the close action in the desktop sidebar', () => {
    render(
      <InventorySidebar
        project={project}
        onSelect={vi.fn()}
        onCreateItem={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Close inventory' })).not.toBeInTheDocument()
  })

  it('keeps the multi-select icon visible in its active state', () => {
    render(
      <InventorySidebar
        project={projectWithInventory}
        onSelect={vi.fn()}
        onCreateItem={vi.fn()}
      />,
    )

    const selectionButton = screen.getByRole('button', { name: 'Select inventory items' })
    fireEvent.click(selectionButton)

    expect(screen.getByRole('button', { name: 'Exit inventory selection' })).toHaveClass(
      'bg-[#ddb668]',
      'text-[#20242c]',
    )
  })

  it('centers item icons, action menus, and selection checkboxes vertically', () => {
    render(
      <InventorySidebar
        project={projectWithInventory}
        onSelect={vi.fn()}
        onCreateItem={vi.fn()}
      />,
    )

    const itemButton = screen.getByTestId('inventory-item')
    expect(itemButton.querySelector('svg')?.parentElement).toHaveClass('items-center')

    expect(screen.getByRole('button', { name: 'Actions for NETGEAR GS108T #1' }).parentElement).toHaveClass(
      'top-1/2',
      '-translate-y-1/2',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select inventory items' }))
    expect(screen.getByRole('checkbox', { name: 'Select NETGEAR GS108T #1' })).toHaveClass(
      'top-1/2',
      '-translate-y-1/2',
    )
  })

  it('shows all inventory categories in the approved order', () => {
    const rows = createInventoryVirtualRows(Object.values(completeInventoryProject.items), new Set())
    const categoryLabels = rows.flatMap((row) => row.kind === 'category'
      ? [orderedLabels[orderedTypes.indexOf(row.type)]]
      : [])

    expect(categoryLabels).toEqual(orderedLabels)
  })

  it('classifies standalone canvas equipment and assignable components for dragging', () => {
    for (const type of ['server', 'pcBuild', 'nas', 'switch', 'patchPanel', 'monitor', 'ups', 'powerStrip']) {
      expect(getInventoryDragRole(type as InventoryType)).toBe('equipment')
    }

    for (const type of ['cpu', 'cpuCooler', 'motherboard', 'network', 'powerSupply', 'powerAdapter']) {
      expect(getInventoryDragRole(type as InventoryType)).toBe('component')
    }
  })

  it('explains matches hidden by availability and preserves the other filters', () => {
    render(
      <InventorySidebar
        project={{
          ...projectWithInventory,
          placements: [{ serverId: 'switch:1', x: 0, y: 0 }],
        }}
        onSelect={vi.fn()}
        onCreateItem={vi.fn()}
      />,
    )

    expect(screen.getByText('1 matching item is hidden by the availability filter.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))

    expect(screen.getByTestId('inventory-item')).toHaveTextContent('NETGEAR GS108T #1')
  })

  it('keeps the generic empty state when no status-hidden match exists', () => {
    render(
      <InventorySidebar
        project={project}
        onSelect={vi.fn()}
        onCreateItem={vi.fn()}
      />,
    )

    expect(screen.getByText('No inventory items match the current filters.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument()
  })
})
