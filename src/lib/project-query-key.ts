import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ProjectState } from '@/types/inventory'

export function projectQueryKey(project: ProjectState): QueryKey {
  const projectId = project.metadata.projectId
  const workspaceId = project.metadata.workspaceId
  return projectId && workspaceId && !(projectId === 1 && workspaceId === 2)
    ? ['project', projectId, workspaceId]
    : ['project']
}

export function projectQueryKeyForScope(projectId: number, workspaceId: number): QueryKey {
  return projectId === 1 && workspaceId === 2
    ? ['project']
    : ['project', projectId, workspaceId]
}

export function cacheProjectState(queryClient: QueryClient, project: ProjectState) {
  queryClient.setQueryData(projectQueryKey(project), project)
}
