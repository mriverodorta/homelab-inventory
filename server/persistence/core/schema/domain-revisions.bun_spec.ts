import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function migrations() {
  const directory = resolve(import.meta.dir, '../migrations/generated')
  return Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(directory, migration.file), 'utf8'),
  })))
}

describe('domain persistence revisions', () => {
  test('preserves topology revision while initializing independent domain revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-domain-revisions-'))
    temporaryDirectories.push(root)
    const handle = await openManagedDatabase({
      filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
      schemaName: 'core',
    })
    const committed = await migrations()
    const domainRevisionIndex = CORE_MIGRATIONS.findIndex((migration) => migration.id === '0028_domain_persistence_revisions')

    try {
      await applyCommittedMigrations(handle, committed.slice(0, domainRevisionIndex))
      handle.database.query('UPDATE projects SET revision = 17 WHERE id = 1').run()
      const item = handle.database.query(`
        INSERT INTO inventory_items (
          type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
        ) VALUES (
          (SELECT id FROM inventory_item_types WHERE key = 'server'),
          'global', NULL, 'Migration host', 1, 10, 10
        ) RETURNING id
      `).get() as { id: number }

      await expect(applyCommittedMigrations(handle, committed)).resolves.toEqual({
        applied: committed.length - domainRevisionIndex,
        currentVersion: committed.length,
      })
      expect(handle.database.query(
        'SELECT revision, workbook_revision FROM projects WHERE id = 1',
      ).get()).toEqual({ revision: 17, workbook_revision: 17 })
      expect(handle.database.query(
        'SELECT revision FROM project_compatibility_policies WHERE project_id = 1',
      ).get()).toEqual({ revision: 1 })
      expect(handle.database.query(
        'SELECT revision, updated_at_ms FROM inventory_item_metadata_revisions WHERE item_id = ?',
      ).get(item.id)).toEqual({ revision: 1, updated_at_ms: 10 })
      await expect(applyCommittedMigrations(handle, committed)).resolves.toEqual({
        applied: 0,
        currentVersion: committed.length,
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects non-positive domain revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-domain-revision-checks-'))
    temporaryDirectories.push(root)
    const handle = await openManagedDatabase({
      filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
      schemaName: 'core',
    })

    try {
      await applyCommittedMigrations(handle, await migrations())
      expect(() => handle.database.query(
        'UPDATE projects SET workbook_revision = 0 WHERE id = 1',
      ).run()).toThrow()
      expect(() => handle.database.query(
        'UPDATE project_compatibility_policies SET revision = 0 WHERE project_id = 1',
      ).run()).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
