import { apiRequest } from '@/lib/db'
import { withWorkspaceScope, type WorkspaceMutationScope } from '@/lib/db'
import type { CableRoutingCacheSnapshot } from '@/engine/routing'

export function loadRoutingCache(scope: WorkspaceMutationScope): Promise<CableRoutingCacheSnapshot> {
  return apiRequest<CableRoutingCacheSnapshot>(withWorkspaceScope('/api/routing-cache', scope))
}

export function saveRoutingCache(
  scope: WorkspaceMutationScope,
  cache: CableRoutingCacheSnapshot,
): Promise<CableRoutingCacheSnapshot> {
  return apiRequest<CableRoutingCacheSnapshot>(withWorkspaceScope('/api/routing-cache', scope), {
    method: 'PUT',
    body: JSON.stringify(cache),
  })
}
