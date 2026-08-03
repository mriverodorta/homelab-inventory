export type PermissionRisk = 'standard' | 'elevated' | 'destructive'

export interface AccessPermission {
  id: number
  key: string
  group: string
  description: string
  risk: PermissionRisk
  requiredForWorkspace: boolean
}

export interface AccessRole {
  id: number
  key: string
  name: string
  description: string
  builtIn: boolean
  active: boolean
  createdAt: string
  updatedAt: string
  permissionIds: number[]
  empty: boolean
}

export interface AccessUser {
  id: number
  username: string
  email: string | null
  displayName: string
  protectedOwner: boolean
  active: boolean
  createdAt: string
  updatedAt: string
  roleIds: number[]
  identityMethods: { local: boolean; oidc: boolean }
}

export type InvitationIdentityType = 'local' | 'oidc'
export type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked'

export interface AccessInvitation {
  id: number
  email: string
  identityType: InvitationIdentityType
  roleIds: number[]
  status: InvitationStatus
  createdByAccountId: number
  accountId: number | null
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
}

export interface InvitationActivation {
  invitation: AccessInvitation
}
