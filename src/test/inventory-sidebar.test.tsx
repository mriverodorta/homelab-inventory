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
})
