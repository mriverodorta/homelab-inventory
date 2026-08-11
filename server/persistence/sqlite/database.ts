import { Database } from 'bun:sqlite'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  assertDatabaseIntegrity,
  databaseQuickCheck,
  enforcePrivatePath,
} from './integrity.ts'

export type ManagedSchemaName = 'core' | 'telemetry' | 'catalog'

export type ManagedDatabase = {
  readonly database: Database
  readonly filePath: string
  readonly schemaName: ManagedSchemaName
  readonly: boolean
  closed: boolean
  close(): void
  [Symbol.dispose](): void
}

export type OpenManagedDatabaseOptions = {
  filePath: string
  schemaName: ManagedSchemaName
  readonly?: boolean
  maximumSchemaVersion?: number
}

type NumberPragma = Record<string, number>
type StringPragma = Record<string, string>

function numberPragma(database: Database, sql: string) {
  const row = database.query(sql).get() as NumberPragma | null
  return Number(Object.values(row ?? {})[0] ?? 0)
}

function stringPragma(database: Database, sql: string) {
  const row = database.query(sql).get() as StringPragma | null
  return String(Object.values(row ?? {})[0] ?? '')
}

function validateMaximumSchemaVersion(database: Database, maximumSchemaVersion?: number) {
  if (maximumSchemaVersion === undefined) return
  if (!Number.isSafeInteger(maximumSchemaVersion) || maximumSchemaVersion < 0) {
    throw new Error('Maximum SQLite schema version must be a non-negative safe integer.')
  }

  const schemaVersion = numberPragma(database, 'PRAGMA user_version')
  if (schemaVersion > maximumSchemaVersion) {
    throw new Error(
      `SQLite database uses newer schema version ${schemaVersion}; this application supports up to ${maximumSchemaVersion}.`,
    )
  }
}

export async function openManagedDatabase({
  filePath,
  schemaName,
  readonly = false,
  maximumSchemaVersion,
}: OpenManagedDatabaseOptions): Promise<ManagedDatabase> {
  if (!filePath) throw new Error('SQLite database path is required.')
  if (!['core', 'telemetry', 'catalog'].includes(schemaName)) {
    throw new Error(`Unsupported managed SQLite schema ${String(schemaName)}.`)
  }

  const resolvedPath = resolve(filePath)
  const databaseDirectory = dirname(resolvedPath)
  await mkdir(databaseDirectory, { recursive: true, mode: 0o700 })
  await enforcePrivatePath(databaseDirectory, 0o700)

  let database: Database | null = null
  try {
    database = new Database(resolvedPath, {
      create: !readonly,
      readonly,
      strict: true,
    })

    database.exec('PRAGMA busy_timeout = 5000;')
    database.exec('PRAGMA foreign_keys = ON;')
    if (!readonly) {
      database.exec('PRAGMA auto_vacuum = INCREMENTAL;')
      database.exec('PRAGMA journal_mode = WAL;')
      database.exec('PRAGMA synchronous = NORMAL;')
      database.exec('PRAGMA wal_autocheckpoint = 1000;')
      await enforcePrivatePath(resolvedPath, 0o600)
    }

    assertDatabaseIntegrity(database)
    validateMaximumSchemaVersion(database, maximumSchemaVersion)

    const handle: ManagedDatabase = {
      database,
      filePath: resolvedPath,
      schemaName,
      readonly,
      closed: false,
      close() {
        closeManagedDatabase(handle)
      },
      [Symbol.dispose]() {
        closeManagedDatabase(handle)
      },
    }

    return handle
  } catch (error) {
    database?.close(false)
    throw new Error(
      `Unable to initialize ${schemaName} SQLite database: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export function databaseStatus(handle: ManagedDatabase) {
  if (handle.closed) throw new Error(`${handle.schemaName} SQLite database is closed.`)

  return {
    schemaName: handle.schemaName,
    schemaVersion: numberPragma(handle.database, 'PRAGMA user_version'),
    journalMode: stringPragma(handle.database, 'PRAGMA journal_mode').toLowerCase(),
    foreignKeys: numberPragma(handle.database, 'PRAGMA foreign_keys') === 1,
    busyTimeoutMs: numberPragma(handle.database, 'PRAGMA busy_timeout'),
    autoVacuum: numberPragma(handle.database, 'PRAGMA auto_vacuum'),
    integrity: databaseQuickCheck(handle.database),
  }
}

export function closeManagedDatabase(handle: ManagedDatabase | null | undefined) {
  if (!handle || handle.closed) return

  if (!handle.readonly) {
    handle.database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  }
  handle.database.close(false)
  handle.closed = true
}
