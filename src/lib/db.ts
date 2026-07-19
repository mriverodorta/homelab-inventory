import { DEFAULT_PROJECT_ID } from '@/lib/project'
import type { InventoryDependencyReport, InventoryRef } from '@/lib/inventory-lifecycle'
import type { InventoryItem, ProjectState } from '@/types/inventory'

export type InventoryItemInput = Omit<InventoryItem, 'id' | 'key'>

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
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
  return apiRequest<ProjectState>('/api/project')
}

export async function saveProject(project: ProjectState): Promise<ProjectState> {
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
): Promise<ProjectState> {
  return apiRequest<ProjectState>('/api/inventory/items', {
    method: 'POST',
    body: JSON.stringify({ item, quantity }),
  })
}

export async function updateInventoryItem(
  ref: InventoryRef,
  item: InventoryItemInput,
): Promise<ProjectState> {
  return apiRequest<ProjectState>(`/api/inventory/items/${ref.type}/${ref.id}`, {
    method: 'PUT',
    body: JSON.stringify(item),
  })
}

export async function duplicateInventoryItem(ref: InventoryRef): Promise<ProjectState> {
  return apiRequest<ProjectState>(`/api/inventory/items/${ref.type}/${ref.id}/duplicate`, {
    method: 'POST',
  })
}

export async function loadInventoryDependencies(
  ref: InventoryRef,
): Promise<InventoryDependencyReport> {
  return apiRequest<InventoryDependencyReport>(
    `/api/inventory/items/${ref.type}/${ref.id}/dependencies`,
  )
}

export async function loadInventoryDependencyReports(
  items: InventoryRef[],
): Promise<InventoryDependencyReport[]> {
  const response = await apiRequest<{ reports: InventoryDependencyReport[] }>(
    '/api/inventory/dependencies',
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
): Promise<ProjectState> {
  if (items.length === 1) {
    const [item] = items
    return apiRequest<ProjectState>(`/api/inventory/items/${item.type}/${item.id}${action === 'delete' ? '' : `/${action}`}`, {
      method: action === 'delete' ? 'DELETE' : 'POST',
    })
  }

  return apiRequest<ProjectState>(`/api/inventory/batch/${action}`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export function archiveInventoryItems(items: InventoryRef[]): Promise<ProjectState> {
  return mutateInventoryItems('archive', items)
}

export function restoreInventoryItems(items: InventoryRef[]): Promise<ProjectState> {
  return mutateInventoryItems('restore', items)
}

export function deleteInventoryItems(items: InventoryRef[]): Promise<ProjectState> {
  return mutateInventoryItems('delete', items)
}
