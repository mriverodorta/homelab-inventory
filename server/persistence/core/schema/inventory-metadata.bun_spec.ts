import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../migrations/manifest.ts'
import { closeManagedDatabase, openManagedDatabase } from '../../sqlite/database.ts'
import { applyCommittedMigrations } from '../../sqlite/migrator.ts'
import {
  customFieldApplicability,
  customFieldDefinitions,
  customFieldOptions,
  inventoryCustomFieldOptionValues,
  inventoryCustomFieldValues,
  inventoryItemTags,
  inventoryTags,
} from './inventory-metadata.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function createDatabase() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-metadata-schema-'))
  temporaryDirectories.push(root)
  const handle = await openManagedDatabase({
    filePath: join(root, 'databases', 'homelab-inventory.sqlite'),
    schemaName: 'core',
  })
  const migrationsDir = resolve(import.meta.dir, '../migrations/generated')
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  }))))
  return handle
}

function insertItem(database: Awaited<ReturnType<typeof createDatabase>>['database'], typeKey: string, name: string) {
  return database.query(`
    INSERT INTO inventory_items (
      type_id, scope, owner_project_id, name, row_version, created_at_ms, updated_at_ms
    ) VALUES (
      (SELECT id FROM inventory_item_types WHERE key = ?),
      'global', NULL, ?, 1, 1, 1
    ) RETURNING id
  `).get(typeKey, name) as { id: number }
}

function insertDefinition(
  database: Awaited<ReturnType<typeof createDatabase>>['database'],
  fieldType: string,
  name = fieldType,
) {
  return database.query(`
    INSERT INTO custom_field_definitions (
      name, normalized_name, field_type, display_order, revision, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, 0, 1, 1, 1) RETURNING id
  `).get(name, name.toLocaleLowerCase('en-US'), fieldType) as { id: number }
}

