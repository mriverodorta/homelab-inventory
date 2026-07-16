import { apiRequest } from '@/lib/db'
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
export const UPDATE_STATUS_FRESH_MS = 6 * 60 * 60 * 1000
export const UPDATE_STATUS_REFRESH_FOLLOW_UP_MS = 30 * 1000

export function getUpdateStatusRefetchInterval(
  status: UpdateStatus | undefined,
  now = Date.now(),
): number | false {
  if (status?.state === 'disabled') return false

  const checkedAt = Date.parse(status?.checkedAt ?? '')
  if (Number.isFinite(checkedAt) && now - checkedAt >= UPDATE_STATUS_FRESH_MS) {
    return UPDATE_STATUS_REFRESH_FOLLOW_UP_MS
  }

  return UPDATE_STATUS_FRESH_MS
}

export function shouldHighlightUpdate(status: UpdateStatus | undefined): boolean {
  return status?.state === 'available'
    && status.updateAvailable === true
    && status.skipped === false
}

export async function loadUpdateStatus(): Promise<UpdateStatus> {
  return apiRequest<UpdateStatus>('/api/update-status')
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
