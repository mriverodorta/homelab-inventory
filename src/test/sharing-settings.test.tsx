import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
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
  return render(<QueryClientProvider client={client}><TooltipProvider><SharingSettings /></TooltipProvider></QueryClientProvider>)
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
