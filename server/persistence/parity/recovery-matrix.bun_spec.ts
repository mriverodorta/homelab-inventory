import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { recoverInterruptedSqliteRestore } from '../../backup/sqlite-restore-staging.ts'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { closeManagedDatabase, openManagedDatabase } from '../sqlite/database.ts'
import { applyCommittedMigrations } from '../sqlite/migrator.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createCore(filePath: string, marker: string) {
  const handle = await openManagedDatabase({ filePath, schemaName: 'core' })
  const migrationsDir = resolve(import.meta.dir, '../core/migrations/generated')
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  }))))
  handle.database.query('INSERT INTO application_metadata (key, value_json, updated_at_ms) VALUES (?, ?, ?)')
    .run('recovery-fixture', JSON.stringify(marker), 1)
  closeManagedDatabase(handle)
}

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'hli-sqlite-recovery-'))
  roots.push(dataDir)
  const directory = join(dataDir, 'databases')
  await mkdir(directory, { recursive: true })
  const files = {
    active: 'homelab-inventory.sqlite',
    staging: '.core-restore-test.sqlite',
    rollback: 'homelab-inventory.sqlite.restore-rollback',
  }
  const paths = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, join(directory, file)])) as Record<keyof typeof files, string>
  const journal = async (stage: 'prepared' | 'active-moved' | 'staging-active') => writeFile(
    join(directory, '.core-restore-activation.json'),
    `${JSON.stringify({ version: 1, stage, activeFile: files.active, stagingFile: files.staging, rollbackFile: files.rollback })}\n`,
    { mode: 0o600 },
  )
  return { dataDir, directory, paths, journal }
}

function marker(filePath: string) {
  const database = new Database(filePath, { create: false, strict: true })
  try {
    return JSON.parse(database.query("SELECT value_json FROM application_metadata WHERE key = 'recovery-fixture'").get().value_json)
  } finally {
    database.close(false)
  }
}

describe('SQLite durable recovery matrix', () => {
  test('keeps the active database when interruption occurs before activation', async () => {
    const current = await fixture()
    await createCore(current.paths.active, 'active')
    await createCore(current.paths.staging, 'staged')
    await current.journal('prepared')

    expect(await recoverInterruptedSqliteRestore(current.dataDir)).toEqual({ recovered: true, action: 'kept-active' })
    expect(marker(current.paths.active)).toBe('active')
    await expect(stat(current.paths.staging)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('completes a validated staged activation after the active file was moved', async () => {
    const current = await fixture()
    await createCore(current.paths.rollback, 'rollback')
    await createCore(current.paths.staging, 'staged')
    await current.journal('active-moved')

    expect(await recoverInterruptedSqliteRestore(current.dataDir)).toEqual({ recovered: true, action: 'completed-activation' })
    expect((await stat(current.paths.active)).isFile()).toBe(true)
    expect(marker(current.paths.active)).toBe('staged')
    await expect(stat(current.paths.rollback)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('keeps the new active database after activation and removes rollback residue', async () => {
    const current = await fixture()
    await createCore(current.paths.active, 'staged')
    await createCore(current.paths.rollback, 'rollback')
    await current.journal('staging-active')

    expect(await recoverInterruptedSqliteRestore(current.dataDir)).toEqual({ recovered: true, action: 'completed-activation' })
    expect(marker(current.paths.active)).toBe('staged')
    await expect(stat(current.paths.rollback)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('restores the rollback database when the activated file is corrupt', async () => {
    const current = await fixture()
    await writeFile(current.paths.active, 'corrupt')
    await createCore(current.paths.rollback, 'rollback')
    await current.journal('staging-active')

    expect(await recoverInterruptedSqliteRestore(current.dataDir)).toEqual({ recovered: true, action: 'restored-rollback' })
    expect(marker(current.paths.active)).toBe('rollback')
  })

  test('refuses recovery when no valid database remains', async () => {
    const current = await fixture()
    await Promise.all([
      writeFile(current.paths.active, 'corrupt-active'),
      writeFile(current.paths.rollback, 'corrupt-rollback'),
    ])
    await current.journal('staging-active')
    await expect(recoverInterruptedSqliteRestore(current.dataDir)).rejects.toThrow(/no valid active or rollback database/iu)
  })

  test('does nothing when no durable recovery journal exists', async () => {
    const current = await fixture()
    expect(await recoverInterruptedSqliteRestore(current.dataDir)).toEqual({ recovered: false })
  })
})
