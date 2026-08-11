import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyMigrationManifest } from './check-database-migrations.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function createMigrationFixture(sql = 'SELECT 1;\n') {
  const migrationsDir = await mkdtemp(join(tmpdir(), 'homelab-inventory-migrations-'))
  temporaryDirectories.push(migrationsDir)

  const file = '0001_sqlite_foundation.sql'
  await writeFile(join(migrationsDir, file), sql)

  return {
    migrationsDir,
    manifest: [{
      id: '0001_sqlite_foundation',
      file,
      sha256: createHash('sha256').update(sql).digest('hex'),
    }],
  }
}

describe('database migration manifest verifier', () => {
  test('accepts ordered migrations whose SHA-256 checksums match', async () => {
    const fixture = await createMigrationFixture()

    await expect(verifyMigrationManifest(fixture)).resolves.toEqual({
      count: 1,
      latest: '0001_sqlite_foundation',
    })
  })

  test('rejects modified historical SQL', async () => {
    const fixture = await createMigrationFixture()
    await writeFile(join(fixture.migrationsDir, fixture.manifest[0].file), 'SELECT 2;\n')

    await expect(verifyMigrationManifest(fixture)).rejects.toThrow(/checksum/iu)
  })

  test('rejects untracked SQL files', async () => {
    const fixture = await createMigrationFixture()
    await writeFile(join(fixture.migrationsDir, '0002_untracked.sql'), 'SELECT 2;\n')

    await expect(verifyMigrationManifest(fixture)).rejects.toThrow(/untracked/iu)
  })

  test('rejects duplicate and unordered migration identifiers', async () => {
    const fixture = await createMigrationFixture()

    await expect(verifyMigrationManifest({
      migrationsDir: fixture.migrationsDir,
      manifest: [fixture.manifest[0], fixture.manifest[0]],
    })).rejects.toThrow(/duplicate/iu)

    await expect(verifyMigrationManifest({
      migrationsDir: fixture.migrationsDir,
      manifest: [
        { ...fixture.manifest[0], id: '0002_second' },
        fixture.manifest[0],
      ],
    })).rejects.toThrow(/ascending/iu)
  })
})
