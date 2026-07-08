import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditDrawer } from '@/components/audit-drawer'
import type { ProjectState } from '@/types/inventory'

const project: ProjectState = {
  id: 'test-project',
  metadata: {
    name: 'Test Project',
    version: 1,
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  items: {
    server: {
      id: 'server',
      name: 'Server A',
      type: 'server',
      ports: [
        {
          id: 'lan-01',
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '1G',
        },
      ],
    },
    switch: {
      id: 'switch',
      name: 'Switch A',
      type: 'switch',
      ports: [
        {
          id: 'rj45-01',
          kind: 'switch-port',
          type: 'rj45',
          slotNumber: 1,
          speed: '2.5G',
        },
      ],
    },
  },
  placements: [
    {
      serverId: 'switch',
      x: 0,
      y: 0,
    },
  ],
  assignments: [],
  connections: [
    {
      id: 'connection-1',
      from: {
        itemId: 'switch',
        portId: 'rj45-01',
      },
      to: {
        itemId: 'server',
        portId: 'lan-01',
      },
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
    },
  ],
}

afterEach(() => {
  cleanup()
})

describe('AuditDrawer', () => {
  it('renders grouped audit warnings and selects an item from a warning', () => {
    const onSelectItem = vi.fn()

    render(
      <AuditDrawer
        project={project}
        open
        onClose={vi.fn()}
        onSelectItem={onSelectItem}
      />,
    )

    expect(screen.getByText('Audit')).toBeInTheDocument()
    expect(screen.queryByText('Server A')).not.toBeInTheDocument()
    expect(screen.getByText('Switch A')).toBeInTheDocument()
    expect(screen.getByText('Switch has active connections but no uplink or trunk port marked.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Switch has active connections but no uplink or trunk port marked.'))

    expect(onSelectItem).toHaveBeenCalledWith('switch')
  })

  it('filters warnings by item type', () => {
    render(
      <AuditDrawer
        project={project}
        open
        onClose={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switches' }))

    expect(screen.queryByText('Server A')).not.toBeInTheDocument()
    expect(screen.getByText('Switch A')).toBeInTheDocument()
  })
})
