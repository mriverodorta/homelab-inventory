import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReturnToInventoryDialog } from '@/components/return-to-inventory-dialog'

const impact = {
  placementsRemoved: 1,
  assignmentsReleased: 2,
  connectionsRemoved: 3,
}

describe('ReturnToInventoryDialog', () => {
  it('previews the item, preservation behavior, and complete impact', () => {
    render(
      <ReturnToInventoryDialog
        open
        itemName="Lab server"
        itemType="server"
        impact={impact}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Return Lab server to inventory?' })).toBeInTheDocument()
    expect(screen.getByText(/remains in inventory/i)).toBeInTheDocument()
    expect(screen.getByText(/hosted components are released back to inventory/i)).toBeInTheDocument()
    expect(screen.getByText('Canvas placements removed').nextSibling).toHaveTextContent('1')
    expect(screen.getByText('Hosted components released').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Cable connections removed').nextSibling).toHaveTextContent('3')
  })

  it('cancels without confirming', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()

    render(
      <ReturnToInventoryDialog
        open
        itemName="Lab server"
        itemType="server"
        impact={impact}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms without closing before the caller finishes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()

    render(
      <ReturnToInventoryDialog
        open
        itemName="Lab server"
        itemType="server"
        impact={impact}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Return to inventory' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('blocks confirmation and dismissal while busy', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()

    render(
      <ReturnToInventoryDialog
        open
        busy
        itemName="Lab server"
        itemType="server"
        impact={impact}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Returning to inventory' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
