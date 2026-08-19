import { DEFAULT_PROJECT_ID } from '@/lib/project'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { consumeInitialBootstrap } from '@/lib/bootstrap-api'
import type { InventoryDependencyReport, InventoryRef } from '@/lib/inventory-lifecycle'
import type {
  InventoryItem,
  InventoryProperties,
  NasPowerConfiguration,
  NasPowerConfigurationChangeResult,
  ProjectState,
} from '@/types/inventory'
import type { InventoryItemMetadataInput } from '@/types/inventory-metadata'
import type { DomainMutationResult } from '@/types/domain-mutation'

export type InventoryItemInput = Omit<InventoryItem, 'id' | 'key'>
export type WorkspaceMutationScope = Readonly<{ projectId: number; workspaceId: number }>
export type AvailableGlobalInventoryItem = Pick<
  InventoryItem,
  'id' | 'type' | 'name' | 'manufacturer' | 'model' | 'family' | 'number' | 'subtype' | 'scope'
>

export function withWorkspaceScope(url: string, scope?: WorkspaceMutationScope | null) {
  if (!scope) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${new URLSearchParams({
    projectId: String(scope.projectId),
    workspaceId: String(scope.workspaceId),
  }).toString()}`
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? `Request failed with status ${response.status}.`)
  }

  return (await response.json()) as T
}

export async function loadProject(): Promise<ProjectState> {
  return consumeInitialBootstrap('project', () => apiRequest<ProjectState>('/api/project'))
}

export async function saveProject(project: ProjectState): Promise<ProjectState> {
  const projectId = project.metadata.projectId
  const workspaceId = project.metadata.workspaceId
  if (projectId && workspaceId) {
    return apiRequest<ProjectState>(`/api/projects/${projectId}/workspaces/${workspaceId}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    })
  }
  return apiRequest<ProjectState>('/api/project', {
    method: 'PUT',
    body: JSON.stringify({
      ...project,
      id: DEFAULT_PROJECT_ID,
    }),
  })
}

export async function createInventoryItems(
  item: InventoryItemInput,
  quantity = 1,
  scope?: WorkspaceMutationScope | null,
  metadata?: InventoryItemMetadataInput,
): Promise<ProjectState> {
  return apiRequest<ProjectState>(withWorkspaceScope('/api/inventory/items', scope), {
    method: 'POST',
    body: JSON.stringify({ item, quantity, ...(metadata ? { metadata } : {}) }),
  })
}

export async function updateInventoryItem(
  ref: InventoryRef,
  item: InventoryItemInput,
  scope?: WorkspaceMutationScope | null,
): Promise<DomainMutationResult<ProjectState>> {
  return apiRequest<DomainMutationResult<ProjectState>>(withWorkspaceScope(`/api/inventory/items/${ref.type}/${ref.id}`, scope), {
    method: 'PUT',
    body: JSON.stringify(item),
  })
}

export async function changeNasPowerConfiguration(
  id: number,
  powerConfiguration: NasPowerConfiguration,
  confirmed = false,
  scope?: WorkspaceMutationScope | null,
): Promise<NasPowerConfigurationChangeResult> {
  return apiRequest<NasPowerConfigurationChangeResult>(
    withWorkspaceScope(`/api/inventory/items/nas/${id}/power-configuration`, scope),
    {
      method: 'POST',
      body: JSON.stringify({ powerConfiguration, confirmed }),
    },
  )
}

export async function updateInventoryItemProperties(
  ref: InventoryRef,
  properties: InventoryProperties,
  scope?: WorkspaceMutationScope | null,
): Promise<DomainMutationResult<ProjectState>> {
  return apiRequest<DomainMutationResult<ProjectState>>(withWorkspaceScope(`/api/inventory/items/${ref.type}/${ref.id}/properties`, scope), {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  })
}

