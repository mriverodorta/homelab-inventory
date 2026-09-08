import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InspectorTabs } from './inspector-tabs'

function tabs() {
  return ['specs', 'agent', 'attention'].map((value) => ({ value, label: value, content: <div>{value} content</div> }))
}

describe('inspector navigation requests', () => {
  it('falls back only if the selected dynamic tab disappears and does not replay it when it returns', async () => {
    const user = userEvent.setup()
    const view = render(<InspectorTabs tabs={tabs()} requestedValue="attention" requestId={1} />)
    view.rerender(<InspectorTabs tabs={tabs().slice(0, 2)} requestedValue="attention" requestId={1} />)
    expect(screen.getByRole('tab', { name: 'specs' })).toHaveAttribute('data-state', 'active')
    await user.click(screen.getByRole('tab', { name: 'agent' }))
    view.rerender(<InspectorTabs tabs={tabs()} requestedValue="attention" requestId={1} />)
    expect(screen.getByRole('tab', { name: 'agent' })).toHaveAttribute('data-state', 'active')
  })

  it('honors a new explicit request to the same tab but consumes it only once', async () => {
    const user = userEvent.setup()
    const view = render(<InspectorTabs tabs={tabs()} requestedValue="attention" requestId={1} />)
    await user.click(screen.getByRole('tab', { name: 'agent' }))
    view.rerender(<InspectorTabs tabs={tabs()} requestedValue="attention" requestId={2} />)
    expect(screen.getByRole('tab', { name: 'attention' })).toHaveAttribute('data-state', 'active')
    await user.click(screen.getByRole('tab', { name: 'agent' }))
    view.rerender(<InspectorTabs tabs={tabs()} requestedValue="attention" requestId={2} />)
    expect(screen.getByRole('tab', { name: 'agent' })).toHaveAttribute('data-state', 'active')
  })

  it('waits until a requested tab becomes available', () => {
    const view = render(<InspectorTabs tabs={tabs().slice(0, 2)} requestedValue="attention" requestId={1} />)
    expect(screen.getByRole('tab', { name: 'specs' })).toHaveAttribute('data-state', 'active')
    view.rerender(<InspectorTabs tabs={tabs()} requestedValue="attention" requestId={1} />)
    expect(screen.getByRole('tab', { name: 'attention' })).toHaveAttribute('data-state', 'active')
  })

  it('does not replay a Specs request when background data rebuilds the tabs', async () => {
    const user = userEvent.setup()
    const view = render(<InspectorTabs tabs={tabs()} requestedValue="specs" />)
    await user.click(screen.getByRole('tab', { name: 'agent' }))
    view.rerender(<InspectorTabs tabs={tabs()} requestedValue="specs" />)
    expect(screen.getByRole('tab', { name: 'agent' })).toHaveAttribute('data-state', 'active')
  })

  it('does not replay Attention after the user chooses a different tab', async () => {
    const user = userEvent.setup()
    const view = render(<InspectorTabs tabs={tabs()} requestedValue="attention" />)
    await user.click(screen.getByRole('tab', { name: 'agent' }))
    view.rerender(<InspectorTabs tabs={tabs()} requestedValue="attention" />)
    expect(screen.getByRole('tab', { name: 'agent' })).toHaveAttribute('data-state', 'active')
  })
})
