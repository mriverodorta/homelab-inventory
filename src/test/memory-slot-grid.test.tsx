import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemorySlotGrid } from '@/components/memory-slot-grid'
import type { ComponentAssignment } from '@/types/inventory'

const assignment = (id: number, position: number): ComponentAssignment => ({
  id, serverId: 'server:1', itemId: `ram:${String(id)}`, type: 'ram', assignedAt: '2026-01-01T00:00:00.000Z',
  allocation: { resourceType: 'memory', positions: [position] },
})

describe('MemorySlotGrid', () => {
  it('renders fixed two-column physical slots and positions sticks', () => {
    const { container } = render(<MemorySlotGrid hostId="server:1" slotCount={4} assignments={[assignment(2, 1), assignment(1, 0)]} renderAssignment={(value) => <span>RAM {value.id}</span>} />)
    expect(container.querySelector('[data-memory-slot-count="4"]')).toHaveClass('grid-cols-2')
    expect(screen.getByText('RAM 1')).toBeInTheDocument()
    expect(screen.getByText('RAM 2')).toBeInTheDocument()
    expect(screen.getByText('Slot 3')).toBeInTheDocument()
    expect(screen.getByText('Slot 4')).toBeInTheDocument()
  })

  it('uses the full row for a host with one physical memory slot', () => {
    const { container } = render(<MemorySlotGrid hostId="server:1" slotCount={1} assignments={[assignment(1, 0)]} renderAssignment={() => <span>Installed RAM</span>} />)

    expect(container.querySelector('[data-memory-slot-count="1"]')).toHaveClass('grid-cols-1')
    expect(screen.getByText('Installed RAM')).toBeInTheDocument()
  })

  it('does not invent slots when host metadata is unknown', () => {
    render(<MemorySlotGrid hostId="server:1" slotCount={null} assignments={[assignment(1, 0)]} renderAssignment={() => <span>Installed RAM</span>} />)
    expect(screen.getByText('RAM slots unknown')).toBeInTheDocument()
    expect(screen.getByText('Installed RAM')).toBeInTheDocument()
  })
})
