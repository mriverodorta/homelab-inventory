import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeManagedDatabase, openManagedDatabase } from './database.ts'
import { applyCommittedMigrations } from './migrator.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

function migration(id: string, sql: string, verify?: () => void) {
  return {
    id,
    sql,
    sha256: createHash('sha256').update(sql).digest('hex'),
    verify,
  }
}

async function createHandle() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-migrator-'))
  temporaryDirectories.push(root)
  return openManagedDatabase({
    filePath: join(root, 'databases', 'core.sqlite'),
    schemaName: 'core',
  })
}

describe('committed SQLite migrations', () => {
  test('applies migrations in order and remains idempotent after restart', async () => {
    const handle = await createHandle()
    const migrations = [
      migration('0001_first', 'CREATE TABLE first_record (id INTEGER PRIMARY KEY) STRICT;'),
      migration('0002_second', 'CREATE TABLE second_record (id INTEGER PRIMARY KEY) STRICT;'),
    ]

    try {
      await expect(applyCommittedMigrations(handle, migrations, {
        applicationVersion: 'unreleased',
      })).resolves.toEqual({ applied: 2, currentVersion: 2 })

      await expect(applyCommittedMigrations(handle, migrations, {
        applicationVersion: 'unreleased',
      })).resolves.toEqual({ applied: 0, currentVersion: 2 })

      expect(handle.database.query('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({
        count: 2,
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rolls back schema changes when migration verification fails', async () => {
    const handle = await createHandle()
    const invalidMigration = migration(
      '0001_invalid',
      'CREATE TABLE should_rollback (id INTEGER PRIMARY KEY) STRICT;',
      () => {
        throw new Error('migration verification failed')
      },
    )

    try {
      await expect(applyCommittedMigrations(handle, [invalidMigration])).rejects.toThrow(/verification failed/iu)
      expect(handle.database.query(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'should_rollback'",
      ).get()).toBeNull()
      expect(handle.database.query('PRAGMA user_version').get()).toEqual({ user_version: 0 })
      expect(handle.database.query('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({
        count: 0,
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rebuilds referenced tables atomically and restores foreign-key enforcement', async () => {
    const handle = await createHandle()
    const migrations = [
      migration('0001_parent', `
        CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
        CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id)) STRICT;
        INSERT INTO parent (id) VALUES (1);
        INSERT INTO child (id, parent_id) VALUES (1, 1);
      `),
      migration('0002_rebuild', `-- homelab:transactional-table-rebuild
        ALTER TABLE parent RENAME TO previous_parent;
        CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT NOT NULL DEFAULT 'preserved') STRICT;
        INSERT INTO parent (id) SELECT id FROM previous_parent;
        DROP TABLE previous_parent;
      `),
    ]

    try {
      await expect(applyCommittedMigrations(handle, migrations)).resolves.toEqual({
        applied: 2,
        currentVersion: 2,
      })
      expect(handle.database.query('SELECT parent_id FROM child').get()).toEqual({ parent_id: 1 })
      expect(handle.database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
      expect(handle.database.query('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rolls back rebuilt tables with invalid relationships and restores foreign keys', async () => {
    const handle = await createHandle()
    const migrations = [
      migration('0001_parent', `
        CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
        CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id)) STRICT;
        INSERT INTO parent (id) VALUES (1);
        INSERT INTO child (id, parent_id) VALUES (1, 1);
      `),
      migration('0002_invalid_rebuild', `-- homelab:transactional-table-rebuild
        ALTER TABLE parent RENAME TO previous_parent;
        CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
        DROP TABLE previous_parent;
      `),
    ]

    try {
      await expect(applyCommittedMigrations(handle, migrations)).rejects.toThrow(/foreign-key violation/iu)
      expect(handle.database.query('SELECT id FROM parent').get()).toEqual({ id: 1 })
      expect(handle.database.query('SELECT parent_id FROM child').get()).toEqual({ parent_id: 1 })
      expect(handle.database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
      expect(handle.database.query('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects SQL whose checksum differs from the committed checksum', async () => {
    const handle = await createHandle()
    const invalidMigration = {
      id: '0001_invalid_checksum',
      sql: 'SELECT 1;',
      sha256: '0'.repeat(64),
    }

    try {
      await expect(applyCommittedMigrations(handle, [invalidMigration])).rejects.toThrow(/checksum/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects a changed checksum for an already recorded migration', async () => {
    const handle = await createHandle()
    const original = migration('0001_recorded', 'CREATE TABLE recorded (id INTEGER PRIMARY KEY) STRICT;')
    const changed = migration('0001_recorded', 'CREATE TABLE changed (id INTEGER PRIMARY KEY) STRICT;')

    try {
      await applyCommittedMigrations(handle, [original])
      await expect(applyCommittedMigrations(handle, [changed])).rejects.toThrow(/recorded checksum/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects migration ledger rows that do not match the schema prefix', async () => {
    const handle = await createHandle()
    const committed = migration('0001_recorded', 'CREATE TABLE recorded (id INTEGER PRIMARY KEY) STRICT;')

    try {
      await applyCommittedMigrations(handle, [committed])
      handle.database.query(`
        UPDATE schema_migrations
        SET migration_id = '0001_unexpected'
        WHERE migration_id = '0001_recorded'
      `).run()

      await expect(applyCommittedMigrations(handle, [committed])).rejects.toThrow(/ledger.*does not match/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
