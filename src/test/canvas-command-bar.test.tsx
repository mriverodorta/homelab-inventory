import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasCommandBar, type CanvasCommandBarProps } from '@/components/canvas-command-bar'
import { TooltipProvider } from '@/components/ui/tooltip'

function createProps(overrides: Partial<CanvasCommandBarProps> = {}): CanvasCommandBarProps {
  return {
    desktopInventoryVisible: true,
    saveStatus: 'saved',
    canUndo: true,
    canRedo: false,
    updateAvailable: false,
    updateStatusLoading: false,
    auditWarningCount: 3,
    autoCenterOnSelect: true,
    networkCablesVisible: true,
    powerCablesVisible: true,
    displayCablesVisible: true,
    onInventory: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onOpenUpdate: vi.fn(),
    onOpenAudit: vi.fn(),
    onToggleAutoCenterOnSelect: vi.fn(),
    onAutoArrange: vi.fn(),
    onToggleNetworkCablesVisible: vi.fn(),
    onTogglePowerCablesVisible: vi.fn(),
    onToggleDisplayCablesVisible: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
}

function renderToolbar(overrides: Partial<CanvasCommandBarProps> = {}) {
  const props = createProps(overrides)

  render(
    <TooltipProvider>
      <CanvasCommandBar {...props} />
    </TooltipProvider>,
  )

  return props
}

afterEach(() => {
  cleanup()
})

describe('CanvasCommandBar', () => {
  it('exposes every canvas command by accessible name', () => {
    renderToolbar()

    expect(screen.getByRole('toolbar', { name: 'Canvas tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide inventory' })).toBeInTheDocument()
    expect(screen.getByLabelText('Saved')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open update status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open audit, 3 warnings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disable selection centering' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Auto arrange canvas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide network cables' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Hide power cables' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Hide display cables' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Hide network cables' }).querySelector('.lucide-ethernet-port')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide power cables' }).querySelector('.lucide-cable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide display cables' }).querySelector('.lucide-hdmi-port')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('invokes every enabled command callback', () => {
    const props = renderToolbar({ canRedo: true })

    fireEvent.click(screen.getByRole('button', { name: 'Hide inventory' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open update status' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open audit, 3 warnings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disable selection centering' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto arrange canvas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide network cables' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide power cables' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide display cables' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(props.onInventory).toHaveBeenCalledOnce()
    expect(props.onUndo).toHaveBeenCalledOnce()
    expect(props.onRedo).toHaveBeenCalledOnce()
    expect(props.onOpenUpdate).toHaveBeenCalledOnce()
    expect(props.onOpenAudit).toHaveBeenCalledOnce()
    expect(props.onToggleAutoCenterOnSelect).toHaveBeenCalledOnce()
    expect(props.onAutoArrange).toHaveBeenCalledOnce()
    expect(props.onToggleNetworkCablesVisible).toHaveBeenCalledOnce()
    expect(props.onTogglePowerCablesVisible).toHaveBeenCalledOnce()
    expect(props.onToggleDisplayCablesVisible).toHaveBeenCalledOnce()
    expect(props.onOpenSettings).toHaveBeenCalledOnce()
  })

  it('renders save progress and failure states', () => {
    const { rerender } = render(
      <TooltipProvider>
        <CanvasCommandBar {...createProps({ saveStatus: 'saving' })} />
      </TooltipProvider>,
    )

    expect(screen.getByLabelText('Saving')).toHaveAttribute('role', 'status')

    rerender(
      <TooltipProvider>
        <CanvasCommandBar {...createProps({ saveStatus: 'error' })} />
      </TooltipProvider>,
    )

    expect(screen.getByLabelText('Save failed')).toHaveAttribute('role', 'status')
  })

  it('shows checking and available update states', () => {
    const { rerender } = render(
      <TooltipProvider>
        <CanvasCommandBar {...createProps({ updateStatusLoading: true })} />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Checking update status' })).toBeDisabled()

    rerender(
      <TooltipProvider>
        <CanvasCommandBar {...createProps({ updateAvailable: true })} />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Update available' })).toBeEnabled()
    expect(screen.getByText('Update available')).toHaveClass('sr-only')
  })

  it('supports empty audit, hidden inventory, and inactive toggle states', () => {
    renderToolbar({
      desktopInventoryVisible: false,
      auditWarningCount: 0,
      autoCenterOnSelect: false,
      networkCablesVisible: false,
      powerCablesVisible: false,
      displayCablesVisible: false,
    })

    expect(screen.getByRole('button', { name: 'Show inventory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open audit, no warnings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable selection centering' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Show network cables' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Show power cables' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Show display cables' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('accepts layout classes and keeps the command row horizontally scrollable', () => {
    renderToolbar({ className: 'inspector-offset' })

    const toolbar = screen.getByRole('toolbar', { name: 'Canvas tools' })
    expect(toolbar).toHaveClass('inspector-offset')
    expect(toolbar).toHaveClass('bottom-[max(1rem,env(safe-area-inset-bottom))]')
    expect(toolbar).toHaveClass('pl-14', 'pr-3', 'sm:px-3')
    expect(toolbar).not.toHaveClass('bottom-[max(4.75rem,env(safe-area-inset-bottom))]')
    expect(toolbar.firstElementChild).toHaveClass('overflow-x-auto')
  })
})
