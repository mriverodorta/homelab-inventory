import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InventoryItemDialog } from '@/components/inventory-item-dialog'

afterEach(() => {
  cleanup()
})

describe('InventoryItemDialog switch port groups', () => {
  it('defaults network receptacles, preserves valid speeds, and removes No speed', async () => {
    const user = userEvent.setup()

    render(
      <InventoryItemDialog
        open
        onOpenChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Inventory type' }))
    await user.click(screen.getByRole('option', { name: 'Switch' }))

    expect(screen.getByRole('combobox', { name: 'Port group 1 speed' })).toHaveTextContent('1G')

    await user.click(screen.getByRole('combobox', { name: 'Port group 1 speed' }))
    expect(screen.queryByRole('option', { name: 'No speed' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('combobox', { name: 'Port group 1 type' }))
    await user.click(screen.getByRole('option', { name: 'DisplayPort' }))
    await user.click(screen.getByRole('combobox', { name: 'Port group 1 speed' }))
    await user.click(screen.getByRole('option', { name: 'No speed' }))
    await user.click(screen.getByRole('combobox', { name: 'Port group 1 type' }))
    await user.click(screen.getByRole('option', { name: 'SFP+' }))

    expect(screen.getByRole('combobox', { name: 'Port group 1 speed' })).toHaveTextContent('10G')

    await user.click(screen.getByRole('combobox', { name: 'Port group 1 speed' }))
    await user.click(screen.getByRole('option', { name: '5G' }))
    await user.click(screen.getByRole('combobox', { name: 'Port group 1 type' }))
    await user.click(screen.getByRole('option', { name: 'RJ45' }))

    expect(screen.getByRole('combobox', { name: 'Port group 1 speed' })).toHaveTextContent('5G')
  })
})
