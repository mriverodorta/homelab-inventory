import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProjectSwitcher } from '@/components/workbook/project-switcher'

describe('ProjectSwitcher', () => {
  it('shows the active project and opens project editing', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ProjectSwitcher
            projects={[{ id: 1, name: 'Default Project', description: null, iconKey: 'house', revision: 1, includesGlobalInventory: true }]}
            activeProjectId={1}
            onSelect={vi.fn()}
            onCreate={vi.fn()}
            onUpdate={vi.fn()}
            onArchive={vi.fn()}
            onRestored={vi.fn()}
            onDeleted={vi.fn()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: 'Project: Default Project' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Edit current project' }))
    expect(screen.getByRole('dialog', { name: 'Edit project' })).toBeVisible()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })
})
