import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InventoryLifecycleDialog } from '@/components/inventory-lifecycle-dialog'

describe('InventoryLifecycleDialog', () => {
  it('confirms archiving without destructive styling or typed input', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <InventoryLifecycleDialog
        open
        action="archive"
        itemNames={['Lab server']}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Archive this item?' })).toBeInTheDocument()
    expect(screen.getByText('Lab server')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Archive item' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('uses permanent destructive language for deletion', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <InventoryLifecycleDialog
        open
        action="delete"
        itemNames={['Archived switch']}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Delete this item permanently?' })).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete item' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('summarizes a batch and lists its item names', () => {
    render(
      <InventoryLifecycleDialog
        open
        action="archive"
        itemNames={['Server one', 'Server two', 'Server three']}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Archive 3 items?' })).toBeInTheDocument()
    expect(screen.getByText('3 selected items')).toBeInTheDocument()
    expect(screen.getByText('Server one')).toBeInTheDocument()
    expect(screen.getByText('Server two')).toBeInTheDocument()
    expect(screen.getByText('Server three')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive 3 items' })).toBeInTheDocument()
  })

  it('renders all dependency blockers and removes the destructive confirmation', () => {
    render(
      <InventoryLifecycleDialog
        open
        action="delete"
        itemNames={['Connected switch']}
        dependencyReport={{
          blocked: true,
          reasons: [
            { kind: 'placement', count: 1, message: 'Remove this item from the canvas.' },
            { kind: 'connection', count: 2, message: 'Disconnect 2 cables first.' },
          ],
        }}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'This item cannot be deleted' })).toBeInTheDocument()
    expect(screen.getByText('Remove this item from the canvas.')).toBeInTheDocument()
    expect(screen.getByText('Disconnect 2 cables first.')).toBeInTheDocument()
    expect(screen.getByText('1 dependency')).toBeInTheDocument()
    expect(screen.getByText('2 dependencies')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete item' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('cancels without confirming and reports mutation errors', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()

    render(
      <InventoryLifecycleDialog
        open
        action="delete"
        itemNames={['Unused CPU']}
        error="The inventory changed. Check dependencies again."
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('The inventory changed. Check dependencies again.')
    expect(screen.getByRole('button', { name: 'Delete item' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps confirmation disabled while loading', () => {
    render(
      <InventoryLifecycleDialog
        open
        action="archive"
        itemNames={['Lab server']}
        loading
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Archiving item' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
