import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialog, type SettingsDialogProps } from '@/components/settings-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { UpdateStatus } from '@/lib/update-api'
import type { OnboardingStatus } from '@/lib/onboarding-api'
import { DEFAULT_REGISTRY_STATE } from '@/types/registry'

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

const onboardingStatus: OnboardingStatus = {
  enabled: true,
  version: 1,
  status: 'dismissed',
  sampleBatchId: null,
  sampleInventoryRefs: [],
  sampleAssignmentIds: [],
  sampleConnectionIds: [],
  walkthroughStep: 0,
  startedAt: null,
  completedAt: null,
  eligibleForExample: false,
  shouldInvite: false,
  milestones: { created: true, placed: true, related: true, completed: true },
  projectRevision: 1,
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
    onboardingStatus,
    onboardingBusy: false,
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
    onExploreExample: vi.fn(),
    onReviewExample: vi.fn(),
    onRestartOnboarding: vi.fn(),
    onDismissOnboarding: vi.fn(),
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

  it('offers project-scoped getting started controls', () => {
    const props = renderSettings({
      onboardingStatus: { ...onboardingStatus, status: 'available', eligibleForExample: true },
    })
    fireEvent.click(screen.getByRole('button', { name: /Project.*Shared project configuration/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Explore example' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart checklist' }))
    expect(props.onExploreExample).toHaveBeenCalledOnce()
    expect(props.onRestartOnboarding).toHaveBeenCalledOnce()
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

  it('shows six focused categories without storage-scope pills', () => {
    renderSettings()
    const navigation = screen.getByRole('navigation', { name: 'Settings categories' })
    expect(navigation).toHaveTextContent('General')
    expect(navigation).toHaveTextContent('Project')
    expect(navigation).toHaveTextContent('Registry')
    expect(navigation).toHaveTextContent('Updates')
    expect(navigation).toHaveTextContent('Feedback')
    expect(navigation).toHaveTextContent('About')
    expect(navigation).not.toHaveTextContent('System')
    expect(screen.queryByText('This browser')).not.toBeInTheDocument()
    expect(screen.queryByText('Environment')).not.toBeInTheDocument()
  })

  it('configures registry mode and default Add Hardware source', () => {
    const props = renderSettings({
      registry: {
        settings: {
          mode: 'disabled',
          defaultInventorySource: 'catalog',
          automaticContributions: false,
          updatedAt: null,
        },
        sources: [],
        links: [],
        privateTemplates: [],
        snapshot: null,
        contributions: {
          enabled: false,
          queued: 0,
          retrying: 0,
          delivered: 0,
          accepted: 0,
          rejected: 0,
          suppressed: 0,
          enrollment: 'not-enrolled',
          tokenExpiresAt: null,
          lastError: null,
        },
        database: { schemaVersion: 16, lastMigration: null },
      },
      onRegistrySettingsChange: vi.fn(),
    })
    fireEvent.click(screen.getByRole('button', { name: /Registry.*Catalog and private templates/ }))

    expect(screen.getByRole('combobox', { name: 'Registry mode' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Default Add Hardware tab' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Automatic catalog contributions' })).toBeDisabled()
    fireEvent.click(screen.getByRole('combobox', { name: 'Registry mode' }))
    fireEvent.click(screen.getByRole('option', { name: 'Offline file' }))
    expect(props.onRegistrySettingsChange).toHaveBeenCalledWith({ mode: 'offline' }, null)
  })

  it('requires connected mode for contribution consent and reports delivery status', () => {
    const onRegistrySettingsChange = vi.fn()
    renderSettings({
      registry: {
        ...DEFAULT_REGISTRY_STATE,
        settings: { ...DEFAULT_REGISTRY_STATE.settings, mode: 'connected' },
        contributions: { ...DEFAULT_REGISTRY_STATE.contributions, enrollment: 'active', queued: 2, delivered: 4 },
      },
      onRegistrySettingsChange,
    })
    fireEvent.click(screen.getByRole('button', { name: /Registry.*Catalog and private templates/ }))
    const contributionSwitch = screen.getByRole('switch', { name: 'Automatic catalog contributions' })
    expect(contributionSwitch).toBeEnabled()
    fireEvent.click(contributionSwitch)
    expect(onRegistrySettingsChange).toHaveBeenCalledWith({ automaticContributions: true }, null)
    expect(screen.getByText(/2 queued, 0 retrying, 4 delivered/)).toBeInTheDocument()
  })

  it('shows enrollment failures beside the automatic contribution switch', async () => {
    const onRegistrySettingsChange = vi.fn().mockRejectedValue(
      new Error('Installation activation signature is invalid.'),
    )
    renderSettings({
      registry: {
        ...DEFAULT_REGISTRY_STATE,
        settings: { ...DEFAULT_REGISTRY_STATE.settings, mode: 'connected' },
      },
      onRegistrySettingsChange,
    })
    fireEvent.click(screen.getByRole('button', { name: /Registry.*Catalog and private templates/ }))
    const contributionSwitch = screen.getByRole('switch', { name: 'Automatic catalog contributions' })

    fireEvent.click(contributionSwitch)

    expect(await screen.findByRole('alert')).toHaveTextContent('Installation activation signature is invalid.')
    expect(contributionSwitch).not.toBeChecked()
  })

  it('renders the public demo registry policy as read-only while keeping refresh available', () => {
    renderSettings({
      registry: {
        ...DEFAULT_REGISTRY_STATE,
        policy: {
          modeLocked: true,
          forcedMode: 'connected',
          contributionsAllowed: false,
        },
        settings: {
          ...DEFAULT_REGISTRY_STATE.settings,
          mode: 'connected',
          automaticContributions: false,
        },
      },
      onRefreshOfficialCatalog: vi.fn(),
      onDeliverRegistryContributions: vi.fn(),
      onRevokeRegistryContributions: vi.fn(),
      onRotateRegistryContributionKey: vi.fn(),
    })
    fireEvent.click(screen.getByRole('button', { name: /Registry.*Catalog and private templates/ }))

    expect(screen.getByRole('combobox', { name: 'Registry mode' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Registry mode' })).toHaveTextContent('Connected')
    expect(screen.getByRole('switch', { name: 'Automatic catalog contributions' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Automatic catalog contributions' })).not.toBeChecked()
    expect(screen.queryByText('Contribution delivery')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send now' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeEnabled()
    expect(screen.getAllByText(/public demo policy/i).length).toBeGreaterThan(0)
  })

  it('shows the latest automatic catalog refresh failure without hiding the active snapshot', () => {
    renderSettings({
      registry: {
        ...DEFAULT_REGISTRY_STATE,
        settings: { ...DEFAULT_REGISTRY_STATE.settings, mode: 'connected' },
        sources: [{
          id: 1,
          kind: 'official-connected',
          displayName: 'Official Homelab Inventory Catalog',
          activeRevision: 3,
          lastCheckedAt: '2026-07-29T12:00:00.000Z',
          lastSuccessAt: '2026-07-29T06:00:00.000Z',
          lastErrorAt: '2026-07-29T12:00:00.000Z',
          lastError: 'Catalog manifest request failed with HTTP 503.',
        }],
        snapshot: {
          sourceId: 1,
          revision: 3,
          generatedAt: '2026-07-29T05:55:00.000Z',
          expiresAt: null,
          activatedAt: '2026-07-29T06:00:00.000Z',
          digest: 'a'.repeat(64),
          templateCount: 1,
          keyId: 'registry-2026-01',
        },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /Registry.*Catalog and private templates/ }))

    expect(screen.getByText('Revision 3')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Latest catalog refresh failed')
    expect(screen.getByRole('alert')).toHaveTextContent('Catalog manifest request failed with HTTP 503.')
  })

  it('links to roadmap feedback without including project data', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /Feedback.*Roadmap, ideas, and issues/ }))
    expect(screen.getByRole('link', { name: /Propose feature/ })).toHaveAttribute('href', 'https://homelabinventory.com/roadmap/propose?source=self-hosted-app&version=0.1.28')
    expect(screen.getByRole('link', { name: /Report bug/ })).toHaveAttribute('href', 'https://github.com/mriverodorta/homelab-inventory/issues/new/choose')
    expect(screen.getByRole('link', { name: /View roadmap/ })).toHaveAttribute('href', 'https://homelabinventory.com/roadmap')
    expect(screen.getByText(/Project data is never attached/)).toBeInTheDocument()
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
