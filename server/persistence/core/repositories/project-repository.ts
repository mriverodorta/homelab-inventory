import { and, asc, eq, isNull } from 'drizzle-orm'
import { canvasWorkspaces, projectPreferences, projects, workspaces } from '../schema/index.ts'
import {
  assertPositiveId,
  bumpProjectRevision,
  createRepositoryContext,
  parseJson,
  type RepositoryContext,
} from './repository-context.ts'

export type WorkspaceType = 'systems' | 'canvas' | 'rack' | 'diagram' | 'vlan'

export type CreateProjectInput = Readonly<{
  name: string
  description?: string | null
  iconKey?: string
  includesGlobalInventory?: boolean
}>

export type CreateWorkspaceInput = Readonly<{
  type: Exclude<WorkspaceType, 'systems'>
  name: string
  iconKey: string
  colorKey: string
}>

export function createProjectRepository(context: RepositoryContext) {
  const { db, sqlite, now } = context

  function get(projectId: number) {
    assertPositiveId(projectId, 'Project ID')
    return db.select().from(projects).where(eq(projects.id, projectId)).get() ?? null
  }

  function listActive() {
    return db.select().from(projects).where(isNull(projects.archivedAtMs)).orderBy(asc(projects.id)).all()
  }

  function listWorkspaces(projectId: number) {
    assertPositiveId(projectId, 'Project ID')
    const rows = db.select({
      id: workspaces.id,
      projectId: workspaces.projectId,
      type: workspaces.type,
      name: workspaces.name,
      iconKey: workspaces.iconKey,
      colorKey: workspaces.colorKey,
      sortOrder: workspaces.sortOrder,
      revision: workspaces.revision,
      systemKey: workspaces.systemKey,
      archivedAtMs: workspaces.archivedAtMs,
      createdAtMs: workspaces.createdAtMs,
      updatedAtMs: workspaces.updatedAtMs,
      viewportX: canvasWorkspaces.viewportX,
      viewportY: canvasWorkspaces.viewportY,
      viewportZoomBasisPoints: canvasWorkspaces.viewportZoomBasisPoints,
      settingsJson: canvasWorkspaces.settingsJson,
    }).from(workspaces)
      .leftJoin(canvasWorkspaces, eq(canvasWorkspaces.id, workspaces.id))
      .where(eq(workspaces.projectId, projectId))
      .orderBy(asc(workspaces.sortOrder))
      .all()
    return rows.map((row) => ({
      ...row,
      settings: parseJson(row.settingsJson, {} as Record<string, unknown>),
    }))
  }

  function create(input: CreateProjectInput) {
    const name = input.name.trim()
    if (!name) throw new Error('Project name is required.')
    const at = now()
    return sqlite.transaction(() => {
      const project = db.insert(projects).values({
        name,
        description: input.description?.trim() || null,
        iconKey: input.iconKey ?? 'folder',
        includesGlobalInventory: input.includesGlobalInventory ?? true,
        createdAtMs: at,
        updatedAtMs: at,
      }).returning().get()
      const systems = db.insert(workspaces).values({
        projectId: project.id,
        type: 'systems',
        name: 'Systems',
        iconKey: 'server',
        colorKey: 'neutral',
        sortOrder: 0,
        systemKey: 'systems',
        createdAtMs: at,
        updatedAtMs: at,
      }).returning().get()
      const canvas = db.insert(workspaces).values({
        projectId: project.id,
        type: 'canvas',
        name: 'Canvas',
        iconKey: 'network',
        colorKey: 'blue',
        sortOrder: 1,
        createdAtMs: at,
        updatedAtMs: at,
      }).returning().get()
      db.insert(canvasWorkspaces).values({ id: canvas.id }).run()
      db.insert(projectPreferences).values({ projectId: project.id, defaultWorkspaceId: canvas.id, updatedAtMs: at }).run()
      return { project, systemsWorkspaceId: systems.id, canvasWorkspaceId: canvas.id }
    }).immediate()
  }

  function update(projectId: number, changes: Partial<CreateProjectInput>) {
    const current = get(projectId)
    if (!current || current.archivedAtMs != null) throw new Error(`Active project ${projectId} was not found.`)
    const name = changes.name === undefined ? current.name : changes.name.trim()
    if (!name) throw new Error('Project name is required.')
    const at = now()
    db.update(projects).set({
      name,
      description: changes.description === undefined ? current.description : changes.description?.trim() || null,
      iconKey: changes.iconKey ?? current.iconKey,
      includesGlobalInventory: changes.includesGlobalInventory ?? current.includesGlobalInventory,
      revision: current.revision + 1,
      updatedAtMs: at,
    }).where(eq(projects.id, projectId)).run()
    return get(projectId)
  }

  function archive(projectId: number) {
    assertPositiveId(projectId, 'Project ID')
    if (projectId === 1) throw new Error('The default project cannot be archived.')
    const at = now()
    const result = db.update(projects).set({ archivedAtMs: at, updatedAtMs: at })
      .where(and(eq(projects.id, projectId), isNull(projects.archivedAtMs))).run()
    if (result.changes !== 1) throw new Error(`Active project ${projectId} was not found.`)
  }

  function createWorkspace(projectId: number, input: CreateWorkspaceInput) {
    assertPositiveId(projectId, 'Project ID')
    const name = input.name.trim()
    if (!name) throw new Error('Workspace name is required.')
    const at = now()
    return sqlite.transaction(() => {
      const next = sqlite.query('SELECT coalesce(max(sort_order), 0) + 1 AS value FROM workspaces WHERE project_id = ? AND archived_at_ms IS NULL').get(projectId) as { value: number }
      const workspace = db.insert(workspaces).values({
        projectId,
        type: input.type,
        name,
        iconKey: input.iconKey,
        colorKey: input.colorKey,
        sortOrder: next.value,
        createdAtMs: at,
        updatedAtMs: at,
      }).returning().get()
      if (input.type === 'canvas') db.insert(canvasWorkspaces).values({ id: workspace.id }).run()
      bumpProjectRevision(context, projectId, at)
      return workspace
    }).immediate()
  }

  function setDefaultWorkspace(projectId: number, workspaceId: number) {
    assertPositiveId(workspaceId, 'Workspace ID')
    const workspace = db.select({ id: workspaces.id }).from(workspaces)
      .where(and(eq(workspaces.projectId, projectId), eq(workspaces.id, workspaceId), isNull(workspaces.archivedAtMs))).get()
    if (!workspace) throw new Error(`Active workspace ${workspaceId} was not found in project ${projectId}.`)
    const at = now()
    db.insert(projectPreferences).values({ projectId, defaultWorkspaceId: workspaceId, updatedAtMs: at })
      .onConflictDoUpdate({ target: projectPreferences.projectId, set: { defaultWorkspaceId: workspaceId, updatedAtMs: at } }).run()
    bumpProjectRevision(context, projectId, at)
  }

  return { get, listActive, listWorkspaces, create, update, archive, createWorkspace, setDefaultWorkspace }
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>

export { createRepositoryContext }
