import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SharingSettings } from '@/components/settings/sharing/sharing-settings'
import { AccountClaimDialog } from '@/components/settings/sharing/account-claim-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { usePermission } from '@/hooks/use-permission'
import { useSharing } from '@/hooks/use-sharing'
import type { SharingEnrollmentState } from '@/lib/sharing-api'

vi.mock('@/hooks/use-permission', () => ({ usePermission: vi.fn() }))
vi.mock('@/hooks/use-sharing', () => ({ useSharing: vi.fn() }))

const mutation = { isPending: false, error: null, mutate: vi.fn(), mutateAsync: vi.fn() }

function sharing(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      isLoading: false,
      data: {
        available: true,
        automaticEnrollment: true,
        demo: false,
        staging: false,
        origin: 'https://lab.gd',
        capabilities: {
          version: 1,
          publication: true,
          accountClaiming: false,
          installationAccountStatus: false,
          installationEvents: false,
          ownerAnalytics: false,
          protectedShares: false,
          remoteLifecycle: false,
          views: ['systems', 'canvas'],
          visibility: ['public', 'unlisted'],
          mutability: ['immutable', 'replaceable'],
          synchronization: ['manual', 'synchronized'],
          embeds: true,
          resourceSnapshots: true,
          comments: 'coming-soon',
          reactions: 'coming-soon',
        },
        settings: {
          revision: 1,
          connectionEnabled: true,
          enrollmentState: 'connected' as SharingEnrollmentState,
          attemptCount: 0,
          nextAttemptAtMs: null as number | null,
          lastErrorCode: null,
          recoveryState: null,
          connection: {
            live: true,
            dormant: false,
            interest: { required: true, activeShares: 1, pendingPublicationOperations: 0, pendingAccountOperations: 0, recoveryPending: false, pendingClaim: false, pendingClaimExpiresAtMs: null, reasons: ['active-shares'] },
            metrics: { streamOpenCount: 3, reconnectCount: 1, credentialRefreshCount: 2, dormantTransitionCount: 1, lastFrameAtMs: 1 },
            recentlyAuthenticated: true,
            credentialValid: true,
            effectiveEnrollmentState: 'connected' as SharingEnrollmentState,
            lastConnectedAtMs: 1,
            lastDisconnectedAtMs: null,
            lastRenewedAtMs: 1,
            lastErrorCode: null,
            reconnectAttempt: 0,
            nextReconnectAtMs: null,
          },
          account: {
            claimed: false as boolean,
            githubUsername: null as string | null,
            claimedAtMs: null as number | null,
          },
          publicationReconciliation: { blockedCount: 0, errorCode: null as 'sharing-publication-reconciliation-required' | null },
        },
      },
    },
    shares: { data: [], isLoading: false },
    loadShare: vi.fn(),
    updateConnection: { ...mutation },
    create: { ...mutation },
    update: { ...mutation },
    preview: { ...mutation },
    approve: { ...mutation },
    publish: { ...mutation },
    snapshot: { ...mutation },
    resumeRecovery: { ...mutation },
    claim: { ...mutation },
    reconcileAccount: { ...mutation },
    unpublish: { ...mutation },
    remove: { ...mutation },
    republish: { ...mutation },
    password: { ...mutation },
    ...overrides,
  }
}

function renderSettings(value = sharing()) {
  vi.mocked(useSharing).mockReturnValue(value as unknown as ReturnType<typeof useSharing>)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['sharing', 'workbooks'], [])
  client.setQueryData(['inventory-metadata', 'catalog'], { revision: 0, definitions: [], tags: [] })
  const element = () => <QueryClientProvider client={client}><TooltipProvider><SharingSettings /></TooltipProvider></QueryClientProvider>
  const view = render(element())
  return { ...view, rerenderSettings: () => view.rerender(element()) }
}

