import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { createRepositoryContext } from '../persistence/core/repositories/repository-context.ts'
import { closeManagedDatabase, openManagedDatabase } from '../persistence/sqlite/database.ts'
import { applyCommittedMigrations } from '../persistence/sqlite/migrator.ts'
import { InventoryMetadataFilterService } from './filter-service.mjs'
import { createInventoryMetadataRepository } from './repository.mjs'

const roots = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'inventory-metadata-filter-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  const directory = resolve(import.meta.dir, '../persistence/core/migrations/generated')
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id, sha256: migration.sha256, sql: await readFile(join(directory, migration.file), 'utf8'),
  }))))
  const repository = createInventoryMetadataRepository(createRepositoryContext(handle.database, () => 1_800_000_000_000))
  return { handle, repository, service: new InventoryMetadataFilterService(handle.database) }
}

function item(database, type, legacyId, name) {
  const created = database.query(`
    INSERT INTO inventory_items (type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms)
    VALUES ((SELECT id FROM inventory_item_types WHERE key = ?), 'project', 1, ?, 1, 1, 1) RETURNING id
  `).get(type, name)
  database.query(`INSERT INTO inventory_identity_aliases (item_id, legacy_type_key, legacy_id, created_at_ms) VALUES (?, ?, ?, 1)`).run(created.id, type, legacyId)
  return created
}

describe('inventory metadata filter service', () => {
  test('projects compact metadata and applies OR inside filters with AND across filters', async () => {
    const { handle, repository, service } = await harness()
    try {
      const alpha = item(handle.database, 'server', 1, 'Alpha')
      const beta = item(handle.database, 'server', 2, 'Beta')
      const owner = repository.createDefinition({ name: 'Owner', fieldType: 'shortText', applicableItemTypes: ['server'] })
      const lifecycle = repository.createDefinition({
        name: 'Lifecycle', fieldType: 'multiSelect', applicableItemTypes: ['server'],
        options: [{ label: 'Active', colorToken: 'green' }, { label: 'Standby', colorToken: 'amber' }],
      })
      const production = repository.createTag({ name: 'Production', colorToken: 'green' })
      const laboratory = repository.createTag({ name: 'Laboratory', colorToken: 'blue' })
      repository.replaceItemMetadata(alpha.id, {
        values: [{ definitionId: owner.id, value: 'Infrastructure' }, { definitionId: lifecycle.id, value: [lifecycle.options[0].id] }],
        tagIds: [production.id],
      })
      repository.replaceItemMetadata(beta.id, {
        values: [{ definitionId: owner.id, value: 'Lab' }, { definitionId: lifecycle.id, value: [lifecycle.options[1].id] }],
        tagIds: [laboratory.id],
      })

      const projection = service.projectProjection(1, {
        scope: 'systems', includeSearch: true, definitionIds: [owner.id],
        filters: [
          { operator: 'tags-any', tagIds: [production.id, laboratory.id] },
          { operator: 'options', definitionId: lifecycle.id, optionIds: [lifecycle.options[0].id] },
          { operator: 'contains', definitionId: owner.id, text: 'infra' },
        ],
      })
      expect(projection.matchingItemIds).toEqual([alpha.id])
      expect(projection.rows).toHaveLength(2)
      expect(projection.rows[0]).toMatchObject({
        itemType: 'server', legacyId: 1,
        tags: [{ id: production.id, name: 'Production' }],
        values: { [owner.id]: { value: 'Infrastructure', display: 'Infrastructure' } },
      })
      expect(projection.rows[0].searchText).toContain('production infrastructure active')
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('supports set, unset, boolean, range, and no-tags semantics', async () => {
    const { handle, repository, service } = await harness()
    try {
      const alpha = item(handle.database, 'nas', 1, 'Alpha')
      const beta = item(handle.database, 'nas', 2, 'Beta')
      const watts = repository.createDefinition({ name: 'Watts', fieldType: 'number', applicableItemTypes: ['nas'] })
      const critical = repository.createDefinition({ name: 'Critical', fieldType: 'boolean', applicableItemTypes: ['nas'] })
      repository.replaceItemMetadata(alpha.id, { values: [{ definitionId: watts.id, value: 42 }, { definitionId: critical.id, value: true }], tagIds: [] })
      repository.replaceItemMetadata(beta.id, { values: [], tagIds: [] })
      expect(service.projectProjection(1, { filters: [{ operator: 'range', definitionId: watts.id, minimum: 40, maximum: 50 }] }).matchingItemIds).toEqual([alpha.id])
      expect(service.projectProjection(1, { filters: [{ operator: 'yes', definitionId: critical.id }] }).matchingItemIds).toEqual([alpha.id])
      expect(service.projectProjection(1, { filters: [{ operator: 'unset', definitionId: watts.id }, { operator: 'no-tags' }] }).matchingItemIds).toEqual([beta.id])
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