describe('inventory metadata relational schema', () => {
  test('exports every metadata table and registers the migration', () => {
    expect([
      customFieldDefinitions,
      customFieldApplicability,
      customFieldOptions,
      inventoryCustomFieldValues,
      inventoryCustomFieldOptionValues,
      inventoryTags,
      inventoryItemTags,
    ]).not.toContain(undefined)
    expect(CORE_MIGRATIONS.some((migration) => migration.id === '0026_inventory_metadata')).toBe(true)
  })

  test('accepts all supported field types and rejects duplicate normalized names', async () => {
    const handle = await createDatabase()
    try {
      const fieldTypes = [
        'shortText',
        'longText',
        'number',
        'boolean',
        'date',
        'dateTime',
        'singleSelect',
        'multiSelect',
        'url',
      ]
      for (const fieldType of fieldTypes) insertDefinition(handle.database, fieldType)
      expect(handle.database.query('SELECT field_type FROM custom_field_definitions ORDER BY id').all()).toHaveLength(fieldTypes.length)
      expect(() => insertDefinition(handle.database, 'shortText', 'ShortText')).toThrow()
      expect(() => insertDefinition(handle.database, 'unsupported', 'Unsupported')).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces numeric configuration and typed scalar storage', async () => {
    const handle = await createDatabase()
    try {
      expect(() => handle.database.query(`
        INSERT INTO custom_field_definitions (
          name, normalized_name, field_type, number_minimum, number_maximum,
          number_precision, display_order, revision, created_at_ms, updated_at_ms
        ) VALUES ('Invalid range', 'invalid range', 'number', 10, 1, 2, 0, 1, 1, 1)
      `).run()).toThrow()
      expect(() => handle.database.query(`
        INSERT INTO custom_field_definitions (
          name, normalized_name, field_type, number_precision,
          display_order, revision, created_at_ms, updated_at_ms
        ) VALUES ('Text precision', 'text precision', 'shortText', 2, 0, 1, 1, 1)
      `).run()).toThrow()

      const definition = insertDefinition(handle.database, 'number', 'Rack units')
      const serverType = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'server'").get() as { id: number }
      const server = insertItem(handle.database, 'server', 'Server')
      handle.database.query(`
        INSERT INTO custom_field_applicability (definition_id, item_type_id, created_at_ms)
        VALUES (?, ?, 1)
      `).run(definition.id, serverType.id)
      handle.database.query(`
        INSERT INTO inventory_custom_field_values (
          definition_id, item_id, number_value, revision, created_at_ms, updated_at_ms
        ) VALUES (?, ?, 2.5, 1, 1, 1)
      `).run(definition.id, server.id)
      expect(() => handle.database.query(`
        INSERT INTO inventory_custom_field_values (
          definition_id, item_id, text_value, revision, created_at_ms, updated_at_ms
        ) VALUES (?, ?, 'wrong', 1, 1, 1)
      `).run(definition.id, server.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects values for inapplicable item types and archived definitions', async () => {
    const handle = await createDatabase()
    try {
      const definition = insertDefinition(handle.database, 'shortText', 'Asset owner')
      const serverType = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'server'").get() as { id: number }
      const cpu = insertItem(handle.database, 'cpu', 'CPU')
      const server = insertItem(handle.database, 'server', 'Server')
      handle.database.query(`
        INSERT INTO custom_field_applicability (definition_id, item_type_id, created_at_ms)
        VALUES (?, ?, 1)
      `).run(definition.id, serverType.id)
      expect(() => handle.database.query(`
        INSERT INTO inventory_custom_field_values (
          definition_id, item_id, text_value, revision, created_at_ms, updated_at_ms
        ) VALUES (?, ?, 'owner', 1, 1, 1)
      `).run(definition.id, cpu.id)).toThrow()
      handle.database.query('UPDATE custom_field_definitions SET archived_at_ms = 2 WHERE id = ?').run(definition.id)
      expect(() => handle.database.query(`
        INSERT INTO inventory_custom_field_values (
          definition_id, item_id, text_value, revision, created_at_ms, updated_at_ms
        ) VALUES (?, ?, 'owner', 1, 1, 1)
      `).run(definition.id, server.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('enforces option ownership and single-select cardinality', async () => {
    const handle = await createDatabase()
    try {
      const first = insertDefinition(handle.database, 'singleSelect', 'Lifecycle')
      const second = insertDefinition(handle.database, 'multiSelect', 'Location')
      const serverType = handle.database.query("SELECT id FROM inventory_item_types WHERE key = 'server'").get() as { id: number }
      const server = insertItem(handle.database, 'server', 'Server')
      for (const definitionId of [first.id, second.id]) {
        handle.database.query(`
          INSERT INTO custom_field_applicability (definition_id, item_type_id, created_at_ms)
          VALUES (?, ?, 1)
        `).run(definitionId, serverType.id)
      }
      const firstOption = handle.database.query(`
        INSERT INTO custom_field_options (
          definition_id, label, normalized_label, color_token,
          display_order, revision, created_at_ms, updated_at_ms
        ) VALUES (?, 'Active', 'active', 'green', 0, 1, 1, 1) RETURNING id
      `).get(first.id) as { id: number }
      const secondOption = handle.database.query(`
        INSERT INTO custom_field_options (
          definition_id, label, normalized_label, color_token,
          display_order, revision, created_at_ms, updated_at_ms
        ) VALUES (?, 'Lab', 'lab', 'blue', 0, 1, 1, 1) RETURNING id
      `).get(second.id) as { id: number }
      const value = handle.database.query(`
        INSERT INTO inventory_custom_field_values (
          definition_id, item_id, revision, created_at_ms, updated_at_ms
        ) VALUES (?, ?, 1, 1, 1) RETURNING id
      `).get(first.id, server.id) as { id: number }
      handle.database.query(`
        INSERT INTO inventory_custom_field_option_values (value_id, option_id, created_at_ms)
        VALUES (?, ?, 1)
      `).run(value.id, firstOption.id)
      expect(() => handle.database.query(`
        INSERT INTO inventory_custom_field_option_values (value_id, option_id, created_at_ms)
        VALUES (?, ?, 1)
      `).run(value.id, secondOption.id)).toThrow()

      const anotherFirstOption = handle.database.query(`
        INSERT INTO custom_field_options (
          definition_id, label, normalized_label, color_token,
          display_order, revision, created_at_ms, updated_at_ms
        ) VALUES (?, 'Retired', 'retired', 'gray', 1, 1, 1, 1) RETURNING id
      `).get(first.id) as { id: number }
      expect(() => handle.database.query(`
        INSERT INTO inventory_custom_field_option_values (value_id, option_id, created_at_ms)
        VALUES (?, ?, 1)
      `).run(value.id, anotherFirstOption.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })

  test('rejects assigning archived tags', async () => {
    const handle = await createDatabase()
    try {
      const server = insertItem(handle.database, 'server', 'Server')
      const tag = handle.database.query(`
        INSERT INTO inventory_tags (
          name, normalized_name, color_token, display_order, revision,
          archived_at_ms, created_at_ms, updated_at_ms
        ) VALUES ('Critical', 'critical', 'red', 0, 1, 2, 1, 1) RETURNING id
      `).get() as { id: number }
      expect(() => handle.database.query(`
        INSERT INTO inventory_item_tags (item_id, tag_id, created_at_ms)
        VALUES (?, ?, 1)
      `).run(server.id, tag.id)).toThrow()
    } finally {
      closeManagedDatabase(handle)
    }
  })
})
