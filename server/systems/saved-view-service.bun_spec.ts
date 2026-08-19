import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../persistence/fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../persistence/legacy/identity-plan.ts'
import { importLegacyCore } from '../persistence/migration/core-importer.ts'
import { openManagedDatabase } from '../persistence/sqlite/database.ts'
import { applyCommittedMigrations } from '../persistence/sqlite/migrator.ts'
import { SqliteHomelabInventoryStore } from '../persistence/sqlite-store.ts'
import { SYSTEMS_COLUMN_KEYS, SystemsSavedViewService, normalizeSystemsViewInput } from './saved-view-service.mjs'

const roots: string[] = []
const stores: SqliteHomelabInventoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-systems-views-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../persistence/core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  const store = new SqliteHomelabInventoryStore({ core: handle })
  stores.push(store)
  return store
}

function input(name = 'My servers') {
  return {
    name,
    types: ['server'],
    registrations: ['registered'],
    registryStates: ['linked'],
    sortKey: 'name',
    sortDirection: 'ascending',
    density: 'dense',
    columns: SYSTEMS_COLUMN_KEYS.map((key, order) => ({
      key,
      order,
      visible: !['operatingSystem', 'uptime', 'lanIp'].includes(key),
    })),
    query: 'must not persist',
    widths: { name: 400 },
  }
}

function seedMetadata(store: SqliteHomelabInventoryStore) {
  const database = store.core.database
  const now = 1_800_000_000_000
  const definition = database.query(`
    INSERT INTO custom_field_definitions (
      name, normalized_name, description, field_type, unit,
      number_minimum, number_maximum, number_precision,
      display_order, revision, created_at_ms, updated_at_ms
    ) VALUES ('Support tier', 'support tier', NULL, 'singleSelect', NULL,
      NULL, NULL, NULL, 0, 1, ?, ?) RETURNING id
  `).get(now, now) as { id: number }
  const serverType = database.query("SELECT id FROM inventory_item_types WHERE key = 'server'").get() as { id: number }
  database.query(`
    INSERT INTO custom_field_applicability (definition_id, item_type_id, created_at_ms)
    VALUES (?, ?, ?)
  `).run(definition.id, serverType.id, now)
  const option = database.query(`
    INSERT INTO custom_field_options (
      definition_id, label, normalized_label, color_token, display_order,
      revision, created_at_ms, updated_at_ms
    ) VALUES (?, 'Critical', 'critical', 'red', 0, 1, ?, ?) RETURNING id
  `).get(definition.id, now, now) as { id: number }
  const tag = database.query(`
    INSERT INTO inventory_tags (
      name, normalized_name, color_token, display_order,
      revision, created_at_ms, updated_at_ms
    ) VALUES ('Production', 'production', 'green', 0, 1, ?, ?) RETURNING id
  `).get(now, now) as { id: number }
  return { definitionId: definition.id, optionId: option.id, tagId: tag.id }
}

describe('Systems saved view service', () => {
  test('normalizes synchronized configuration without search or widths', () => {
    expect(normalizeSystemsViewInput(input())).toEqual({
      name: 'My servers',
      types: ['server'],
      registrations: ['registered'],
      registryStates: ['linked'],
      sortKey: 'name',
      sortDirection: 'ascending',
      density: 'dense',
      columns: input().columns,
      metadataFilters: [],
    })
    expect(() => normalizeSystemsViewInput({
      ...input(),
      columns: input().columns.map((column) => column.key === 'type' ? { ...column, visible: false } : column),
    })).toThrow('Type and Name must remain visible and first.')
  })

  test('isolates account and open-mode views and transfers open views to an administrator', async () => {
    const store = await fixtureStore()
    const service = new SystemsSavedViewService({ now: () => 1_800_000_000_000 })
    const open = service.create(store, { projectId: 1, input: input('Fleet') })
    expect(service.list(store, { projectId: 1 })).toHaveLength(1)
    expect(service.list(store, { projectId: 1, accountId: 1 })).toHaveLength(0)

    expect(service.transferOpenViewsToAccount(store, 1)).toEqual({ transferred: 1 })
    expect(service.list(store, { projectId: 1 })).toHaveLength(0)
    expect(service.list(store, { projectId: 1, accountId: 1 })[0]).toMatchObject({ id: open.id, name: 'Fleet', revision: 2 })
  })

  test('enforces optimistic revisions, unique names, and one default', async () => {
    const store = await fixtureStore()
    const service = new SystemsSavedViewService({ now: () => 1_800_000_000_000 })
    const first = service.create(store, { projectId: 1, input: input('Fleet') })
    const second = service.create(store, { projectId: 1, input: input('Online') })
    expect(() => service.create(store, { projectId: 1, input: input('fleet') })).toThrow('already exists')
    const defaultView = service.setDefault(store, { projectId: 1, viewId: first.id, expectedRevision: first.revision })
    expect(defaultView).toMatchObject({ isDefault: true, revision: 2 })
    const replacement = service.setDefault(store, { projectId: 1, viewId: second.id, expectedRevision: second.revision })
    expect(replacement.isDefault).toBe(true)
    expect(service.list(store, { projectId: 1 }).filter((view) => view.isDefault)).toHaveLength(1)
    expect(() => service.replace(store, {
      projectId: 1,
      viewId: first.id,
      expectedRevision: 1,
      input: input('Changed'),
    })).toThrow('changed in another session')
  })

  test('persists metadata filters and dynamic columns by numeric IDs', async () => {
    const store = await fixtureStore()
    const metadata = seedMetadata(store)
    const service = new SystemsSavedViewService({ now: () => 1_800_000_000_000 })
    const configuration = input('Production systems')
    const customInput = {
      ...configuration,
      columns: [
        ...configuration.columns,
        { key: 'tags', visible: false, order: configuration.columns.length },
        { key: `custom-field:${metadata.definitionId}`, visible: true, order: configuration.columns.length + 1 },
      ],
      metadataFilters: [
        { operator: 'options', definitionId: metadata.definitionId, optionIds: [metadata.optionId] },
        { operator: 'tags-any', tagIds: [metadata.tagId] },
      ],
    }

    const created = service.create(store, { projectId: 1, input: customInput })
    expect(created.configuration).toMatchObject({
      columns: customInput.columns,
      metadataFilters: customInput.metadataFilters,
    })
    expect(store.core.database.query(`
      SELECT definition_id FROM systems_saved_view_columns
      WHERE saved_view_id = ? AND column_key = ?
    `).get(created.id, `custom-field:${metadata.definitionId}`)).toEqual({ definition_id: metadata.definitionId })

    const replaced = service.replace(store, {
      projectId: 1,
      viewId: created.id,
      expectedRevision: created.revision,
      input: { ...customInput, name: 'Critical systems', metadataFilters: [{ operator: 'has-tags' }] },
    })
    expect(replaced.revision).toBe(2)
    expect(replaced.configuration.metadataFilters).toEqual([{ operator: 'has-tags' }])
  })
})
