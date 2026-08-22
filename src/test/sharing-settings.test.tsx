import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SharingSettings } from '@/components/settings/sharing/sharing-settings'
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

  it('renders nothing when sharing is prohibited by demo or staging policy', () => {
    const disabled = sharing()
    disabled.settings.data.available = false
    disabled.settings.data.demo = true
    const { container } = renderSettings(disabled)
    expect(container).toBeEmptyDOMElement()
  })
})
