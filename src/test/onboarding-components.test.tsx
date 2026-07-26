import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExampleCompletionDialog } from '@/components/onboarding/example-completion-dialog'
import { ExampleWorkspaceGuide } from '@/components/onboarding/example-workspace-guide'
import { FirstRunOnboardingDialog } from '@/components/onboarding/first-run-dialog'
import { GettingStartedChecklist } from '@/components/onboarding/getting-started-checklist'

describe('onboarding components', () => {
  it('offers an explicit example or empty first-run choice', () => {
    const onExplore = vi.fn()
    const onStartEmpty = vi.fn()
    render(<FirstRunOnboardingDialog open busy={false} error={null} onExplore={onExplore} onStartEmpty={onStartEmpty} />)

    fireEvent.click(screen.getByRole('button', { name: 'Explore example' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start empty' }))
    expect(onExplore).toHaveBeenCalledOnce()
    expect(onStartEmpty).toHaveBeenCalledOnce()
  })

  it('provides real-action guide controls with progress', () => {
    const onShowMe = vi.fn()
    const onSkip = vi.fn()
    render(<ExampleWorkspaceGuide step={1} desktopOffset={16} busy={false} onShowMe={onShowMe} onSkip={onSkip} />)

    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show me/i }))
    fireEvent.click(screen.getByRole('button', { name: /skip example walkthrough/i }))
    expect(onShowMe).toHaveBeenCalledOnce()
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it('explains cross-boundary relationships before removing the example', () => {
    render(<ExampleCompletionDialog
      open
      impact={{ inventoryRecords: 9, assignments: 4, connections: 5, placements: 5, additionalRelationships: 1 }}
      loadingImpact={false}
      busy={false}
      error={null}
      onRemove={vi.fn()}
      onKeep={vi.fn()}
    />)

    expect(screen.getByText(/1 relationship created during exploration/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start with my inventory/i })).toBeEnabled()
  })

  it('renders adaptive checklist state and dismisses it', () => {
    const onDismiss = vi.fn()
    render(<GettingStartedChecklist
      milestones={{ created: true, placed: true, related: false, completed: false }}
      desktopOffset={16}
      onDismiss={onDismiss}
    />)

    expect(screen.getByText('2 of 3 complete')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /dismiss getting started/i }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
