import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/lib/notification-api'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const

export function useNotificationSnapshot(enabled = true) {
  const query = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: api.loadNotificationSnapshot,
    enabled,
    staleTime: Infinity,
  })
  useLiveEventTopic({
    topic: 'notifications:summary',
    enabled,
    onEvent: () => void query.refetch(),
    onResync: () => void query.refetch(),
  })
  return query
}

export function useNotificationSummary(enabled = true) {
  const query = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, 'summary'],
    queryFn: api.loadNotificationSummary,
    enabled,
    staleTime: Infinity,
  })
  useLiveEventTopic({
    topic: 'notifications:summary',
    enabled,
    onEvent: () => void query.refetch(),
    onResync: () => void query.refetch(),
  })
  return query
}

export function useNotificationIncidents(enabled = true, state = 'all') {
  const pageSize = 50
  const query = useInfiniteQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, 'incidents', state],
    queryFn: ({ pageParam }) => api.loadNotificationIncidents(state, pageSize, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((total, page) => total + page.incidents.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    enabled,
    staleTime: Infinity,
  })
  useLiveEventTopic({
    topic: 'notifications:incidents',
    enabled,
    onEvent: () => void query.refetch(),
    onResync: () => void query.refetch(),
  })
  return query
}

export function useNotificationMutations() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY })
  return {
    settings: useMutation({ mutationFn: api.updateNotificationSettings, onSuccess: refresh }),
    createContact: useMutation({ mutationFn: api.createNotificationContactPoint, onSuccess: refresh }),
    updateContact: useMutation({ mutationFn: ({ id, input }: { id: number; input: api.ContactPointInput }) => api.updateNotificationContactPoint(id, input), onSuccess: refresh }),
    deleteContact: useMutation({ mutationFn: ({ id, expectedRevision }: { id: number; expectedRevision: number }) => api.deleteNotificationContactPoint(id, expectedRevision), onSuccess: refresh }),
    testContact: useMutation({ mutationFn: api.testNotificationContactPoint }),
    updateRule: useMutation({ mutationFn: ({ id, expectedRevision, input }: { id: number; expectedRevision: number; input: Parameters<typeof api.updateNotificationRule>[2] }) => api.updateNotificationRule(id, expectedRevision, input), onSuccess: refresh }),
    createQuietHours: useMutation({ mutationFn: ({ expectedRevision, input }: { expectedRevision: number; input: Parameters<typeof api.createNotificationQuietHours>[1] }) => api.createNotificationQuietHours(expectedRevision, input), onSuccess: refresh }),
    updateQuietHours: useMutation({ mutationFn: ({ id, expectedRevision, input }: { id: number; expectedRevision: number; input: Parameters<typeof api.updateNotificationQuietHours>[2] }) => api.updateNotificationQuietHours(id, expectedRevision, input), onSuccess: refresh }),
    deleteQuietHours: useMutation({ mutationFn: ({ id, expectedRevision }: { id: number; expectedRevision: number }) => api.deleteNotificationQuietHours(id, expectedRevision), onSuccess: refresh }),
    updateHost: useMutation({ mutationFn: ({ hostType, hostId, input }: { hostType: Parameters<typeof api.updateHostNotificationPolicy>[0]; hostId: number; input: Parameters<typeof api.updateHostNotificationPolicy>[2] }) => api.updateHostNotificationPolicy(hostType, hostId, input), onSuccess: refresh }),
    acknowledge: useMutation({ mutationFn: api.acknowledgeNotificationIncident, onSuccess: refresh }),
    retry: useMutation({ mutationFn: api.retryNotificationDelivery, onSuccess: refresh }),
  }
}
