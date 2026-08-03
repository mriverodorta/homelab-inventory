import { describe, expect, it } from 'vitest'
import { hasPermission } from '@/hooks/use-permission'
import type { AuthStatus } from '@/types/auth'

function status(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    mode: 'local',
    setupRequired: false,
    authenticated: true,
    canManage: false,
    oidcSecretReadOnly: false,
    localCredentialConfigured: true,
    account: { id: 2, username: 'viewer', email: null, displayName: 'Viewer', protectedOwner: false },
    permissions: ['workspace.view'],
    roles: [],
    identityMethods: { local: true, oidc: false },
    methods: { local: true, oidc: false },
    oidc: {},
    ...overrides,
  }
}

describe('hasPermission', () => {
  it('keeps authentication-disabled installations open', () => {
    expect(hasPermission(status({ mode: 'disabled', authenticated: true }), 'inventory.delete')).toBe(true)
  })

  it('requires an explicit permission when authentication is enabled', () => {
    expect(hasPermission(status(), 'workspace.view')).toBe(true)
    expect(hasPermission(status(), 'inventory.delete')).toBe(false)
    expect(hasPermission(status({ authenticated: false }), 'workspace.view')).toBe(false)
  })
})
