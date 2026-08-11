import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_MIGRATIONS } from '../server/persistence/core/migrations/manifest.ts'

const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const SQL_FILE_PATTERN = /\.sql$/u

function assertManifestShape(manifest) {
  const identifiers = new Set()
  const files = new Set()
  let previousIdentifier = null

  for (const migration of manifest) {
    if (!migration || typeof migration !== 'object') {
      throw new Error('Migration manifest entries must be objects.')
    }

    const { id, file, sha256 } = migration
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Every migration must have a non-empty identifier.')
    }
    if (identifiers.has(id)) {
      throw new Error(`Migration manifest contains duplicate identifier ${id}.`)
    }
    if (previousIdentifier !== null && id.localeCompare(previousIdentifier) <= 0) {
      throw new Error('Migration identifiers must be in strictly ascending order.')
    }
    if (typeof file !== 'string' || !SQL_FILE_PATTERN.test(file)) {
      throw new Error(`Migration ${id} must reference a SQL file.`)
    }
    if (file.includes('/') || file.includes('\\') || file === '.' || file === '..') {
      throw new Error(`Migration ${id} references an invalid file path.`)
    }
    if (files.has(file)) {
      throw new Error(`Migration manifest contains duplicate file ${file}.`)
    }
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
      throw new Error(`Migration ${id} must have a lowercase SHA-256 checksum.`)
    }

    identifiers.add(id)
    files.add(file)
    previousIdentifier = id
  }

  return files
}

export async function verifyMigrationManifest({ migrationsDir, manifest }) {
  if (!Array.isArray(manifest)) {
    throw new Error('Migration manifest must be an array.')
  }

  const trackedFiles = assertManifestShape(manifest)
  const directoryEntries = await readdir(migrationsDir, { withFileTypes: true })
  const sqlFiles = directoryEntries
    .filter((entry) => entry.isFile() && SQL_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  const untrackedFiles = sqlFiles.filter((file) => !trackedFiles.has(file))
  if (untrackedFiles.length > 0) {
    throw new Error(`Migration directory contains untracked SQL files: ${untrackedFiles.join(', ')}.`)
  }

  for (const migration of manifest) {
    let sql
    try {
      sql = await readFile(resolve(migrationsDir, migration.file))
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        throw new Error(`Migration ${migration.id} is missing file ${migration.file}.`, { cause: error })
      }
      throw error
    }

    const actualChecksum = createHash('sha256').update(sql).digest('hex')
    if (actualChecksum !== migration.sha256) {
      throw new Error(`Migration ${migration.id} checksum does not match the committed manifest.`)
    }
  }

  return {
    count: manifest.length,
    latest: manifest.at(-1)?.id ?? null,
  }
}

async function main() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const migrationsDir = resolve(scriptDirectory, '../server/persistence/core/migrations/generated')
  const result = await verifyMigrationManifest({
    migrationsDir,
    manifest: CORE_MIGRATIONS,
  })

  console.log(`Verified ${result.count} core database migration(s). Latest: ${result.latest ?? 'none'}.`)
}

if (import.meta.main) {
  await main()
}
