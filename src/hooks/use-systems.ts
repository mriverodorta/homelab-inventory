import { useQuery } from '@tanstack/react-query'
import { loadSystems, loadSystemsLive } from '@/lib/systems-api'

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
