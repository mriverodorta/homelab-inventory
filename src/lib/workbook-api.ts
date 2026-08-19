import { apiRequest } from '@/lib/db'
import { consumeInitialBootstrap } from '@/lib/bootstrap-api'
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
  workbookRevision?: number
  includesGlobalInventory: boolean
  archivedAtMs?: number | null
}

export type ProjectDeletionImpact = {
  projectId: number
  projectName: string
  workspaces: number
  projectBoundItems: number
  globalMemberships: number
  placements: number
  assignments: number
  connections: number
  activeAgentBindings: number
  historicalAgentBindings: number
  incidents: number
  externalProjectDependencies: number
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
  viewportX?: number | null
  viewportY?: number | null
  viewportZoomBasisPoints?: number | null
  settings?: Record<string, unknown>
}

export type CanvasWorkspaceSettings = {
  networkCablesVisible: boolean
  powerCablesVisible: boolean
  displayCablesVisible: boolean
  snapCablesToGrid: boolean
  avoidCableCollisionsGlobally: boolean
  snapItemsToGrid: boolean
}

export type CanvasWorkspaceConfigurationInput = {
  settings?: Partial<CanvasWorkspaceSettings>
  viewport?: { x: number; y: number; zoom: number }
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

export async function loadArchivedProjects(): Promise<ProjectSummary[]> {
  return (await apiRequest<{ projects: ProjectSummary[] }>('/api/projects/archived')).projects
}

export async function loadProjectWorkbooks(): Promise<ProjectWorkbook[]> {
  return consumeInitialBootstrap('projects', async () => {
    const projects = await loadProjects()
    return Promise.all(projects.map((project) => loadProjectWorkbook(project.id)))
  })
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

export function restoreProject(projectId: number): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}/restore`, { method: 'POST' })
}

export function loadProjectDeletionImpact(projectId: number): Promise<ProjectDeletionImpact> {
  return apiRequest<ProjectDeletionImpact>(`/api/projects/${projectId}/deletion-impact`)
}

export function deleteArchivedProject(projectId: number): Promise<{ ok: true; impact: ProjectDeletionImpact }> {
  return apiRequest(`/api/projects/${projectId}/permanent`, { method: 'DELETE' })
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

export function updateCanvasWorkspaceConfiguration(
  projectId: number,
  workspaceId: number,
  input: CanvasWorkspaceConfigurationInput,
): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}/workspaces/${workspaceId}/configuration`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function archiveWorkspace(
  projectId: number,
  workspaceId: number,
): Promise<ProjectWorkbook> {
  return apiRequest<ProjectWorkbook>(`/api/projects/${projectId}/workspaces/${workspaceId}`, {
    method: 'DELETE',
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
