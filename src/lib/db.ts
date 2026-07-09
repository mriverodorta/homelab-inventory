import { DEFAULT_PROJECT_ID } from '@/lib/project'
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

export async function createInventoryItem(item: InventoryItemInput): Promise<ProjectState> {
  return apiRequest<ProjectState>('/api/inventory/items', {
    method: 'POST',
    body: JSON.stringify(item),
  })
}