export async function duplicateInventoryItem(ref: InventoryRef, scope?: WorkspaceMutationScope | null): Promise<ProjectState> {
  return apiRequest<ProjectState>(withWorkspaceScope(`/api/inventory/items/${ref.type}/${ref.id}/duplicate`, scope), {
    method: 'POST',
  })
}

export async function setInventoryItemScope(
  ref: InventoryRef,
  target: { scope: 'global' | 'project'; projectId?: number },
): Promise<{
  item: { scope: 'global' | 'project'; ownerProjectId?: number | null }
  memberships: number[]
  project: ProjectState
}> {
  return apiRequest(`/api/inventory/items/${ref.type}/${ref.id}/scope`, {
    method: 'POST',
    body: JSON.stringify(target),
  })
}

export async function loadAvailableGlobalInventory(projectId: number): Promise<AvailableGlobalInventoryItem[]> {
  return (await apiRequest<{ items: AvailableGlobalInventoryItem[] }>(
    `/api/projects/${projectId}/inventory/global-available`,
  )).items
}

export async function addGlobalInventoryToProject(
  projectId: number,
  ref: InventoryRef,
): Promise<{ memberships: number[]; project: ProjectState }> {
  return apiRequest(`/api/projects/${projectId}/inventory/${ref.type}/${ref.id}/membership`, {
    method: 'POST',
  })
}

export async function removeGlobalInventoryFromProject(
  projectId: number,
  ref: InventoryRef,
): Promise<{ memberships: number[]; project: ProjectState }> {
  return apiRequest(`/api/projects/${projectId}/inventory/${ref.type}/${ref.id}/membership`, {
    method: 'DELETE',
  })
}

export async function duplicateInventoryToProject(
  targetProjectId: number,
  sourceProjectId: number,
  ref: InventoryRef,
): Promise<{ item: InventoryRef; project: ProjectState }> {
  return apiRequest(`/api/projects/${targetProjectId}/inventory/${ref.type}/${ref.id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ sourceProjectId }),
  })
}

export async function loadInventoryDependencies(
  ref: InventoryRef,
  scope?: WorkspaceMutationScope | null,
): Promise<InventoryDependencyReport> {
  return apiRequest<InventoryDependencyReport>(
    withWorkspaceScope(`/api/inventory/items/${ref.type}/${ref.id}/dependencies`, scope),
  )
}

export async function loadInventoryDependencyReports(
  items: InventoryRef[],
  scope?: WorkspaceMutationScope | null,
): Promise<InventoryDependencyReport[]> {
  const response = await apiRequest<{ reports: InventoryDependencyReport[] }>(
    withWorkspaceScope('/api/inventory/dependencies', scope),
    {
      method: 'POST',
      body: JSON.stringify({ items }),
    },
  )

  return response.reports
}

async function mutateInventoryItems(
  action: 'archive' | 'restore' | 'delete',
  items: InventoryRef[],
  scope?: WorkspaceMutationScope | null,
): Promise<ProjectState> {
  if (items.length === 1) {
    const [item] = items
    return apiRequest<ProjectState>(withWorkspaceScope(`/api/inventory/items/${item.type}/${item.id}${action === 'delete' ? '' : `/${action}`}`, scope), {
      method: action === 'delete' ? 'DELETE' : 'POST',
    })
  }

  return apiRequest<ProjectState>(withWorkspaceScope(`/api/inventory/batch/${action}`, scope), {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export function archiveInventoryItems(items: InventoryRef[], scope?: WorkspaceMutationScope | null): Promise<ProjectState> {
  return mutateInventoryItems('archive', items, scope)
}

export function restoreInventoryItems(items: InventoryRef[], scope?: WorkspaceMutationScope | null): Promise<ProjectState> {
  return mutateInventoryItems('restore', items, scope)
}

export function deleteInventoryItems(items: InventoryRef[], scope?: WorkspaceMutationScope | null): Promise<ProjectState> {
  return mutateInventoryItems('delete', items, scope)
}
