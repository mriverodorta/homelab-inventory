import { render, type RenderOptions } from '@testing-library/react'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { AuthContext, type AuthContextValue } from '@/auth/auth-context'

const openAuthValue: AuthContextValue = {
  status: {
    mode: 'disabled',
    setupRequired: false,
    authenticated: true,
    canManage: true,
    bootstrapSource: null,
    oidcSecretReadOnly: false,
    localCredentialConfigured: false,
    account: null,
    permissions: [],
    roles: [],
    identityMethods: { local: false, oidc: false },
    methods: { local: false, oidc: false },
    oidc: {},
  },
  loading: false,
  error: null,
  setup: async () => {},
  login: async () => {},
  logout: async () => {},
  recover: async () => {},
  updateSettings: async () => openAuthValue.status!,
  refresh: async () => {},
}

function OpenAuthTestProvider({ children }: { children: ReactNode }) {
  return createElement(AuthContext.Provider, { value: openAuthValue }, children)
}

export function renderWithOpenAuth(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { ...options, wrapper: OpenAuthTestProvider })
}
