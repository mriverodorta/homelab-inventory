import fs from 'node:fs/promises'
import path from 'node:path'
import { migrateTelemetrySchema, TELEMETRY_SCHEMA_VERSION } from './schema.mjs'

const sqliteModule = ['bun', 'sqlite'].join(':')
const { Database } = await import(sqliteModule)

export const TELEMETRY_DATABASE_RELATIVE_PATH = path.join('telemetry', 'telemetry.sqlite')

function assertDatabaseIntegrity(database) {
  const result = database.query('PRAGMA quick_check').get()
  if (result?.quick_check !== 'ok') {
    throw new Error(`Telemetry database integrity check failed: ${String(result?.quick_check ?? 'unknown')}`)
  }
}

export async function openTelemetryDatabase({ dataDir, filePath } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new Error('Telemetry data directory is required.')
  const resolvedPath = filePath ?? path.join(dataDir, TELEMETRY_DATABASE_RELATIVE_PATH)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true, mode: 0o700 })

  let database
  try {
    database = new Database(resolvedPath, { create: true, strict: true })
    database.exec('PRAGMA busy_timeout = 5000;')
    assertDatabaseIntegrity(database)
    database.exec('PRAGMA foreign_keys = ON;')
    database.exec('PRAGMA journal_mode = WAL;')
    database.exec('PRAGMA synchronous = NORMAL;')
    database.exec('PRAGMA wal_autocheckpoint = 1000;')
    migrateTelemetrySchema(database)
    await fs.chmod(resolvedPath, 0o600)
    return database
  } catch (error) {
    database?.close(false)
    throw new Error(`Unable to initialize telemetry database: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}

export function telemetryDatabaseStatus(database) {
  return {
    schemaVersion: Number(database.query('PRAGMA user_version').get().user_version),
    journalMode: String(database.query('PRAGMA journal_mode').get().journal_mode).toLowerCase(),
    expectedSchemaVersion: TELEMETRY_SCHEMA_VERSION,
  }
}

export function closeTelemetryDatabase(database) {
  if (!database) return
  database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  database.close(false)
}
