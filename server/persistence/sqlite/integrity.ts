import type { Database } from 'bun:sqlite'
import { chmod, stat } from 'node:fs/promises'

function currentProcessUserId() {
  return typeof process.getuid === 'function' ? process.getuid() : null
}

export async function enforcePrivatePath(path: string, mode: 0o600 | 0o700) {
  const pathStat = await stat(path)
  const processUserId = currentProcessUserId()

  if (processUserId !== null && pathStat.uid !== processUserId) {
    throw new Error(`SQLite path ${path} is owned by an unexpected user.`)
  }

  await chmod(path, mode)
  const hardenedStat = await stat(path)
  if ((hardenedStat.mode & 0o777) !== mode) {
    throw new Error(`SQLite path ${path} could not be restricted to mode ${mode.toString(8)}.`)
  }
}

export function databaseQuickCheck(database: Database) {
  const result = database.query('PRAGMA quick_check').get() as { quick_check?: unknown } | null
  return String(result?.quick_check ?? 'unknown')
}

export function foreignKeyViolations(database: Database) {
  return database.query('PRAGMA foreign_key_check').all() as Array<{
    table: string
    rowid: number | null
    parent: string
    fkid: number
  }>
}

export function assertDatabaseIntegrity(database: Database) {
  const integrity = databaseQuickCheck(database)
  if (integrity !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${integrity}.`)
  }
}
