import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'
import {
  loadCompatibilityFindings,
  loadCompatibilitySummary,
  resetCompatibilityAuditCache,
  setCompatibilityFindingIgnored,
} from '@/lib/compatibility-audit-api'
import type { CompatibilityAuditClassification } from '@/types/compatibility-audit'
import type { HostType } from '@/types/inventory'

function useCompatibilityEvents(projectId: number, enabled: boolean) {
  const queryClient = useQueryClient()
  const refresh = () => {
    resetCompatibilityAuditCache(projectId)
    void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'compatibility'] })
  }
  useLiveEventTopic({
    topic: `compatibility:${projectId}`,
    enabled,
    onEvent: refresh,
    onResync: refresh,
  })
}

export function useCompatibilitySummary(projectId: number, enabled: boolean) {
  useCompatibilityEvents(projectId, enabled)
  return useQuery({
    queryKey: ['projects', projectId, 'compatibility', 'summary'],
    queryFn: () => loadCompatibilitySummary(projectId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })
}

export function useCompatibilityFindings(projectId: number, filters: {
  classification?: CompatibilityAuditClassification
  hostType?: HostType
  hostId?: number
  visibility?: 'open' | 'ignored' | 'all'
}, enabled: boolean) {
  useCompatibilityEvents(projectId, enabled)
  return useQuery({
    queryKey: ['projects', projectId, 'compatibility', 'findings', filters],
    queryFn: () => loadCompatibilityFindings(projectId, filters),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })
}

export function useSetCompatibilityFindingIgnored(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ findingId, ignored }: { findingId: number; ignored: boolean }) => (
      setCompatibilityFindingIgnored(projectId, findingId, ignored)
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'compatibility'] })
    },
  })
}
