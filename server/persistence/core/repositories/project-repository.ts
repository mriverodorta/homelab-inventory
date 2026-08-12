import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { canvasWorkspaces, projectPreferences, projects, workspaces } from '../schema/index.ts'
import {
  assertProjectIconKey,
  assertWorkspaceAppearance,
  type ProjectSummary,
  type ProjectWorkbook,
  type WorkspaceSummary,
} from '../projects/project-contract.ts'
import {
  assertPositiveId,
  bumpProjectRevision,
  createRepositoryContext,
  parseJson,
  type RepositoryContext,
} from './repository-context.ts'

export type CreateProjectInput = Readonly<{
  name: string
  description?: string | null
  iconKey?: string
  includesGlobalInventory?: boolean
}>

export type CreateWorkspaceInput = Readonly<{
  type: 'canvas'
  name: string
  iconKey: string
  colorKey: string
}>

export type UpdateWorkspaceInput = Readonly<{
  name?: string
  iconKey?: string
  colorKey?: string
}>

export function createProjectRepository(context: RepositoryContext) {
  const { db, sqlite, now } = context

  function get(projectId: number): ProjectSummary | null {
    assertPositiveId(projectId, 'Project ID')
    return (db.select().from(projects).where(eq(projects.id, projectId)).get() ?? null) as ProjectSummary | null
  }

  function listActive(): ProjectSummary[] {
    return db.select().from(projects).where(isNull(projects.archivedAtMs)).orderBy(asc(projects.id)).all() as ProjectSummary[]
  }

  function listWorkspaces(projectId: number): WorkspaceSummary[] {
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
      .where(and(eq(workspaces.projectId, projectId), isNull(workspaces.archivedAtMs)))
      .orderBy(asc(workspaces.sortOrder))
      .all()
    return rows.map((row) => ({
      ...row,
      settings: parseJson(row.settingsJson, {} as Record<string, unknown>),
    })) as WorkspaceSummary[]
  }

  function getWorkbook(projectId: number): ProjectWorkbook {
    const project = get(projectId)
    if (!project || project.archivedAtMs != null) throw new Error(`Active project ${projectId} was not found.`)
    const workspaceRows = listWorkspaces(projectId)
    const preference = db.select({ defaultWorkspaceId: projectPreferences.defaultWorkspaceId })
      .from(projectPreferences)
      .where(eq(projectPreferences.projectId, projectId))
      .get()
    const fallback = workspaceRows.find((workspace) => workspace.type === 'canvas') ?? workspaceRows[0]
    if (!fallback) throw new Error(`Project ${projectId} has no active workspaces.`)
    const defaultWorkspaceId = workspaceRows.some((workspace) => workspace.id === preference?.defaultWorkspaceId)
      ? preference!.defaultWorkspaceId
      : fallback.id
    return { project, defaultWorkspaceId, workspaces: workspaceRows }
  }

  function create(input: CreateProjectInput) {
    const name = input.name.trim()
    if (!name) throw new Error('Project name is required.')
    const iconKey = input.iconKey ?? 'folder'
    assertProjectIconKey(iconKey)
    const at = now()
    return sqlite.transaction(() => {
      const project = db.insert(projects).values({
        name,
        description: input.description?.trim() || null,
        iconKey,
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
    const iconKey = changes.iconKey ?? current.iconKey
    assertProjectIconKey(iconKey)
    const at = now()
    db.update(projects).set({
      name,
      description: changes.description === undefined ? current.description : changes.description?.trim() || null,
      iconKey,
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

  function restore(projectId: number) {
    assertPositiveId(projectId, 'Project ID')
    const current = db.select().from(projects)
      .where(and(eq(projects.id, projectId), isNotNull(projects.archivedAtMs)))
      .get()
    if (!current) throw new Error(`Archived project ${projectId} was not found.`)
    const at = now()
    db.update(projects).set({ archivedAtMs: null, revision: current.revision + 1, updatedAtMs: at })
      .where(eq(projects.id, projectId)).run()
    return get(projectId)
  }

  function createWorkspace(projectId: number, input: CreateWorkspaceInput) {
    assertPositiveId(projectId, 'Project ID')
    if (input.type !== 'canvas') throw new Error('Only Canvas workspaces can be created in this release.')
    const name = input.name.trim()
    if (!name) throw new Error('Workspace name is required.')
    assertWorkspaceAppearance(input)
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

  function activeWorkspace(projectId: number, workspaceId: number) {
    assertPositiveId(projectId, 'Project ID')
    assertPositiveId(workspaceId, 'Workspace ID')
    const workspace = db.select().from(workspaces).where(and(
      eq(workspaces.projectId, projectId),
      eq(workspaces.id, workspaceId),
      isNull(workspaces.archivedAtMs),
    )).get()
    if (!workspace) throw new Error(`Active workspace ${workspaceId} was not found in project ${projectId}.`)
    return workspace
  }

  function updateWorkspace(projectId: number, workspaceId: number, changes: UpdateWorkspaceInput) {
    const current = activeWorkspace(projectId, workspaceId)
    if (current.type === 'systems') throw new Error('The Systems workspace name, icon, and color are fixed.')
    const name = changes.name === undefined ? current.name : changes.name.trim()
    if (!name) throw new Error('Workspace name is required.')
    const iconKey = changes.iconKey ?? current.iconKey
    const colorKey = changes.colorKey ?? current.colorKey
    assertWorkspaceAppearance({ iconKey, colorKey })
    const at = now()
    db.update(workspaces).set({
      name,
      iconKey,
      colorKey,
      revision: current.revision + 1,
      updatedAtMs: at,
    }).where(and(eq(workspaces.projectId, projectId), eq(workspaces.id, workspaceId))).run()
    return listWorkspaces(projectId).find((workspace) => workspace.id === workspaceId)!
  }

  function reorderWorkspaces(projectId: number, orderedWorkspaceIds: readonly number[]) {
    assertPositiveId(projectId, 'Project ID')
    if (new Set(orderedWorkspaceIds).size !== orderedWorkspaceIds.length) {
      throw new Error('Workspace order contains duplicate IDs.')
    }
    orderedWorkspaceIds.forEach((workspaceId) => assertPositiveId(workspaceId, 'Workspace ID'))
    const current = listWorkspaces(projectId)
    const expected = current.filter((workspace) => workspace.type !== 'systems').map((workspace) => workspace.id).sort((a, b) => a - b)
    const received = [...orderedWorkspaceIds].sort((a, b) => a - b)
    if (JSON.stringify(expected) !== JSON.stringify(received)) {
      throw new Error('Workspace order must contain every active non-System workspace exactly once.')
    }
    const at = now()
    sqlite.transaction(() => {
      const stagingStart = current.reduce(
        (maximum, workspace) => Math.max(maximum, workspace.sortOrder),
        0,
      ) + orderedWorkspaceIds.length + 1
      orderedWorkspaceIds.forEach((workspaceId, index) => {
        sqlite.query('UPDATE workspaces SET sort_order = ? WHERE project_id = ? AND id = ?')
          .run(stagingStart + index, projectId, workspaceId)
      })
      orderedWorkspaceIds.forEach((workspaceId, index) => {
        const previous = current.find((workspace) => workspace.id === workspaceId)!
        const sortOrder = index + 1
        sqlite.query(`
          UPDATE workspaces
          SET sort_order = ?, revision = revision + ?, updated_at_ms = ?
          WHERE project_id = ? AND id = ?
        `).run(sortOrder, Number(previous.sortOrder !== sortOrder), at, projectId, workspaceId)
      })
    }).immediate()
    return listWorkspaces(projectId)
  }

  function archiveWorkspace(projectId: number, workspaceId: number) {
    const current = activeWorkspace(projectId, workspaceId)
    if (current.type === 'systems') throw new Error('The Systems workspace cannot be archived.')
    const active = listWorkspaces(projectId)
    if (current.type === 'canvas' && active.filter((workspace) => workspace.type === 'canvas').length <= 1) {
      throw new Error('Every project must retain at least one Canvas workspace.')
    }
    const at = now()
    sqlite.transaction(() => {
      sqlite.query(`
        UPDATE workspaces
        SET archived_at_ms = ?, revision = revision + 1, updated_at_ms = ?
        WHERE project_id = ? AND id = ?
      `).run(at, at, projectId, workspaceId)
      const remaining = listWorkspaces(projectId)
      remaining.filter((workspace) => workspace.type !== 'systems').forEach((workspace, index) => {
        sqlite.query('UPDATE workspaces SET sort_order = ? WHERE project_id = ? AND id = ?')
          .run(index + 1, projectId, workspace.id)
      })
      const preference = sqlite.query('SELECT default_workspace_id FROM project_preferences WHERE project_id = ?')
        .get(projectId) as { default_workspace_id: number } | null
      if (preference?.default_workspace_id === workspaceId) {
        const fallback = remaining.find((workspace) => workspace.type === 'canvas') ?? remaining[0]
        sqlite.query('UPDATE project_preferences SET default_workspace_id = ?, updated_at_ms = ? WHERE project_id = ?')
          .run(fallback.id, at, projectId)
      }
      bumpProjectRevision(context, projectId, at)
    }).immediate()
    return getWorkbook(projectId)
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

  return {
    get,
    getWorkbook,
    listActive,
    listWorkspaces,
    create,
    update,
    archive,
    restore,
    createWorkspace,
    updateWorkspace,
    reorderWorkspaces,
    archiveWorkspace,
    setDefaultWorkspace,
  }
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>

export { createRepositoryContext }
