import { and, asc, eq } from 'drizzle-orm'
import {
  workspaceManualBendPoints,
  workspacePlacements,
} from '../schema/index.ts'
import {
  assertPositiveId,
  bumpProjectRevision,
  bumpWorkspaceRevision,
  parseJson,
  type RepositoryContext,
} from './repository-context.ts'

export type RouteCacheWrite = Readonly<{
  projectId: number
  workspaceId: number
  connectionId: number
  engineVersion: string
  layoutFingerprint: string
  routeFingerprint: string
  route: unknown
  calculatedAtMs?: number
}>

export function createRoutingRepository(context: RepositoryContext) {
  const { db, sqlite, now } = context
  const readCache = sqlite.query(`
    SELECT engine_version, layout_fingerprint, route_fingerprint,
           route_payload_json, calculated_at_ms
    FROM workspace_route_cache
    WHERE project_id = ? AND workspace_id = ? AND connection_id = ?
  `)
  const writeCache = sqlite.query(`
    INSERT INTO workspace_route_cache (
      project_id, workspace_id, connection_id, engine_version,
      layout_fingerprint, route_fingerprint, route_payload_json, calculated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, connection_id) DO UPDATE SET
      project_id = excluded.project_id,
      engine_version = excluded.engine_version,
      layout_fingerprint = excluded.layout_fingerprint,
      route_fingerprint = excluded.route_fingerprint,
      route_payload_json = excluded.route_payload_json,
      calculated_at_ms = excluded.calculated_at_ms
  `)

  function listPlacements(projectId: number, workspaceId: number) {
    return db.select().from(workspacePlacements).where(and(
      eq(workspacePlacements.projectId, assertPositiveId(projectId, 'Project ID')),
      eq(workspacePlacements.workspaceId, assertPositiveId(workspaceId, 'Workspace ID')),
    )).orderBy(asc(workspacePlacements.id)).all()
  }

  function setPlacement(input: {
    projectId: number
    workspaceId: number
    itemId: number
    x: number
    y: number
    orientation?: string | null
    zIndex?: number
  }) {
    if (![input.x, input.y].every(Number.isFinite)) throw new Error('Placement coordinates must be finite.')
    const at = now()
    return sqlite.transaction(() => {
      db.insert(workspacePlacements).values({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        itemId: input.itemId,
        x: input.x,
        y: input.y,
        orientation: input.orientation ?? null,
        zIndex: input.zIndex ?? 0,
        createdAtMs: at,
        updatedAtMs: at,
      }).onConflictDoUpdate({
        target: [workspacePlacements.workspaceId, workspacePlacements.itemId],
        set: {
          projectId: input.projectId,
          x: input.x,
          y: input.y,
          orientation: input.orientation ?? null,
          zIndex: input.zIndex ?? 0,
          updatedAtMs: at,
        },
      }).run()
      bumpWorkspaceRevision(context, input.projectId, input.workspaceId, at)
      bumpProjectRevision(context, input.projectId, at)
    }).immediate()
  }

  function replaceManualBends(input: {
    projectId: number
    workspaceId: number
    connectionId: number
    points: readonly { x: number; y: number }[]
  }) {
    const at = now()
    return sqlite.transaction(() => {
      db.delete(workspaceManualBendPoints).where(and(
        eq(workspaceManualBendPoints.workspaceId, input.workspaceId),
        eq(workspaceManualBendPoints.connectionId, input.connectionId),
      )).run()
      if (input.points.length) {
        db.insert(workspaceManualBendPoints).values(input.points.map((point, position) => ({
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          position,
          x: point.x,
          y: point.y,
        }))).run()
      }
      bumpWorkspaceRevision(context, input.projectId, input.workspaceId, at)
      bumpProjectRevision(context, input.projectId, at)
    }).immediate()
  }

  function getRouteCache(projectId: number, workspaceId: number, connectionId: number) {
    const row = readCache.get(
      assertPositiveId(projectId, 'Project ID'),
      assertPositiveId(workspaceId, 'Workspace ID'),
      assertPositiveId(connectionId, 'Connection ID'),
    ) as {
      engine_version: string
      layout_fingerprint: string
      route_fingerprint: string
      route_payload_json: string
      calculated_at_ms: number
    } | null
    if (!row) return null
    return {
      engineVersion: row.engine_version,
      layoutFingerprint: row.layout_fingerprint,
      routeFingerprint: row.route_fingerprint,
      route: parseJson(row.route_payload_json, null),
      calculatedAtMs: row.calculated_at_ms,
    }
  }

  function putRouteCache(input: RouteCacheWrite) {
    writeCache.run(
      assertPositiveId(input.projectId, 'Project ID'),
      assertPositiveId(input.workspaceId, 'Workspace ID'),
      assertPositiveId(input.connectionId, 'Connection ID'),
      input.engineVersion,
      input.layoutFingerprint,
      input.routeFingerprint,
      JSON.stringify(input.route),
      input.calculatedAtMs ?? now(),
    )
    return getRouteCache(input.projectId, input.workspaceId, input.connectionId)
  }

  return { listPlacements, setPlacement, replaceManualBends, getRouteCache, putRouteCache }
}

export type RoutingRepository = ReturnType<typeof createRoutingRepository>
