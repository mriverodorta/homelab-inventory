import type { Database } from 'bun:sqlite'
import type { ProjectState } from '../../../../src/types/inventory.ts'
import type { CacheStore } from '../../cache/cache-store.ts'
import { buildLegacyProjectProjection } from '../projections/legacy-project.ts'

type WorkspaceRevision = Readonly<{
  projectRevision: number
  workspaceRevision: number
}>

export function readWorkspaceRevision(
  database: Database,
  projectId: number,
  workspaceId: number,
): WorkspaceRevision {
  const row = database.query(`
    SELECT p.revision AS project_revision, w.revision AS workspace_revision
    FROM projects p
    JOIN workspaces w ON w.project_id = p.id
    WHERE p.id = ? AND w.id = ?
      AND p.archived_at_ms IS NULL
      AND w.archived_at_ms IS NULL
  `).get(projectId, workspaceId) as {
    project_revision: number
    workspace_revision: number
  } | null
  if (!row) throw new Error(`Active workspace ${workspaceId} for project ${projectId} was not found.`)
  return { projectRevision: row.project_revision, workspaceRevision: row.workspace_revision }
}

export function workspaceReadModelKey(
  projectId: number,
  workspaceId: number,
  revision: WorkspaceRevision,
) {
  return [
    'workspace-read-model',
    `project=${projectId}`,
    `workspace=${workspaceId}`,
    `projectRev=${revision.projectRevision}`,
    `workspaceRev=${revision.workspaceRevision}`,
  ].join(':')
}

export function buildWorkspaceReadModel({
  database,
  cache,
  projectId,
  workspaceId,
}: {
  database: Database
  cache: CacheStore
  projectId: number
  workspaceId: number
}): ProjectState {
  const revision = readWorkspaceRevision(database, projectId, workspaceId)
  const key = workspaceReadModelKey(projectId, workspaceId, revision)
  const cached = cache.get<ProjectState>(key)
  if (cached) return cached
  const projection = buildLegacyProjectProjection({ database, projectId, workspaceId })
  const project = {
    ...projection,
    metadata: { ...projection.metadata, projectId, workspaceId },
  }
  cache.set(key, project, { tags: [`project:${projectId}`, `workspace:${workspaceId}`] })
  return project
}
