import type { Database } from 'bun:sqlite'
import { assertExtensionsContainOnlyUnknownFields, INVENTORY_TYPES, type InventoryType } from '../core/inventory/field-contract.ts'

type CountRow = { count: number }
type SumRow = { total: number | null }

function count(database: Database, table: string) {
  return Number((database.query(`SELECT count(*) AS count FROM ${table}`).get() as CountRow).count)
}

function metadata(database: Database, key: string) {
  const row = database.query('SELECT value_json FROM application_metadata WHERE key = ?').get(key) as { value_json: string } | null
  return row ? JSON.parse(row.value_json) : null
}

export function sqliteSemanticSnapshot(database: Database) {
  const byType: Record<string, number> = {}
  for (const type of INVENTORY_TYPES) {
    const row = database.query(`
      SELECT count(*) AS count
      FROM inventory_items AS item
      JOIN inventory_item_types AS type ON type.id = item.type_id
      WHERE type.key = ?
    `).get(type) as CountRow
    if (row.count) byType[type] = Number(row.count)
  }
  const memoryCapacityMiB = Number((database.query('SELECT sum(capacity_mib) AS total FROM memory_modules').get() as SumRow).total ?? 0)
  const storageCapacityBytes = Number((database.query('SELECT sum(capacity_bytes) AS total FROM storage_devices').get() as SumRow).total ?? 0)
  const policyRow = database.query(
    'SELECT policy_json FROM project_compatibility_policies WHERE project_id = 1',
  ).get() as { policy_json: string } | null
  const policy = policyRow ? JSON.parse(policyRow.policy_json) : metadata(database, 'legacy.compatibility-policy') ?? {}

  return {
    schemaVersion: metadata(database, 'legacy.schema-version'),
    inventory: {
      total: count(database, 'inventory_items'),
      byType,
      memoryCapacityMiB,
      storageCapacityBytes,
    },
    topology: {
      assignments: count(database, 'component_assignments'),
      placements: count(database, 'workspace_placements'),
      connections: count(database, 'project_connections'),
    },
    identity: {
      inventoryAliases: count(database, 'inventory_identity_aliases'),
      registryLinks: count(database, 'registry_links'),
      agents: count(database, 'agents'),
      users: count(database, 'users'),
    },
    registry: {
      sources: count(database, 'registry_sources'),
      links: count(database, 'registry_links'),
      outbox: (metadata(database, 'legacy.registry-extended-state')?.contributionOutbox ?? []).length,
      ledger: (metadata(database, 'legacy.registry-extended-state')?.contributionLedger ?? []).length,
    },
    notifications: {
      contactPoints: count(database, 'notification_contact_points'),
      incidents: count(database, 'incidents'),
      deliveries: count(database, 'notification_deliveries'),
    },
    backups: {
      backups: count(database, 'backup_runs'),
      restores: count(database, 'backup_restore_journal'),
    },
    project: {
      revision: Number((database.query('SELECT revision FROM projects WHERE id = 1').get() as { revision: number }).revision),
      disabledCompatibilityHosts: (policy.disabledHosts ?? []).length,
      ignoredCompatibilityWarnings: (policy.ignoredWarningIds ?? []).length,
    },
  }
}

function assertNoSupportedExtensions(database: Database) {
  const rows = database.query(`
    SELECT type.key AS type_key, item.extensions_json
    FROM inventory_items AS item
    JOIN inventory_item_types AS type ON type.id = item.type_id
  `).all() as Array<{ type_key: InventoryType, extensions_json: string }>
  for (const row of rows) {
    const extensions = JSON.parse(row.extensions_json) as Record<string, unknown>
    assertExtensionsContainOnlyUnknownFields(row.type_key, extensions)
  }
}

export function verifyImportedCore({ database, expected }: Readonly<{ database: Database, expected: unknown }>) {
  const foreignKeys = database.query('PRAGMA foreign_key_check').all()
  if (foreignKeys.length) throw new Error(`Imported core database has ${foreignKeys.length} foreign-key violation(s).`)
  const quickCheck = database.query('PRAGMA quick_check').get() as Record<string, string>
  if (String(Object.values(quickCheck)[0]) !== 'ok') throw new Error('Imported core database failed SQLite quick_check.')
  assertNoSupportedExtensions(database)
  const actual = sqliteSemanticSnapshot(database)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Imported core semantic snapshot differs from legacy source.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`)
  }
  return { ok: true as const }
}
