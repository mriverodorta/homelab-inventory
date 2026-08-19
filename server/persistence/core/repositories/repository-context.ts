import type { Database } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { coreSchema } from '../schema/index.ts'

export type CoreDatabase = BunSQLiteDatabase<typeof coreSchema>

export type RepositoryContext = Readonly<{
  sqlite: Database
  db: CoreDatabase
  now: () => number
}>

export function createRepositoryContext(sqlite: Database, now: () => number = Date.now): RepositoryContext {
  return { sqlite, db: drizzle(sqlite, { schema: coreSchema }), now }
}

export function assertPositiveId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`)
  return value
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return structuredClone(fallback)
  return JSON.parse(value) as T
}

export function iso(value: number | null | undefined) {
  return value == null ? undefined : new Date(value).toISOString()
}

export function bumpProjectRevision(context: RepositoryContext, projectId: number, at = context.now()) {
  assertPositiveId(projectId, 'Project ID')
  const result = context.sqlite.query(`
    UPDATE projects
    SET revision = revision + 1, updated_at_ms = ?
    WHERE id = ? AND archived_at_ms IS NULL
  `).run(at, projectId)
  if (result.changes !== 1) throw new Error(`Active project ${projectId} was not found.`)
}

export function bumpWorkbookRevision(context: RepositoryContext, projectId: number, at = context.now()) {
  assertPositiveId(projectId, 'Project ID')
  const result = context.sqlite.query(`
    UPDATE projects
    SET workbook_revision = workbook_revision + 1, updated_at_ms = ?
    WHERE id = ? AND archived_at_ms IS NULL
  `).run(at, projectId)
  if (result.changes !== 1) throw new Error(`Active project ${projectId} was not found.`)
}

export function bumpWorkspaceRevision(
  context: RepositoryContext,
  projectId: number,
  workspaceId: number,
  at = context.now(),
) {
  assertPositiveId(projectId, 'Project ID')
  assertPositiveId(workspaceId, 'Workspace ID')
  const result = context.sqlite.query(`
    UPDATE workspaces
    SET revision = revision + 1, updated_at_ms = ?
    WHERE id = ? AND project_id = ? AND archived_at_ms IS NULL
  `).run(at, workspaceId, projectId)
  if (result.changes !== 1) throw new Error(`Active workspace ${workspaceId} was not found in project ${projectId}.`)
}
