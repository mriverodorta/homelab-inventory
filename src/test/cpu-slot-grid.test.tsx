import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CpuSlotGrid } from '@/components/cpu-slot-grid'
import type { ComponentAssignment } from '@/types/inventory'

const assignment: ComponentAssignment = {
  id: 1,
  serverId: 'server:1',
  itemId: 'cpu:1',
  type: 'cpu',
  assignedAt: '2026-08-04T00:00:00.000Z',
}

describe('CpuSlotGrid', () => {
  it('uses the full row for a single socket', () => {
    render(<CpuSlotGrid assignments={[assignment]} socketCount={1} renderAssignment={() => <span>CPU</span>} />)
    expect(screen.getByText('CPU').parentElement?.parentElement).toHaveClass('grid-cols-1')
  })

  it('uses two columns and compact assignment content for multiple sockets', () => {
    const renderAssignment = vi.fn(() => <span>CPU</span>)
    render(<CpuSlotGrid assignments={[assignment]} socketCount={2} renderAssignment={renderAssignment} />)
    expect(screen.getByText('CPU').parentElement?.parentElement).toHaveClass('grid-cols-2')
    expect(renderAssignment).toHaveBeenCalledWith(assignment, 0, true)
  })
})
