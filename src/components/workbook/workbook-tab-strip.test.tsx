import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkbookTabStrip } from '@/components/workbook/workbook-tab-strip'
import type { WorkspaceSummary } from '@/lib/workbook-api'

const workspaces: WorkspaceSummary[] = [
  { id: 1, projectId: 1, type: 'systems', name: 'Systems', iconKey: 'rows-3', colorKey: 'gray', sortOrder: 0, revision: 1, systemKey: 'systems' },
  { id: 2, projectId: 1, type: 'canvas', name: 'Primary Network', iconKey: 'network', colorKey: 'blue', sortOrder: 1, revision: 1, systemKey: null },
]

describe('WorkbookTabStrip', () => {
  it('keeps Systems first and marks the selected Canvas', () => {
    const onSelect = vi.fn()
    render(
      <TooltipProvider>
        <WorkbookTabStrip
          workspaces={workspaces}
          activeWorkspaceId={2}
          onSelect={onSelect}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onArchive={vi.fn()}
          onReorder={vi.fn()}
        />
      </TooltipProvider>,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('Systems')
    fireEvent.click(tabs[0])
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(screen.getByRole('tab', { name: 'Primary Network' })).toHaveAttribute('aria-selected', 'true')
    const selectedTab = screen.getByRole('tab', { name: 'Primary Network' })
    expect(selectedTab.parentElement).toHaveStyle({ backgroundColor: '#eaf3fa' })
    expect(selectedTab).toHaveClass('bg-transparent')
    expect(screen.getByRole('button', { name: 'Primary Network actions' })).toHaveClass('size-6', 'bg-transparent')
    expect(screen.getByRole('button', { name: 'New Canvas workspace' })).toBeVisible()
  })
})
