import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InventorySidebar } from '@/components/inventory-sidebar'
import type { InventoryItem, InventoryType, ProjectState } from '@/types/inventory'

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
  'network', 'wireless', 'soundCard', 'case', 'powerSupply', 'powerAdapter', 'nas',
  'switch', 'patchPanel', 'monitor', 'ups', 'powerStrip',
]

const orderedLabels = [
  'Server', 'PC Build', 'CPU', 'CPU Cooler', 'Motherboard', 'RAM', 'Storage', 'GPU',
  'Network', 'Wireless', 'Sound Card', 'Case', 'Power Supply', 'Power Adapter', 'NAS',
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
    render(
      <InventorySidebar
        project={completeInventoryProject}
        onSelect={vi.fn()}
        onCreateItem={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('inventory-category-label').map((label) => label.textContent))
      .toEqual(orderedLabels)
  })

  it('classifies standalone canvas equipment and assignable components for dragging', () => {
    render(
      <InventorySidebar
        project={completeInventoryProject}
        onSelect={vi.fn()}
        onCreateItem={vi.fn()}
      />,
    )

    const dragRole = (type: InventoryType) =>
      document.querySelector(`[data-inventory-item-id^="${type}:"]`)

    for (const type of ['server', 'pcBuild', 'nas', 'switch', 'patchPanel', 'monitor', 'ups', 'powerStrip']) {
      expect(dragRole(type as InventoryType)).toHaveAttribute('data-inventory-drag-role', 'equipment')
    }

    for (const type of ['cpu', 'cpuCooler', 'motherboard', 'wireless', 'powerSupply', 'powerAdapter']) {
      expect(dragRole(type as InventoryType)).toHaveAttribute('data-inventory-drag-role', 'component')
    }
  })
})