describe('SharingSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePermission).mockReturnValue(true)
  })

  it('shows automatic production enrollment without a setup action', () => {
    renderSettings()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable lab.gd sharing' })).toBeChecked()
    expect(screen.queryByText(/setup/i)).not.toBeInTheDocument()
  })

  it('distinguishes a healthy idle connection and renders only aggregate runtime counters', () => {
    const value = sharing()
    value.settings.data.settings.connection.dormant = true
    value.settings.data.settings.connection.live = false
    value.settings.data.settings.connection.interest = { required: false, activeShares: 0, pendingPublicationOperations: 0, pendingAccountOperations: 0, recoveryPending: false, pendingClaim: false, pendingClaimExpiresAtMs: null, reasons: [] }
    renderSettings(value)
    expect(screen.getByText('Connected, idle')).toBeInTheDocument()
    expect(screen.getByText(/event connection and credential renewal are paused/iu)).toBeInTheDocument()
    expect(screen.getByText('Streams').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('Reconnects').nextElementSibling).toHaveTextContent('1')
    expect(document.body.textContent).not.toContain('claim_')
  })

  it('shows bounded retry and recovery states', () => {
    const retrying = sharing()
    retrying.settings.data.settings.enrollmentState = 'retrying'
    retrying.settings.data.settings.nextAttemptAtMs = Date.parse('2026-08-23T12:00:00.000Z')
    const { unmount } = renderSettings(retrying)
    expect(screen.getByText('Retry scheduled')).toBeInTheDocument()
    expect(screen.getByText(/bounded backoff/)).toBeInTheDocument()
    unmount()

    const recovery = sharing()
    recovery.settings.data.settings.enrollmentState = 'recovery-pending'
    renderSettings(recovery)
    expect(screen.getByText('Owner approval required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume recovery' })).toBeInTheDocument()
  })

  it('shows a privacy-safe legacy publication reconciliation warning', () => {
    const value = sharing()
    value.settings.data.settings.publicationReconciliation = {
      blockedCount: 2,
      errorCode: 'sharing-publication-reconciliation-required',
    }
    renderSettings(value)
    expect(screen.getByText(/2 legacy publication operations paused/iu)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('idempotency')
    expect(document.body.textContent).not.toContain('manifest')
  })

  it('hides publication commands from users without publish permission', () => {
    vi.mocked(usePermission).mockImplementation((permission) => permission === 'sharing.configure')
    renderSettings()
    expect(screen.queryByRole('button', { name: 'New share' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect account' })).not.toBeInTheDocument()
  })

  it('keeps account and analytics controls hidden until lab.gd confirms support', () => {
    renderSettings()
    expect(screen.queryByRole('button', { name: 'Connect account' })).not.toBeInTheDocument()
    expect(screen.queryByText('Audience')).not.toBeInTheDocument()
  })

  it('closes a completed claim and shows the authoritative GitHub username', async () => {
    const value = sharing()
    value.settings.data.capabilities.accountClaiming = true
    value.settings.data.capabilities.installationAccountStatus = true
    value.claim.mutateAsync.mockResolvedValueOnce({
      claimId: 'claim_123',
      userCode: 'ABCD-2345',
      verificationUrl: 'https://app.lab.gd/claim',
      expiresAt: '2026-08-22T18:30:00.000Z',
      state: 'pending',
    })
    const view = renderSettings(value)
    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start account claim' }))
    expect(await screen.findByText('ABCD-2345')).toBeInTheDocument()

    value.settings.data.settings.account = {
      claimed: true,
      githubUsername: 'maikeldorta',
      claimedAtMs: Date.parse('2026-08-22T18:31:00.000Z'),
    }
    view.rerenderSettings()

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Connected to @maikeldorta')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Connected to @maikeldorta.')
    expect(screen.queryByRole('button', { name: 'Connect account' })).not.toBeInTheDocument()
  })

  it('shows negotiated remote controls and keeps password entry in request state', async () => {
    const remoteShare = { id: 1, projectId: 1, remotePublicId: 'share_1', title: 'Protected rack', description: '', mutability: 'replaceable', syncMode: 'manual', visibility: 'protected', state: 'synced', commentsEnabled: false, reactionsEnabled: false, embedEnabled: false, embedOrigins: [], resourceSnapshotIncluded: false, expirationType: 'indefinite', expirationDurationSeconds: null, expiresAtMs: null, localRevision: 2, remoteRevision: 3, activeManifestHash: null, approvedPreviewHash: null, accountClaimed: false, createdAtMs: 1, updatedAtMs: 1 } as const
    const value = sharing({ shares: { data: [remoteShare], isLoading: false } })
    value.settings.data.capabilities.protectedShares = true
    value.settings.data.capabilities.remoteLifecycle = true
    renderSettings(value)
    expect(screen.getByRole('button', { name: 'Unpublish share' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete share' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set share password' }))
    const input = screen.getByLabelText('Share password')
    expect(input).toHaveAttribute('autocomplete', 'new-password')
    fireEvent.change(input, { target: { value: 'request-only-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(value.password.mutateAsync).toHaveBeenCalledWith({ id: 1, password: 'request-only-password' })
  })

  it('renders nothing when sharing is prohibited by demo or staging policy', () => {
    const disabled = sharing()
    disabled.settings.data.available = false
    disabled.settings.data.demo = true
    const { container } = renderSettings(disabled)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('AccountClaimDialog', () => {
  it('shows the single-use code and opens only the code-free verification URL', () => {
    render(<AccountClaimDialog open pending={false} error={null} onOpenChange={vi.fn()} onBegin={vi.fn()} result={{ claimId: 'claim_123', userCode: 'ABCD-2345', verificationUrl: 'https://app.lab.gd/claim', expiresAt: '2026-08-22T18:30:00.000Z', state: 'pending' }} />)
    expect(screen.getByText('ABCD-2345')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /continue with github/iu })).toHaveAttribute('href', 'https://app.lab.gd/claim')
    expect(screen.getByRole('link', { name: /continue with github/iu }).getAttribute('href')).not.toContain('ABCD-2345')
  })
})
