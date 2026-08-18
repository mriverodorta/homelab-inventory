import { apiRequest } from '@/lib/db'
import { consumeInitialBootstrap } from '@/lib/bootstrap-api'
import type { ReleaseNoteEntry } from '@/release-notes'

export type UpdateChannel = 'stable' | 'latest'

export type UpdateCheckState = 'current' | 'available' | 'ahead' | 'unknown' | 'disabled'

export type UpdateStatus = {
  enabled: boolean
  channel: UpdateChannel
  runningVersion: string
  runningRevision: string
  availableVersion: string | null
  availableRevision: string | null
  updateAvailable: boolean
  skipped: boolean
  checkedAt: string | null
  state: UpdateCheckState
  errorCode: string | null
  entries: ReleaseNoteEntry[]
}

export const UPDATE_STATUS_QUERY_KEY = ['update-status'] as const

export function shouldHighlightUpdate(status: UpdateStatus | undefined): boolean {
  return status?.state === 'available'
    && status.updateAvailable === true
    && status.skipped === false
}

export async function loadUpdateStatus(): Promise<UpdateStatus> {
  return consumeInitialBootstrap('updateStatus', () => apiRequest<UpdateStatus>('/api/update-status'))
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  return apiRequest<UpdateStatus>('/api/update-status/check', {
    method: 'POST',
  })
}

export async function skipAvailableUpdate(): Promise<UpdateStatus> {
  return apiRequest<UpdateStatus>('/api/update-status/skip', {
    method: 'POST',
  })
}

export async function clearSkippedUpdate(): Promise<UpdateStatus> {
  return apiRequest<UpdateStatus>('/api/update-status/skip', {
    method: 'DELETE',
  })
}
