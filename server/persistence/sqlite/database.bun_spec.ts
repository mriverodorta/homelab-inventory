import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeManagedDatabase,
  databaseStatus,
  openManagedDatabase,
} from './database.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function createDatabasePath() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-sqlite-'))
  temporaryDirectories.push(root)
  return {
    directory: join(root, 'databases'),
    filePath: join(root, 'databases', 'core.sqlite'),
  }
}

describe('managed SQLite database', () => {
  test('opens a WAL database with required safety pragmas and permissions', async () => {
    const { directory, filePath } = await createDatabasePath()
    const handle = await openManagedDatabase({ filePath, schemaName: 'core' })

    try {
      expect(databaseStatus(handle)).toMatchObject({
        schemaName: 'core',
        schemaVersion: 0,
        journalMode: 'wal',
        foreignKeys: true,
        busyTimeoutMs: 5000,
        integrity: 'ok',
      })
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects a schema newer than this application supports', async () => {
    const { directory, filePath } = await createDatabasePath()
    await Bun.write(join(directory, '.keep'), '')
    const database = new Database(filePath, { create: true })
    database.exec('PRAGMA user_version = 3;')
    database.close(false)

    await expect(openManagedDatabase({
      filePath,
      schemaName: 'core',
      maximumSchemaVersion: 2,
    })).rejects.toThrow(/newer.*schema/iu)
  })

  test('closes idempotently', async () => {
    const { filePath } = await createDatabasePath()
    const handle = await openManagedDatabase({ filePath, schemaName: 'core' })

    expect(() => closeManagedDatabase(handle)).not.toThrow()
    expect(() => closeManagedDatabase(handle)).not.toThrow()
  })
})
