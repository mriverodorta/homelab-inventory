import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  approveSharePreview,
  beginSharingAccountClaim,
  reconcileSharingAccount,
  createShare,
  deleteShare,
  loadShare,
  loadShares,
  loadSharingSettings,
  previewShare,
  publishShare,
  republishShare,
  replaceSharePassword,
  refreshShareResourceSnapshot,
  resumeSharingRecovery,
  unpublishShare,
  updateShare,
  updateSharingSettings,
  type ShareInput,
} from '@/lib/sharing-api'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'

export const SHARING_SETTINGS_QUERY_KEY = ['sharing', 'settings'] as const
export const SHARING_SHARES_QUERY_KEY = ['sharing', 'shares'] as const

export function useSharingAvailability(enabled: boolean) {
  return useQuery({
    queryKey: SHARING_SETTINGS_QUERY_KEY,
    queryFn: loadSharingSettings,
    enabled,
    staleTime: Infinity,
  })
}

export function useSharing(enabled: boolean) {
  const queryClient = useQueryClient()
  const settings = useSharingAvailability(enabled)
  const runtimeEnabled = enabled && settings.data?.available === true
  const shares = useQuery({
    queryKey: SHARING_SHARES_QUERY_KEY,
    queryFn: () => loadShares(),
    enabled: runtimeEnabled,
    staleTime: Infinity,
  })
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: SHARING_SETTINGS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: SHARING_SHARES_QUERY_KEY }),
  ])
  useLiveEventTopic({
    topic: 'sharing:status',
    enabled: runtimeEnabled,
    onEvent: () => void refresh(),
    onResync: () => void refresh(),
  })
  const refreshAfter = { onSuccess: refresh }

  return {
    settings,
    shares,
    loadShare: (id: number) => queryClient.fetchQuery({ queryKey: [...SHARING_SHARES_QUERY_KEY, id], queryFn: () => loadShare(id) }),
    updateConnection: useMutation({
      mutationFn: ({ expectedRevision, enabled }: { expectedRevision: number; enabled: boolean }) => updateSharingSettings(expectedRevision, enabled),
      ...refreshAfter,
    }),
    create: useMutation({ mutationFn: createShare, ...refreshAfter }),
    update: useMutation({
      mutationFn: ({ id, expectedRevision, input }: { id: number; expectedRevision: number; input: ShareInput }) => updateShare(id, expectedRevision, input),
      ...refreshAfter,
    }),
    preview: useMutation({ mutationFn: previewShare }),
    approve: useMutation({
      mutationFn: ({ id, manifestHash }: { id: number; manifestHash: string }) => approveSharePreview(id, manifestHash),
      ...refreshAfter,
    }),
    publish: useMutation({
      mutationFn: ({ id, update }: { id: number; update?: boolean }) => publishShare(id, update),
      ...refreshAfter,
    }),
    snapshot: useMutation({ mutationFn: refreshShareResourceSnapshot, ...refreshAfter }),
    resumeRecovery: useMutation({ mutationFn: resumeSharingRecovery, ...refreshAfter }),
    claim: useMutation({ mutationFn: beginSharingAccountClaim, ...refreshAfter }),
    reconcileAccount: useMutation({
      mutationFn: reconcileSharingAccount,
      onSuccess: (value) => { queryClient.setQueryData(SHARING_SETTINGS_QUERY_KEY, value) },
    }),
    unpublish: useMutation({ mutationFn: unpublishShare, ...refreshAfter }),
    remove: useMutation({ mutationFn: deleteShare, ...refreshAfter }),
    republish: useMutation({ mutationFn: republishShare, ...refreshAfter }),
    password: useMutation({ mutationFn: ({ id, password }: { id: number; password: string }) => replaceSharePassword(id, password), ...refreshAfter }),
  }
}
