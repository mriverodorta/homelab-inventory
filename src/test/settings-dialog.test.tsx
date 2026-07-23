import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialog, type SettingsDialogProps } from '@/components/settings-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { UpdateStatus } from '@/lib/update-api'

const updateStatus: UpdateStatus = {
  enabled: true,
  channel: 'stable',
  runningVersion: '0.1.28',
  runningRevision: 'running-sha',
  availableVersion: '0.1.29',
  availableRevision: 'available-sha',
  updateAvailable: true,
  skipped: true,
  checkedAt: '2026-07-19T12:00:00.000Z',
  state: 'available',
  errorCode: null,
  entries: [],
}

function createProps(overrides: Partial<SettingsDialogProps> = {}): SettingsDialogProps {
  return {
    open: true,
    projectName: 'My Homelab',
    saveStatus: 'saved',
    inventoryVisible: true,
    inventoryWidth: 420,
    autoCenterOnSelect: true,
    networkCablesVisible: true,
    powerCablesVisible: true,
    displayCablesVisible: true,
    openCreatedConnectionInspector: false,
    snapCablesToGrid: false,
    avoidCableCollisionsGlobally: false,
    snapItemsToGrid: false,
    updateStatus,
    updateLoading: false,
    updateChecking: false,
    updateClearingSkip: false,
    onOpenChange: vi.fn(),
    onProjectNameChange: vi.fn(),
    onInventoryVisibleChange: vi.fn(),
    onInventoryWidthChange: vi.fn(),
    onAutoCenterOnSelectChange: vi.fn(),
    onNetworkCablesVisibleChange: vi.fn(),
    onPowerCablesVisibleChange: vi.fn(),
    onDisplayCablesVisibleChange: vi.fn(),
    onOpenCreatedConnectionInspectorChange: vi.fn(),
    onSnapCablesToGridChange: vi.fn(),
    onAvoidCableCollisionsGloballyChange: vi.fn(),
    onSnapItemsToGridChange: vi.fn(),
    onResetBrowserPreferences: vi.fn(),
    onClearIgnoredWarnings: vi.fn(),
    onEnableCompatibilityForAllHosts: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onClearSkippedUpdate: vi.fn(),
    ...overrides,
  }
}

function renderSettings(overrides: Partial<SettingsDialogProps> = {}) {
  const props = createProps(overrides)
  render(<TooltipProvider><SettingsDialog {...props} /></TooltipProvider>)
  return props
}

describe('SettingsDialog', () => {
  it('renders the responsive shell and general browser preferences', () => {
    const props = renderSettings()

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('My Homelab')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Settings categories' })).toHaveClass('hidden', 'lg:block')
    expect(screen.getByRole('combobox', { name: 'Settings category' }).closest('.lg\\:hidden')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Show inventory at startup' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Center selected equipment' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show network cables' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show power cables' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show display cables' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Open new connections in Inspector' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Snap cables to grid' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Avoid cable collisions globally' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Snap canvas items to grid' }))
    expect(props.onInventoryVisibleChange).toHaveBeenCalledWith(false)
    expect(props.onAutoCenterOnSelectChange).toHaveBeenCalledWith(false)
    expect(props.onNetworkCablesVisibleChange).toHaveBeenCalledWith(false)
    expect(props.onPowerCablesVisibleChange).toHaveBeenCalledWith(false)
    expect(props.onDisplayCablesVisibleChange).toHaveBeenCalledWith(false)
    expect(props.onOpenCreatedConnectionInspectorChange).toHaveBeenCalledWith(true)
    expect(props.onSnapCablesToGridChange).toHaveBeenCalledWith(true)
    expect(props.onAvoidCableCollisionsGloballyChange).toHaveBeenCalledWith(true)
    expect(props.onSnapItemsToGridChange).toHaveBeenCalledWith(true)

    const slider = screen.getByRole('slider', { name: 'Inventory width' })
    expect(slider).toHaveAttribute('aria-valuemin', '390')
    expect(slider).toHaveAttribute('aria-valuemax', '460')
    expect(screen.getByText('420 px')).toBeInTheDocument()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(props.onInventoryWidthChange).toHaveBeenCalled()
  })

  it('edits project metadata and confirms policy actions', () => {
    const props = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /Project.*Shared project configuration/ }))

    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Rack Lab' } })
    expect(props.onProjectNameChange).toHaveBeenCalledWith('Rack Lab')

    fireEvent.click(screen.getByRole('button', { name: 'Clear ignored findings' }))
    expect(props.onClearIgnoredWarnings).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear ignored findings' }).at(-1)!)
    expect(props.onClearIgnoredWarnings).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Enable for all hosts' }))
    expect(props.onEnableCompatibilityForAllHosts).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable for all hosts' }).at(-1)!)
    expect(props.onEnableCompatibilityForAllHosts).toHaveBeenCalledOnce()
  })

  it('shows update status and update actions', () => {
    const props = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /Updates.*Image channel and status/ }))

    expect(screen.getByText('0.1.28')).toBeInTheDocument()
    expect(screen.getByText('0.1.29')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear skipped version' }))
    expect(props.onCheckForUpdates).toHaveBeenCalledOnce()
    expect(props.onClearSkippedUpdate).toHaveBeenCalledOnce()
  })

  it('shows four focused categories without storage-scope pills', () => {
    renderSettings()
    const navigation = screen.getByRole('navigation', { name: 'Settings categories' })
    expect(navigation).toHaveTextContent('General')
    expect(navigation).toHaveTextContent('Project')
    expect(navigation).toHaveTextContent('Updates')
    expect(navigation).toHaveTextContent('About')
    expect(navigation).not.toHaveTextContent('System')
    expect(screen.queryByText('This browser')).not.toBeInTheDocument()
    expect(screen.queryByText('Environment')).not.toBeInTheDocument()
  })

  it('explains the product purpose and links to public project resources', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /About.*Purpose, version, and links/ }))
    expect(screen.getByText(/Keep servers, NAS devices, switches, patch panels/)).toBeInTheDocument()
    expect(screen.getByText(/Assign components to hosts and review hardware compatibility/)).toBeInTheDocument()
    expect(screen.getByText(/Document ports, cable paths, negotiated network speeds/)).toBeInTheDocument()
    expect(screen.getByText(/Project data stays in the configured data directory/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GitHub repository' })).toHaveAttribute('href', 'https://github.com/mriverodorta/homelab-inventory')
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', 'https://github.com/mriverodorta/homelab-inventory#readme')
  })
})
