import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createSystemsView,
  deleteSystemsView,
  loadSystemAttention,
  loadSystems,
  loadSystemsLive,
  loadSystemsViews,
  replaceSystemsView,
  setDefaultSystemsView,
} from '@/lib/systems-api'
import type { SystemsHostLive, SystemsHostType, SystemsLiveResponse, SystemsSavedView, SystemsViewConfiguration } from '@/types/systems'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'

export function useSystems(projectId: number, enabled: boolean) {
  const queryClient = useQueryClient()
  const liveKey = useMemo(() => ['projects', projectId, 'systems', 'live'] as const, [projectId])
  const initial = useQuery({
    queryKey: ['projects', projectId, 'systems'],
    queryFn: () => loadSystems(projectId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })
  const live = useQuery({
    queryKey: liveKey,
    queryFn: () => loadSystemsLive(projectId),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })
  useEffect(() => {
    if (!enabled || !initial.data) return
    queryClient.setQueryData<SystemsLiveResponse>(liveKey, {
      projectId,
      generatedAt: initial.data.generatedAt,
      systems: initial.data.systems,
    })
  }, [enabled, initial.data, liveKey, projectId, queryClient])
  useLiveEventTopic({
    topic: `systems:${projectId}`,
    enabled: enabled && initial.isSuccess,
    onEvent: (event) => {
      const system = event.payload.system as SystemsHostLive | null | undefined
      if (system && Number.isSafeInteger(system.itemId) && system.itemId > 0) {
        queryClient.setQueryData<SystemsLiveResponse>(liveKey, (current) => {
          const systems = current?.systems ?? initial.data?.systems ?? []
          return {
            projectId,
            generatedAt: event.occurredAt,
            systems: [...systems.filter((candidate) => candidate.itemId !== system.itemId), system],
          }
        })
      } else if (!event.kind.startsWith('agent.')) {
        void live.refetch()
      }
      if (['agent.activation', 'agent.registration'].includes(event.kind)) void initial.refetch()
    },
    onResync: () => { void initial.refetch(); void live.refetch() },
  })
  return { initial, live }
}

export function useSystemsViews(projectId: number, enabled: boolean) {
  const queryClient = useQueryClient()
  const key = ['projects', projectId, 'systems', 'views'] as const
  const views = useQuery({ queryKey: key, queryFn: () => loadSystemsViews(projectId), enabled })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })
  useLiveEventTopic({
    topic: 'inventory-metadata:catalog',
    enabled,
    onEvent: () => { void invalidate() },
    onResync: () => { void invalidate() },
  })
  const replaceCachedView = (view: SystemsSavedView) => {
    queryClient.setQueryData<readonly SystemsSavedView[]>(key, (current = []) => (
      [...current.filter((entry) => entry.id !== view.id), view]
        .sort((left, right) => left.name.localeCompare(right.name))
    ))
  }
  const create = useMutation({
    mutationFn: (input: SystemsViewConfiguration & { name: string }) => createSystemsView(projectId, input),
    onSuccess: (view) => { replaceCachedView(view); void invalidate() },
  })
  const replace = useMutation({
    mutationFn: ({ id, revision, input }: { id: number; revision: number; input: SystemsViewConfiguration & { name: string } }) => (
      replaceSystemsView(projectId, id, revision, input)
    ),
    onSuccess: (view) => { replaceCachedView(view); void invalidate() },
  })
  const remove = useMutation({
    mutationFn: ({ id, revision }: { id: number; revision: number }) => deleteSystemsView(projectId, id, revision),
    onSuccess: ({ id }) => {
      queryClient.setQueryData<readonly SystemsSavedView[]>(key, (current = []) => current.filter((view) => view.id !== id))
      void invalidate()
    },
  })
  const setDefault = useMutation({
    mutationFn: ({ id, revision }: { id: number; revision: number }) => setDefaultSystemsView(projectId, id, revision),
    onSuccess: (view) => {
      queryClient.setQueryData<readonly SystemsSavedView[]>(key, (current = []) => current.map((entry) => ({
        ...entry,
        isDefault: entry.id === view.id,
        revision: entry.id === view.id ? view.revision : entry.revision,
        updatedAt: entry.id === view.id ? view.updatedAt : entry.updatedAt,
      })))
      void invalidate()
    },
  })
  return { views, create, replace, remove, setDefault }
}

export function useSystemAttention(projectId: number, hostType: SystemsHostType | null, hostId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['projects', projectId, 'systems', hostType, hostId, 'attention'],
    queryFn: () => loadSystemAttention(projectId, hostType!, hostId!),
    enabled: enabled && hostType !== null && hostId !== null,
  })
}
