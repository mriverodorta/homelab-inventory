import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/lazy-dnd-workspace', () => ({
  DndWorkspace: ({ active, children }: { active: boolean; children: ReactNode }) => (
    <div data-active={String(active)} data-testid="dnd-workspace">{children}</div>
  ),
}))

import { AppShell } from '@/app/app-shell'

describe('AppShell', () => {
  it('does not mount the Canvas drag provider for non-Canvas workspaces', () => {
    render(<AppShell drag={null}>Systems</AppShell>)

    expect(screen.getByText('Systems')).toBeInTheDocument()
    expect(screen.queryByTestId('dnd-workspace')).not.toBeInTheDocument()
  })

  it('mounts the Canvas drag provider when Canvas interactions are active', () => {
    render(
      <AppShell
        drag={{
          onDragStart: vi.fn(),
          onDragOver: vi.fn(),
          onDragCancel: vi.fn(),
          onDragEnd: vi.fn(),
          overlay: null,
        }}
      >
        Canvas
      </AppShell>,
    )

    expect(screen.getByTestId('dnd-workspace')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('dnd-workspace')).toContainElement(screen.getByText('Canvas'))
  })

  it('keeps the activated drag boundary mounted while interactions are inactive', () => {
    function StatefulSurface({ label }: { label: string }) {
      const [count, setCount] = useState(0)

      return <button onClick={() => setCount((value) => value + 1)}>{label}: {count}</button>
    }

    const drag = {
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragCancel: vi.fn(),
      onDragEnd: vi.fn(),
      overlay: null,
    }
    const { rerender } = render(
      <AppShell drag={drag}>
        <StatefulSurface label="Canvas" />
      </AppShell>,
    )

    screen.getByRole('button', { name: 'Canvas: 0' }).click()
    rerender(
      <AppShell drag={null}>
        <StatefulSurface label="Systems" />
      </AppShell>,
    )

    expect(screen.getByTestId('dnd-workspace')).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: 'Systems: 1' })).toBeInTheDocument()
  })
})
