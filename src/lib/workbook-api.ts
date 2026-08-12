import { apiRequest } from '@/lib/db'
import type { ProjectState } from '@/types/inventory'

export type ProjectIconKey =
  | 'folder'
  | 'house'
  | 'server'
  | 'network'
  | 'boxes'
  | 'building-2'
  | 'layers-3'

export type WorkspaceIconKey =
  | 'network'
  | 'layout-grid'
  | 'boxes'
  | 'route'
  | 'chart-no-axes-column'

export type WorkspaceColorKey =
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'violet'
  | 'cyan'
  | 'pink'
  | 'gray'

export type ProjectSummary = {
  id: number
  name: string
  description: string | null
  iconKey: ProjectIconKey
  revision: number
  includesGlobalInventory: boolean
}

export type WorkspaceSummary = {
  id: number
  projectId: number
  type: 'systems' | 'canvas'
  name: string
  iconKey: string
  colorKey: string
  sortOrder: number
  revision: number
  systemKey: string | null
}

export type ProjectWorkbook = {
  project: ProjectSummary
  defaultWorkspaceId: number
  workspaces: WorkspaceSummary[]
}

export type ProjectInput = {
  name: string
  description?: string | null
  iconKey?: ProjectIconKey
  includesGlobalInventory?: boolean
}

export type WorkspaceInput = {
  type: 'canvas'
  name: string
  iconKey: WorkspaceIconKey
  colorKey: WorkspaceColorKey
}

export async function loadProjects(): Promise<ProjectSummary[]> {
  return (await apiRequest<{ projects: ProjectSummary[] }>('/api/projects')).projects
}

export function loadProjectWorkbook(projectId: number): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}/workbook`)
}

export function createProject(input: ProjectInput): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateProject(projectId: number, input: Partial<ProjectInput>): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function archiveProject(projectId: number): Promise<{ ok: true; projectId: number }> {
  return apiRequest(`/api/projects/${projectId}`, { method: 'DELETE' })
}

export function createWorkspace(projectId: number, input: WorkspaceInput): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}/workspaces`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateWorkspace(
  projectId: number,
  workspaceId: number,
  input: Partial<Omit<WorkspaceInput, 'type'>>,
): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function reorderWorkspaces(projectId: number, workspaceIds: number[]): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}/workspaces/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ workspaceIds }),
  })
}

export function setDefaultWorkspace(projectId: number, workspaceId: number): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}/default-workspace`, {
    method: 'PUT',
    body: JSON.stringify({ workspaceId }),
  })
}

export function loadWorkspace(projectId: number, workspaceId: number): Promise<ProjectState> {
  return apiRequest<ProjectState>(`/api/projects/${projectId}/workspaces/${workspaceId}`)
}

export function saveWorkspace(projectId: number, workspaceId: number, project: ProjectState): Promise<ProjectState> {
  return apiRequest<ProjectState>(`/api/projects/${projectId}/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: JSON.stringify(project),
  })
}
