import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  acknowledgeReleaseNotes,
  loadReleaseNotesStatus,
  type ReleaseNotesStatus,
} from '@/lib/release-notes-api'
import {
  checkForUpdates,
  clearSkippedUpdate,
  loadUpdateStatus,
  shouldHighlightUpdate,
  skipAvailableUpdate,
  UPDATE_STATUS_QUERY_KEY,
  type UpdateStatus,
} from '@/lib/update-api'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'

const RELEASE_NOTES_STATUS_QUERY_KEY = ['release-notes-status'] as const

export function useReleaseUpdateController({ canViewUpdates = true }: { canViewUpdates?: boolean } = {}) {
  const queryClient = useQueryClient()
  const [releaseNotesDismissedForSession, setReleaseNotesDismissedForSession] = useState(false)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const releaseNotesQuery = useQuery({
    queryKey: RELEASE_NOTES_STATUS_QUERY_KEY,
    queryFn: loadReleaseNotesStatus,
  })
  const updateStatusQuery = useQuery({
    queryKey: UPDATE_STATUS_QUERY_KEY,
    queryFn: loadUpdateStatus,
    staleTime: Infinity,
    retry: false,
    enabled: canViewUpdates,
  })
  useLiveEventTopic({
    topic: 'updates:status',
    enabled: canViewUpdates,
    onEvent: () => void updateStatusQuery.refetch(),
    onResync: () => void updateStatusQuery.refetch(),
  })
  const acknowledgeReleaseNotesMutation = useMutation({
    mutationFn: acknowledgeReleaseNotes,
    onSuccess: (status) => {
      queryClient.setQueryData<ReleaseNotesStatus>(RELEASE_NOTES_STATUS_QUERY_KEY, status)
      setReleaseNotesDismissedForSession(true)
    },
  })
  const checkForUpdatesMutation = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (status) => queryClient.setQueryData<UpdateStatus>(UPDATE_STATUS_QUERY_KEY, status),
  })
  const skipUpdateMutation = useMutation({
    mutationFn: skipAvailableUpdate,
    onSuccess: (status) => {
      queryClient.setQueryData<UpdateStatus>(UPDATE_STATUS_QUERY_KEY, status)
      setUpdateDialogOpen(false)
    },
  })
  const clearSkippedUpdateMutation = useMutation({
    mutationFn: clearSkippedUpdate,
    onSuccess: (status) => queryClient.setQueryData<UpdateStatus>(UPDATE_STATUS_QUERY_KEY, status),
  })
  const whatsNewVisible = !releaseNotesDismissedForSession
    && releaseNotesQuery.data?.hasUnseen === true
    && releaseNotesQuery.data.entries.length > 0

  return {
    releaseNotesQuery,
    updateStatusQuery,
    acknowledgeReleaseNotesMutation,
    checkForUpdatesMutation,
    skipUpdateMutation,
    clearSkippedUpdateMutation,
    updateDialogOpen,
    setUpdateDialogOpen,
    whatsNewVisible,
    updateHighlighted: shouldHighlightUpdate(updateStatusQuery.data),
    dismissWhatsNew: () => setReleaseNotesDismissedForSession(true),
  }
}
