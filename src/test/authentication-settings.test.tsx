import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthenticationSettings } from '@/components/settings/authentication-settings'
import { useAuth } from '@/hooks/use-auth'

vi.mock('@/hooks/use-auth', () => ({ useAuth: vi.fn() }))

const useAuthMock = vi.mocked(useAuth)

describe('AuthenticationSettings', () => {
  it('renders the public demo policy without editable authentication controls', () => {
    useAuthMock.mockReturnValue({
      status: {
        mode: 'disabled',
        setupRequired: false,
        authenticated: true,
        canManage: false,
        bootstrapSource: null,
        oidcSecretReadOnly: false,
      localCredentialConfigured: false,
      account: null,
      permissions: [],
      roles: [],
      identityMethods: { local: false, oidc: false },
        methods: { local: false, oidc: false },
        oidc: {
          clientSecretConfigured: false,
          identityBound: false,
          loginReady: false,
        },
      },
      loading: false,
      error: null,
      setup: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      recover: vi.fn(),
      updateSettings: vi.fn(),
      refresh: vi.fn(),
    })

    render(<AuthenticationSettings />)

    expect(screen.getByRole('heading', { name: 'Authentication' })).toBeInTheDocument()
    expect(screen.getByText('Public demo sessions use an enforced open-access policy.')).toBeInTheDocument()
    expect(screen.getByText(/Authentication cannot be enabled in the public demo/)).toBeInTheDocument()
    expect(screen.getByText(/deleted when the session expires/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable authentication' })).not.toBeInTheDocument()
  })
})
