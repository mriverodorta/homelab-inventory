import { apiRequest } from '@/lib/db'
import type { CableRoutingCacheSnapshot } from '@/engine/routing'

export function loadRoutingCache(): Promise<CableRoutingCacheSnapshot> {
  return apiRequest<CableRoutingCacheSnapshot>('/api/routing-cache')
}

export function saveRoutingCache(
  cache: CableRoutingCacheSnapshot,
): Promise<CableRoutingCacheSnapshot> {
  return apiRequest<CableRoutingCacheSnapshot>('/api/routing-cache', {
    method: 'PUT',
    body: JSON.stringify(cache),
  })
}
