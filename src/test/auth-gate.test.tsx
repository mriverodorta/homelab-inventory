import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from '@/components/auth/auth-gate'
import { useAuth } from '@/hooks/use-auth'
import type { AuthContextValue } from '@/auth/auth-context'

vi.mock('@/hooks/use-auth', () => ({ useAuth: vi.fn() }))

const useAuthMock = vi.mocked(useAuth)

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: {
      mode: 'local',
      setupRequired: false,
      authenticated: true,
      canManage: false,
      bootstrapSource: null,
      oidcSecretReadOnly: false,
      localCredentialConfigured: true,
      account: {
        id: 2,
        username: 'viewer',
        email: 'viewer@example.test',
        displayName: 'Viewer',
        protectedOwner: false,
      },
      permissions: [],
      roles: [],
      identityMethods: { local: true, oidc: false },
      methods: { local: true, oidc: false },
      oidc: {},
    },
    loading: false,
    error: null,
    setup: vi.fn(),
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    recover: vi.fn(),
    updateSettings: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  }
}

describe('AuthGate', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('blocks authenticated accounts that cannot open the workspace', () => {
    const auth = authValue()
    useAuthMock.mockReturnValue(auth)

    render(<AuthGate><div>Private workspace</div></AuthGate>)

    expect(screen.getByRole('heading', { name: 'Workspace access unavailable' })).toBeInTheDocument()
    expect(screen.queryByText('Private workspace')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.logout).toHaveBeenCalledOnce()
  })

  it('preserves open access when authentication is disabled', () => {
    useAuthMock.mockReturnValue(authValue({
      status: {
        ...authValue().status!,
        mode: 'disabled',
        account: null,
        permissions: [],
        identityMethods: { local: false, oidc: false },
        methods: { local: false, oidc: false },
      },
    }))

    render(<AuthGate><div>Open workspace</div></AuthGate>)

    expect(screen.getByText('Open workspace')).toBeInTheDocument()
  })
})
