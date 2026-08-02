export type AuthenticationMode = 'disabled' | 'local' | 'oidc' | 'hybrid'

export interface AuthAccount {
  id: number
  username: string
  displayName: string
}

export interface AuthStatus {
  mode: AuthenticationMode
  setupRequired: boolean
  authenticated: boolean
  canManage: boolean
  bootstrapSource?: 'file' | 'environment' | 'generated' | null
  oidcSecretReadOnly: boolean
  localCredentialConfigured: boolean
  account: AuthAccount | null
  methods: { local: boolean; oidc: boolean }
  oidc: {
    issuer?: string | null
    clientId?: string | null
    scopes?: string[]
    externalUrl?: string | null
    clientSecretConfigured?: boolean
    identityBound?: boolean
    loginReady?: boolean
  }
}

export interface AuthSettingsInput {
  enabled: boolean
  localEnabled: boolean
  oidcEnabled: boolean
  username?: string
  displayName?: string
  password?: string
  clearOidcSecret?: boolean
  oidc?: {
    issuer?: string | null
    clientId?: string | null
    scopes?: string[]
    externalUrl?: string | null
    clientSecret?: string
  }
}
