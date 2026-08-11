import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MemoryCacheStore } from '../../cache/memory-cache.ts'
import { schema29ProductionShapeFixture } from '../../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../../legacy/identity-plan.ts'
import { importLegacyCore } from '../../migration/core-importer.ts'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'
import { buildWorkspaceReadModel } from './workspace-read-model.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace read model', () => {
  test('uses revision-bearing keys and rebuilds after scoped invalidation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-read-model-'))
    roots.push(root)
    const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
    try {
      await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
        id: migration.id,
        sha256: migration.sha256,
        sql: await readFile(resolve(import.meta.dir, '../migrations/generated', migration.file), 'utf8'),
      }))))
      const snapshot = schema29ProductionShapeFixture()
      importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
      const cache = new MemoryCacheStore()

      const first = buildWorkspaceReadModel({ database: handle.database, cache, projectId: 1, workspaceId: 2 })
      const second = buildWorkspaceReadModel({ database: handle.database, cache, projectId: 1, workspaceId: 2 })
      expect(second).toEqual(first)
      expect(cache.diagnostics()).toMatchObject({ hits: 1, misses: 1, entries: 1 })

      handle.database.query('UPDATE projects SET revision = revision + 1 WHERE id = 1').run()
      const third = buildWorkspaceReadModel({ database: handle.database, cache, projectId: 1, workspaceId: 2 })
      expect(third.revision).toBe(first.revision + 1)
      expect(cache.diagnostics()).toMatchObject({ hits: 1, misses: 2, entries: 2 })

      expect(cache.invalidateTags(['project:1'])).toBe(2)
      expect(cache.diagnostics().entries).toBe(0)
    } finally {
      handle.close()
    }
  })
})
