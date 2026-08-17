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
import type { SystemsHostType, SystemsSavedView, SystemsViewConfiguration } from '@/types/systems'

export const SYSTEMS_LIVE_REFRESH_INTERVAL_MS = 30_000

export function useSystems(projectId: number, enabled: boolean) {
  const initial = useQuery({
    queryKey: ['projects', projectId, 'systems'],
    queryFn: () => loadSystems(projectId),
    enabled,
    staleTime: 30_000,
  })
  const live = useQuery({
    queryKey: ['projects', projectId, 'systems', 'live'],
    queryFn: () => loadSystemsLive(projectId),
    enabled: enabled && initial.isSuccess,
    refetchInterval: enabled && initial.isSuccess ? SYSTEMS_LIVE_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  })
  return { initial, live }
}

export function useSystemsViews(projectId: number, enabled: boolean) {
  const queryClient = useQueryClient()
  const key = ['projects', projectId, 'systems', 'views'] as const
  const views = useQuery({ queryKey: key, queryFn: () => loadSystemsViews(projectId), enabled })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })
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
