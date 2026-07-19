import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InventorySidebar } from '@/components/inventory-sidebar'
import type { ProjectState } from '@/types/inventory'

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
})
