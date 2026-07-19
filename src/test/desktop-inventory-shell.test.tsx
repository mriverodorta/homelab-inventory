import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopInventoryShell } from '@/components/desktop-inventory-shell'

afterEach(() => {
  cleanup()
})

describe('DesktopInventoryShell', () => {
  it('keeps inventory content mounted while its width collapses', () => {
    const { rerender } = render(
      <DesktopInventoryShell expanded width={420} onResizePointerDown={vi.fn()}>
        <div>Inventory content</div>
      </DesktopInventoryShell>,
    )

    const shell = screen.getByTestId('desktop-inventory-shell')
    expect(shell).toHaveAttribute('data-inventory-state', 'expanded')
    expect(shell).toHaveStyle({ width: '420px' })
    expect(screen.getByText('Inventory content')).toBeInTheDocument()

    rerender(
      <DesktopInventoryShell expanded={false} width={420} onResizePointerDown={vi.fn()}>
        <div>Inventory content</div>
      </DesktopInventoryShell>,
    )

    expect(shell).toHaveAttribute('data-inventory-state', 'collapsed')
    expect(shell).toHaveStyle({ width: '0px' })
    expect(screen.getByText('Inventory content')).toBeInTheDocument()
    expect(screen.getByTestId('desktop-inventory-content')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Resize inventory sidebar' })).toBeDisabled()
  })

  it('forwards resize pointer input only while expanded', () => {
    const onResizePointerDown = vi.fn()
    const { rerender } = render(
      <DesktopInventoryShell expanded width={390} onResizePointerDown={onResizePointerDown}>
        <div>Inventory content</div>
      </DesktopInventoryShell>,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize inventory sidebar' }))
    expect(onResizePointerDown).toHaveBeenCalledOnce()

    rerender(
      <DesktopInventoryShell expanded={false} width={390} onResizePointerDown={onResizePointerDown}>
        <div>Inventory content</div>
      </DesktopInventoryShell>,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize inventory sidebar' }))
    expect(onResizePointerDown).toHaveBeenCalledOnce()
  })
})
