import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import type { ManagedDatabase } from './database.ts'
import { assertDatabaseIntegrity } from './integrity.ts'

export type CommittedMigration = Readonly<{
  id: string
  sql: string
  sha256: string
  verify?: (database: Database) => void
}>

type ApplyMigrationOptions = Readonly<{
  applicationVersion?: string
}>

type AppliedMigration = {
  migration_id: string
  checksum: string
  verification_status: string
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

function schemaVersion(database: Database) {
  const row = database.query('PRAGMA user_version').get() as { user_version: number }
  return Number(row.user_version)
}

function assertMigrationSequence(migrations: readonly CommittedMigration[]) {
  const identifiers = new Set<string>()
  let previousIdentifier: string | null = null

  for (const migration of migrations) {
    if (!migration.id || identifiers.has(migration.id)) {
      throw new Error(`Migration sequence contains duplicate or empty identifier ${migration.id}.`)
    }
    if (previousIdentifier !== null && migration.id.localeCompare(previousIdentifier) <= 0) {
      throw new Error('Migration identifiers must be in strictly ascending order.')
    }
    if (!SHA256_PATTERN.test(migration.sha256)) {
      throw new Error(`Migration ${migration.id} has an invalid checksum.`)
    }

    const actualChecksum = createHash('sha256').update(migration.sql).digest('hex')
    if (actualChecksum !== migration.sha256) {
      throw new Error(`Migration ${migration.id} checksum does not match its SQL.`)
    }

    identifiers.add(migration.id)
    previousIdentifier = migration.id
  }
}

function createMigrationLedger(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_id TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      application_version TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      completed_at_ms INTEGER NOT NULL,
      verification_status TEXT NOT NULL CHECK (verification_status = 'verified')
    ) STRICT;
  `)
}

export async function applyCommittedMigrations(
  handle: ManagedDatabase,
  migrations: readonly CommittedMigration[],
  { applicationVersion = 'unreleased' }: ApplyMigrationOptions = {},
) {
  if (handle.closed) throw new Error(`${handle.schemaName} SQLite database is closed.`)
  if (handle.readonly) throw new Error(`Cannot migrate read-only ${handle.schemaName} SQLite database.`)
  assertMigrationSequence(migrations)

  const database = handle.database
  createMigrationLedger(database)
  const currentVersion = schemaVersion(database)
  if (currentVersion > migrations.length) {
    throw new Error(
      `SQLite database uses newer schema version ${currentVersion}; only ${migrations.length} migrations are available.`,
    )
  }

  const appliedRows = database.query(`
    SELECT migration_id, checksum, verification_status
    FROM schema_migrations
    ORDER BY id ASC
  `).all() as AppliedMigration[]

  if (appliedRows.length !== currentVersion) {
    throw new Error(
      `Migration ledger contains ${appliedRows.length} rows but schema version is ${currentVersion}.`,
    )
  }
  for (const [index, recorded] of appliedRows.entries()) {
    const committed = migrations[index]
    if (!committed || recorded.migration_id !== committed.id) {
      throw new Error(`Migration ledger does not match committed migration ${committed?.id ?? index + 1}.`)
    }
    if (recorded.checksum !== committed.sha256) {
      throw new Error(`Migration ${committed.id} recorded checksum differs from the committed checksum.`)
    }
    if (recorded.verification_status !== 'verified') {
      throw new Error(`Migration ${committed.id} is not recorded as verified.`)
    }
  }

  const appliedByIdentifier = new Map(appliedRows.map((row) => [row.migration_id, row]))

  let applied = 0
  for (const [index, migration] of migrations.entries()) {
    const recorded = appliedByIdentifier.get(migration.id)
    if (recorded) {
      if (recorded.checksum !== migration.sha256) {
        throw new Error(`Migration ${migration.id} recorded checksum differs from the committed checksum.`)
      }
      if (recorded.verification_status !== 'verified') {
        throw new Error(`Migration ${migration.id} is not recorded as verified.`)
      }
      continue
    }

    if (index < currentVersion) {
      throw new Error(`Schema version ${currentVersion} is missing migration ledger entry ${migration.id}.`)
    }

    const migrate = database.transaction(() => {
      const startedAtMs = Date.now()
      database.exec(migration.sql)
      migration.verify?.(database)
      assertDatabaseIntegrity(database)
      const completedAtMs = Date.now()
      database.query(`
        INSERT INTO schema_migrations (
          migration_id,
          checksum,
          application_version,
          started_at_ms,
          completed_at_ms,
          verification_status
        ) VALUES (?, ?, ?, ?, ?, 'verified')
      `).run(
        migration.id,
        migration.sha256,
        applicationVersion,
        startedAtMs,
        completedAtMs,
      )
      database.exec(`PRAGMA user_version = ${index + 1};`)
    })

    migrate.immediate()
    applied += 1
  }

  assertDatabaseIntegrity(database)
  return {
    applied,
    currentVersion: schemaVersion(database),
  }
}
