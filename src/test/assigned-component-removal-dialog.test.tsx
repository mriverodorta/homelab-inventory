import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AssignedComponentRemovalDialog } from '@/components/assigned-component-removal-dialog'

describe('AssignedComponentRemovalDialog', () => {
  it('describes the cable cleanup and confirms once', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <AssignedComponentRemovalDialog
        open
        itemName="Synology 65W"
        connectionCount={2}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Remove Synology 65W?' })).toBeInTheDocument()
    expect(screen.getAllByText(/2 connected cables/i)).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Remove component and cables' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels without removing anything', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()

    render(
      <AssignedComponentRemovalDialog
        open
        itemName="Synology 65W"
        connectionCount={1}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
