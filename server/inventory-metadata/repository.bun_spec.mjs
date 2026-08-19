import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { createRepositoryContext } from '../persistence/core/repositories/repository-context.ts'
import { closeManagedDatabase, openManagedDatabase } from '../persistence/sqlite/database.ts'
import { applyCommittedMigrations } from '../persistence/sqlite/migrator.ts'
import { InventoryMetadataError } from './contract.mjs'
import { createInventoryMetadataRepository } from './repository.mjs'

const temporaryDirectories = []
const now = Date.parse('2026-08-19T16:00:00.000Z')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-metadata-repository-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDir = resolve(import.meta.dir, '../persistence/core/migrations/generated')
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  }))))
  const context = createRepositoryContext(handle.database, () => now)
  return { handle, repository: createInventoryMetadataRepository(context) }
}

function insertItem(database, typeKey, name, scope = 'global') {
  return database.query(`
    INSERT INTO inventory_items (
      type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
    ) VALUES (
      (SELECT id FROM inventory_item_types WHERE key = ?),
      ?, CASE WHEN ? = 'project' THEN 1 ELSE NULL END, ?, 1, 1, 1
    ) RETURNING id
  `).get(typeKey, scope, scope, name)
}

const lifecycleDefinition = {
  name: 'Lifecycle',
  description: 'Hardware lifecycle',
  fieldType: 'singleSelect',
  applicableItemTypes: ['server', 'nas'],
  options: [
    { label: 'Active', colorToken: 'green' },
    { label: 'Retired', colorToken: 'gray' },
  ],
}

