import { apiRequest } from '@/lib/db'

export type SharingEnrollmentState = 'pending' | 'connected' | 'retrying' | 'recovery-pending' | 'disabled' | 'unsupported'
export type ShareState = 'unpublished' | 'preview-ready' | 'publishing' | 'synced' | 'changes-pending' | 'manual-update-available' | 'failed' | 'expired' | 'grace-period' | 'deleted'

export type SharingCapabilities = Readonly<{
  version: number
  publication: boolean
  accountClaiming: boolean
  installationEvents: boolean
  ownerAnalytics: boolean
  protectedShares: boolean
  remoteLifecycle: boolean
  views: readonly ('systems' | 'canvas')[]
  visibility: readonly ('public' | 'unlisted' | 'protected')[]
  mutability: readonly ('immutable' | 'replaceable')[]
  synchronization: readonly ('manual' | 'synchronized')[]
  embeds: boolean
  resourceSnapshots: boolean
  comments: 'coming-soon'
  reactions: 'coming-soon'
}>

export type SharingSettingsResponse = Readonly<{
  available: boolean
  automaticEnrollment: boolean
  demo: boolean
  staging: boolean
  origin: string
  capabilities: SharingCapabilities
  settings: {
    revision: number
    connectionEnabled: boolean
    enrollmentState: SharingEnrollmentState
    attemptCount: number
    nextAttemptAtMs: number | null
    lastErrorCode: string | null
    recoveryState: 'pending-owner-approval' | 'approved' | null
  }
}>

export type ShareRecord = Readonly<{
  id: number
  projectId: number
  remotePublicId: string | null
  title: string
  description: string
  mutability: 'immutable' | 'replaceable'
  syncMode: 'manual' | 'synchronized'
  visibility: 'public' | 'unlisted' | 'protected'
  state: ShareState
  commentsEnabled: boolean
  reactionsEnabled: boolean
  embedEnabled: boolean
  embedOrigins: readonly string[]
  resourceSnapshotIncluded: boolean
  expirationType: 'indefinite' | 'duration' | 'at'
  expirationDurationSeconds: number | null
  expiresAtMs: number | null
  localRevision: number
  remoteRevision: number | null
  activeManifestHash: string | null
  approvedPreviewHash: string | null
  accountClaimed: boolean
  createdAtMs: number
  updatedAtMs: number
}>

export type ShareViewSelection = Readonly<{
  workspaceId: number
  viewType: 'systems' | 'canvas'
  displayOrder?: number
}>

export type ShareConfiguration = Readonly<{
  share: ShareRecord
  views: readonly ShareViewSelection[]
  fieldDefinitionIds: readonly number[]
  tagIds: readonly number[]
}>

export type ShareInput = Readonly<{
  projectId: number
  title: string
  description: string
  mutability: 'immutable' | 'replaceable'
  syncMode: 'manual' | 'synchronized'
  visibility: 'public' | 'unlisted' | 'protected'
  commentsEnabled: boolean
  reactionsEnabled: boolean
  embed: { enabled: false } | { enabled: true; origins: readonly string[] }
  resourceSnapshotIncluded: boolean
  expiration:
    | { type: 'indefinite' }
    | { type: 'duration'; durationSeconds: number }
    | { type: 'at'; expiresAtMs: number }
  views: readonly Omit<ShareViewSelection, 'displayOrder'>[]
  fieldDefinitionIds: readonly number[]
  tagIds: readonly number[]
}>

export type SharePreview = Readonly<{
  manifestHash: string
  manifest: Record<string, unknown> & {
    title: string
    visibility: { type: ShareRecord['visibility'] }
    views: readonly Readonly<{
      publicViewId: string
      type: 'systems' | 'canvas'
      name: string
      contentHash: string
    }>[]
  }
  views?: readonly Record<string, unknown>[]
  summary: {
    views: number
    items: number
    connections: number
    registryReferences: number
    tags: number
    customFields: number
  }
  byteLength: number
  approved: boolean
}>

export function loadSharingSettings(): Promise<SharingSettingsResponse> {
  return apiRequest('/api/sharing/settings')
}

export function updateSharingSettings(expectedRevision: number, connectionEnabled: boolean): Promise<SharingSettingsResponse> {
  return apiRequest('/api/sharing/settings', {
    method: 'PATCH',
    body: JSON.stringify({ expectedRevision, connectionEnabled }),
  })
}

export async function loadShares(projectId?: number): Promise<ShareRecord[]> {
  const query = projectId ? `?projectId=${projectId}` : ''
  return (await apiRequest<{ shares: ShareRecord[] }>(`/api/sharing/shares${query}`)).shares
}

export function loadShare(id: number): Promise<ShareConfiguration> {
  return apiRequest(`/api/sharing/shares/${id}`)
}

export function createShare(input: ShareInput): Promise<ShareConfiguration> {
  return apiRequest('/api/sharing/shares', { method: 'POST', body: JSON.stringify(input) })
}

export function updateShare(id: number, expectedRevision: number, input: ShareInput): Promise<ShareConfiguration> {
  return apiRequest(`/api/sharing/shares/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...input, expectedRevision }),
  })
}

export function previewShare(id: number): Promise<SharePreview> {
  return apiRequest(`/api/sharing/shares/${id}/preview`, { method: 'POST' })
}

export function approveSharePreview(id: number, manifestHash: string): Promise<{ share: ShareRecord }> {
  return apiRequest(`/api/sharing/shares/${id}/preview/approve`, {
    method: 'POST', body: JSON.stringify({ manifestHash }),
  })
}

export function publishShare(id: number, update = false): Promise<{ operation: { id: number } }> {
  return apiRequest(`/api/sharing/shares/${id}/${update ? 'update' : 'publish'}`, { method: 'POST' })
}

export function refreshShareResourceSnapshot(id: number): Promise<{ share: ShareRecord }> {
  return apiRequest(`/api/sharing/shares/${id}/resource-snapshot`, { method: 'POST' })
}

export function resumeSharingRecovery(): Promise<{ status: 'resuming' }> {
  return apiRequest('/api/sharing/recovery/resume', { method: 'POST' })
}

export function beginSharingAccountClaim(): Promise<{
  claimId: string
  userCode: string
  verificationUrl: string
  expiresAt: string
  state: 'pending'
}> {
  return apiRequest('/api/sharing/account/claim', { method: 'POST' })
}
