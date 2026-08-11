import { asc, desc, eq } from 'drizzle-orm'
import { backupOperations, backupRuns, backupSchedules } from '../schema/index.ts'
import { parseJson, type RepositoryContext } from './repository-context.ts'

export function createBackupRepository({ db, now }: RepositoryContext) {
  function getSchedule() {
    return db.select().from(backupSchedules).where(eq(backupSchedules.id, 1)).get() ?? null
  }

  function listRuns(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Backup run limit must be between 1 and 500.')
    return db.select().from(backupRuns).orderBy(desc(backupRuns.startedAtMs)).limit(limit).all()
      .map((run) => ({ ...run, selectedSections: parseJson(run.selectedSectionsJson, [] as string[]) }))
  }

  function beginOperation(operationType: 'backup' | 'restore', relatedRecordId?: number | null) {
    db.insert(backupOperations).values({
      id: 1,
      operationType,
      relatedRecordId: relatedRecordId ?? null,
      state: 'running',
      startedAtMs: now(),
    }).run()
  }

  function endOperation() {
    db.delete(backupOperations).where(eq(backupOperations.id, 1)).run()
  }

  function listChronological() {
    return db.select().from(backupRuns).orderBy(asc(backupRuns.startedAtMs)).all()
  }

  return { getSchedule, listRuns, listChronological, beginOperation, endOperation }
}

export type BackupRepository = ReturnType<typeof createBackupRepository>
