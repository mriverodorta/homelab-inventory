import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { createProjectRepository } from '../repositories/project-repository.ts'
import { createInventoryRepository } from '../repositories/inventory-repository.ts'
import { createRepositoryContext } from '../repositories/repository-context.ts'
import { schema29ProductionShapeFixture } from '../../fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../../legacy/identity-plan.ts'
import { importLegacyCore } from '../../migration/core-importer.ts'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'
import { createInventoryScopeService } from './inventory-scope-service.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-scope-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  const context = createRepositoryContext(handle.database, () => Date.parse('2026-08-12T03:00:00.000Z'))
  return { handle, context, service: createInventoryScopeService(context) }
}

describe('inventory scope service', () => {
  test('requires explicit memberships and one project before binding a global item', async () => {
    const { handle, context, service } = await fixture()
    try {
      const project = createProjectRepository(context).create({ name: 'Downsize plan' })
      const inventory = createInventoryRepository(context)
      const cpuId = service.resolve('cpu', 3)
      expect(service.setScope(cpuId, { scope: 'global' })).toMatchObject({
        scope: 'global',
        ownerProjectId: null,
      })
      expect(inventory.listForProject(project.project.id).some((item) => item.legacyType === 'cpu' && item.legacyId === 3)).toBeFalse()
      expect(service.listAvailableGlobal(project.project.id).some((item) => item.type === 'cpu' && item.id === 3)).toBeTrue()
      expect(service.memberships(cpuId)).toEqual([1])
      service.addGlobalMembership(cpuId, project.project.id)
      expect(inventory.listForProject(project.project.id).some((item) => item.legacyType === 'cpu' && item.legacyId === 3)).toBeTrue()
      expect(service.listAvailableGlobal(project.project.id).some((item) => item.type === 'cpu' && item.id === 3)).toBeFalse()
      expect(service.memberships(cpuId)).toEqual([1, project.project.id])
      expect(() => service.setScope(cpuId, { scope: 'project', projectId: 1 })).toThrow(/exactly one/iu)
      service.removeGlobalMembership(cpuId, project.project.id)
      expect(service.setScope(cpuId, { scope: 'project', projectId: 1 })).toMatchObject({
        scope: 'project',
        ownerProjectId: 1,
      })
      expect(service.setScope(cpuId, { scope: 'global' })).toMatchObject({
        scope: 'global',
        ownerProjectId: null,
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('blocks global membership when a project opts out and protects topology references', async () => {
    const { handle, context, service } = await fixture()
    try {
      const project = createProjectRepository(context).create({
        name: 'Private inventory',
        includesGlobalInventory: false,
      })
      const serverId = service.resolve('server', 7)
      service.setScope(serverId, { scope: 'global' })
      expect(() => service.addGlobalMembership(serverId, project.project.id)).toThrow(/does not allow/iu)
      expect(() => service.removeGlobalMembership(serverId, 1)).toThrow(/topology dependencies/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