describe('inventory metadata repository', () => {
  test('creates, reads, updates, orders, archives, and restores definitions', async () => {
    const { handle, repository } = await harness()
    try {
      const created = repository.createDefinition(lifecycleDefinition)
      expect(created).toMatchObject({ id: 1, revision: 1, name: 'Lifecycle', applicableItemTypes: ['server', 'nas'] })
      expect(created.options.map((option) => option.id)).toEqual([1, 2])
      expect(repository.listCatalog()).toMatchObject({ revision: 1, definitions: [{ id: 1 }], tags: [] })

      const updated = repository.updateDefinition(created.id, created.revision, {
        ...lifecycleDefinition,
        description: 'Updated lifecycle',
        options: created.options.map(({ id, label, colorToken }) => ({ id, label, colorToken })),
      })
      expect(updated).toMatchObject({ revision: 2, description: 'Updated lifecycle' })
      expect(() => repository.updateDefinition(created.id, 1, lifecycleDefinition)).toThrow(/changed/iu)

      const archived = repository.archiveDefinition(created.id, updated.revision)
      expect(archived.archivedAt).toBe('2026-08-19T16:00:00.000Z')
      expect(repository.listCatalog().definitions).toHaveLength(0)
      expect(repository.listCatalog({ includeArchived: true }).definitions).toHaveLength(1)
      expect(repository.restoreDefinition(created.id, archived.revision)).toMatchObject({ revision: 4, archivedAt: null })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('replaces typed values and tags atomically with stable IDs', async () => {
    const { handle, repository } = await harness()
    try {
      const server = insertItem(handle.database, 'server', 'Server', 'project')
      const lifecycle = repository.createDefinition(lifecycleDefinition)
      const rackUnits = repository.createDefinition({
        name: 'Rack units',
        fieldType: 'number',
        applicableItemTypes: ['server'],
        unit: 'U',
        numberMinimum: 1,
        numberMaximum: 48,
        numberPrecision: 0,
      })
      const production = repository.createTag({ name: 'Production', colorToken: 'red' })
      expect(repository.replaceItemMetadata(server.id, {
        values: [
          { definitionId: lifecycle.id, value: lifecycle.options[0].id },
          { definitionId: rackUnits.id, value: 2 },
        ],
        tagIds: [production.id],
      })).toEqual({ itemId: server.id, affectedProjectIds: [1] })

      expect(repository.getItemMetadata(server.id)).toMatchObject({
        itemId: server.id,
        values: [
          { definitionId: lifecycle.id, optionIds: [lifecycle.options[0].id] },
          { definitionId: rackUnits.id, value: 2, optionIds: [] },
        ],
        tags: [{ id: production.id, name: 'Production' }],
      })

      expect(repository.replaceItemMetadata(server.id, { values: [], tagIds: [] })).toEqual({
        itemId: server.id,
        affectedProjectIds: [1],
      })
      expect(repository.getItemMetadata(server.id)).toMatchObject({ values: [], tags: [] })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('copies active custom values, option selections, and tags to a duplicate item', async () => {
    const { handle, repository } = await harness()
    try {
      const source = insertItem(handle.database, 'server', 'Source')
      const target = insertItem(handle.database, 'server', 'Target')
      const lifecycle = repository.createDefinition(lifecycleDefinition)
      const owner = repository.createDefinition({
        name: 'Owner', fieldType: 'shortText', applicableItemTypes: ['server'],
      })
      const production = repository.createTag({ name: 'Production', colorToken: 'red' })
      repository.replaceItemMetadata(source.id, {
        values: [
          { definitionId: lifecycle.id, value: lifecycle.options[1].id },
          { definitionId: owner.id, value: 'Infrastructure' },
        ],
        tagIds: [production.id],
      })

      expect(repository.copyItemMetadata(source.id, target.id)).toEqual({
        sourceItemId: source.id,
        targetItemId: target.id,
      })
      expect(repository.getItemMetadata(target.id)).toMatchObject({
        values: [
          { definitionId: lifecycle.id, optionIds: [lifecycle.options[1].id] },
          { definitionId: owner.id, value: 'Infrastructure' },
        ],
        tags: [{ id: production.id, name: 'Production' }],
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('reorders active definitions and tags without changing their IDs', async () => {
    const { handle, repository } = await harness()
    try {
      const first = repository.createDefinition({
        name: 'First', fieldType: 'shortText', applicableItemTypes: ['server'],
      })
      const second = repository.createDefinition({
        name: 'Second', fieldType: 'boolean', applicableItemTypes: ['server'],
      })
      const red = repository.createTag({ name: 'Red', colorToken: 'red' })
      const blue = repository.createTag({ name: 'Blue', colorToken: 'blue' })
      expect(repository.reorderDefinitions([second.id, first.id]).definitions.map(({ id }) => id)).toEqual([second.id, first.id])
      expect(repository.reorderTags([blue.id, red.id]).tags.map(({ id }) => id)).toEqual([blue.id, red.id])
      expect(() => repository.reorderDefinitions([first.id])).toThrow(/every active/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects inapplicable, cross-definition, and archived assignments', async () => {
    const { handle, repository } = await harness()
    try {
      const cpu = insertItem(handle.database, 'cpu', 'CPU')
      const server = insertItem(handle.database, 'server', 'Server')
      const lifecycle = repository.createDefinition(lifecycleDefinition)
      const location = repository.createDefinition({
        name: 'Location',
        fieldType: 'multiSelect',
        applicableItemTypes: ['server'],
        options: [{ label: 'Office', colorToken: 'blue' }],
      })
      expect(() => repository.replaceItemMetadata(cpu.id, {
        values: [{ definitionId: lifecycle.id, value: lifecycle.options[0].id }],
        tagIds: [],
      })).toThrow(/applicable/iu)
      expect(() => repository.replaceItemMetadata(server.id, {
        values: [{ definitionId: lifecycle.id, value: location.options[0].id }],
        tagIds: [],
      })).toThrow(/option/iu)
      const tag = repository.createTag({ name: 'Temporary', colorToken: 'amber' })
      repository.archiveTag(tag.id, tag.revision)
      expect(() => repository.replaceItemMetadata(server.id, { values: [], tagIds: [tag.id] })).toThrow(/tag/iu)
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('prevents changing a field type after use and reports destructive impact', async () => {
    const { handle, repository } = await harness()
    try {
      const server = insertItem(handle.database, 'server', 'Server')
      const lifecycle = repository.createDefinition(lifecycleDefinition)
      repository.replaceItemMetadata(server.id, {
        values: [{ definitionId: lifecycle.id, value: lifecycle.options[0].id }],
        tagIds: [],
      })
      expect(() => repository.updateDefinition(lifecycle.id, lifecycle.revision, {
        name: 'Lifecycle',
        fieldType: 'shortText',
        applicableItemTypes: ['server', 'nas'],
      })).toThrow(/type.*used/iu)
      expect(repository.definitionImpact(lifecycle.id)).toEqual({
        definitionId: lifecycle.id,
        itemCount: 1,
        optionSelectionCount: 1,
        savedViewCount: 0,
        affectedItemTypes: [{ type: 'server', itemCount: 1 }],
      })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('requires archive and exact-name confirmation before permanent cascade deletion', async () => {
    const { handle, repository } = await harness()
    try {
      const server = insertItem(handle.database, 'server', 'Server')
      const definition = repository.createDefinition({
        name: 'Owner note',
        fieldType: 'shortText',
        applicableItemTypes: ['server'],
      })
      const tag = repository.createTag({ name: 'Production', colorToken: 'red' })
      repository.replaceItemMetadata(server.id, {
        values: [{ definitionId: definition.id, value: 'Kai' }],
        tagIds: [tag.id],
      })
      expect(() => repository.deleteDefinitionPermanently(definition.id, 'Owner note')).toThrow(/archive/iu)
      const archivedDefinition = repository.archiveDefinition(definition.id, definition.revision)
      expect(() => repository.deleteDefinitionPermanently(definition.id, 'wrong')).toThrow(InventoryMetadataError)
      expect(repository.deleteDefinitionPermanently(definition.id, archivedDefinition.name)).toMatchObject({ itemCount: 1 })

      const archivedTag = repository.archiveTag(tag.id, tag.revision)
      expect(repository.tagImpact(tag.id)).toEqual({ tagId: tag.id, itemCount: 1, savedViewCount: 0 })
      expect(repository.deleteTagPermanently(tag.id, archivedTag.name)).toEqual({ tagId: tag.id, itemCount: 1, savedViewCount: 0 })
      expect(repository.getItemMetadata(server.id)).toMatchObject({ values: [], tags: [] })
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('prunes permanent deletions from saved views and advances their revisions', async () => {
    const { handle, repository } = await harness()
    try {
      const definition = repository.createDefinition({
        name: 'Owner note', fieldType: 'shortText', applicableItemTypes: ['server'],
      })
      const tag = repository.createTag({ name: 'Production', colorToken: 'red' })
      const view = handle.database.query(`
        INSERT INTO systems_saved_views (
          project_id, owner_scope, account_id, name, sort_key, sort_direction,
          density, is_default, revision, created_at_ms, updated_at_ms
        ) VALUES (1, 'open-installation', NULL, 'Metadata', 'name', 'ascending',
          'dense', 0, 1, 1, 1) RETURNING id
      `).get()
      const insertColumn = handle.database.query(`
        INSERT INTO systems_saved_view_columns (
          saved_view_id, column_key, definition_id, visible, display_order
        ) VALUES (?, ?, ?, ?, ?)
      `)
      insertColumn.run(view.id, 'type', null, 1, 0)
      insertColumn.run(view.id, 'name', null, 1, 1)
      insertColumn.run(view.id, `custom-field:${definition.id}`, definition.id, 1, 2)
      const definitionFilter = handle.database.query(`
        INSERT INTO systems_saved_view_metadata_filters (saved_view_id, definition_id, operator)
        VALUES (?, ?, 'set') RETURNING id
      `).get(view.id, definition.id)
      expect(definitionFilter.id).toBeGreaterThan(0)
      const tagFilter = handle.database.query(`
        INSERT INTO systems_saved_view_metadata_filters (saved_view_id, definition_id, operator)
        VALUES (?, NULL, 'tags-any') RETURNING id
      `).get(view.id)
      handle.database.query(`
        INSERT INTO systems_saved_view_metadata_filter_tags (filter_id, tag_id) VALUES (?, ?)
      `).run(tagFilter.id, tag.id)

      expect(repository.definitionImpact(definition.id).savedViewCount).toBe(1)
      expect(repository.tagImpact(tag.id).savedViewCount).toBe(1)
      const archivedDefinition = repository.archiveDefinition(definition.id, definition.revision)
      repository.deleteDefinitionPermanently(definition.id, archivedDefinition.name)
      expect(handle.database.query(`
        SELECT column_key, display_order FROM systems_saved_view_columns
        WHERE saved_view_id = ? ORDER BY display_order
      `).all(view.id)).toEqual([
        { column_key: 'type', display_order: 0 },
        { column_key: 'name', display_order: 1 },
      ])
      expect(handle.database.query(`
        SELECT revision FROM systems_saved_views WHERE id = ?
      `).get(view.id)).toEqual({ revision: 2 })

      const archivedTag = repository.archiveTag(tag.id, tag.revision)
      repository.deleteTagPermanently(tag.id, archivedTag.name)
      expect(handle.database.query(`
        SELECT COUNT(*) AS count FROM systems_saved_view_metadata_filters WHERE saved_view_id = ?
      `).get(view.id)).toEqual({ count: 0 })
      expect(handle.database.query(`
        SELECT revision FROM systems_saved_views WHERE id = ?
      `).get(view.id)).toEqual({ revision: 3 })
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
