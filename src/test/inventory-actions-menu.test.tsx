import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InventoryActionsMenu } from '@/components/inventory-actions-menu'
import { inventoryTypeLabel } from '@/lib/inventory-lifecycle'

describe('InventoryActionsMenu', () => {
  it('provides lifecycle labels for every new inventory family', () => {
    expect(inventoryTypeLabel('pcBuild')).toBe('PC build')
    expect(inventoryTypeLabel('motherboard')).toBe('motherboard')
    expect(inventoryTypeLabel('powerSupply')).toBe('power supply')
    expect(inventoryTypeLabel('powerStrip')).toBe('power strip')
  })

  it('exposes the complete active-item action set', async () => {
    const user = userEvent.setup()
    const callbacks = {
      onEdit: vi.fn(),
      onDuplicate: vi.fn(),
      onArchive: vi.fn(),
    }

    render(<InventoryActionsMenu itemName="Lab server" {...callbacks} />)

    await user.click(screen.getByRole('button', { name: 'Actions for Lab server' }))

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))

    expect(callbacks.onDuplicate).toHaveBeenCalledTimes(1)
  })

  it('only exposes the return action when a handler is supplied', async () => {
    const user = userEvent.setup()
    const onReturnToInventory = vi.fn()
    const lifecycleCallbacks = {
      onEdit: vi.fn(),
      onDuplicate: vi.fn(),
      onArchive: vi.fn(),
    }

    const { rerender } = render(
      <InventoryActionsMenu itemName="Placed server" {...lifecycleCallbacks} />,
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Placed server' }))
    expect(screen.queryByRole('menuitem', { name: 'Return to inventory' })).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    rerender(
      <InventoryActionsMenu
        itemName="Placed server"
        {...lifecycleCallbacks}
        onReturnToInventory={onReturnToInventory}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Placed server' }))
    await user.click(screen.getByRole('menuitem', { name: 'Return to inventory' }))

    expect(onReturnToInventory).toHaveBeenCalledTimes(1)
  })

  it('exposes only restore and delete for an archived item', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    const onDelete = vi.fn()

    render(
      <InventoryActionsMenu
        archived
        itemName="Archived switch"
        onRestore={onRestore}
        onDelete={onDelete}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Archived switch' }))

    expect(screen.getByRole('menuitem', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Restore' }))

    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('does not leak menu interactions to a selectable or draggable parent', async () => {
    const user = userEvent.setup()
    const onParentClick = vi.fn()
    const onParentPointerDown = vi.fn()

    render(
      <div onClick={onParentClick} onPointerDown={onParentPointerDown}>
        <InventoryActionsMenu
          itemName="Lab CPU"
          onEdit={vi.fn()}
          onDuplicate={vi.fn()}
          onArchive={vi.fn()}
        />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Lab CPU' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

    expect(onParentClick).not.toHaveBeenCalled()
    expect(onParentPointerDown).not.toHaveBeenCalled()
  })

  it('disables the action trigger while a lifecycle mutation is busy', () => {
    render(
      <InventoryActionsMenu
        busy
        itemName="Busy server"
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onArchive={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Actions for Busy server' })).toBeDisabled()
  })
})
