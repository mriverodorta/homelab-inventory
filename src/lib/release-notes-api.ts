import { apiRequest } from '@/lib/db'
import { consumeInitialBootstrap } from '@/lib/bootstrap-api'
import type { ReleaseNoteEntry } from '@/release-notes'

export type ReleaseNotesStatus = {
  currentVersion: string
  lastSeenVersion: string
  hasUnseen: boolean
  entries: ReleaseNoteEntry[]
}

export async function loadReleaseNotesStatus(): Promise<ReleaseNotesStatus> {
  return consumeInitialBootstrap('releaseNotes', () => apiRequest<ReleaseNotesStatus>('/api/release-notes/status'))
}

export async function acknowledgeReleaseNotes(): Promise<ReleaseNotesStatus> {
  return apiRequest<ReleaseNotesStatus>('/api/release-notes/acknowledge', {
    method: 'POST',
  })
}
