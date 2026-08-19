import { Database } from 'bun:sqlite'
import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { cleanItemForStore } from '../db/inventory-input.mjs'
import { LEGACY_TABLE_BY_TYPE } from '../persistence/legacy/identity-plan.ts'
import { insertLegacyInventoryItem, replaceLegacyInventoryItem } from '../persistence/migration/core-importer.ts'
import {
  projectAgentState,
  projectAgentStatusState,
} from '../persistence/core/projections/legacy-domains.ts'
import type { ManagedDatabase } from '../persistence/sqlite/database.ts'
import { databaseQuickCheck, foreignKeyViolations } from '../persistence/sqlite/integrity.ts'
import { openManagedDatabase } from '../persistence/sqlite/database.ts'
import type { InventoryType } from '../persistence/core/inventory/field-contract.ts'
import { runtimeProjectFromLogical } from './sqlite-section-exporter.ts'

type Row = Record<string, any>

const RESTORE_ACTIVATION_JOURNAL = '.core-restore-activation.json'

type RestoreActivationStage = 'prepared' | 'active-moved' | 'staging-active'

type RestoreActivationJournal = Readonly<{
  version: 1
  stage: RestoreActivationStage
  activeFile: string
  stagingFile: string
  rollbackFile: string
}>

async function exists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function assertLocalDatabaseFile(value: unknown, label: string) {
  if (typeof value !== 'string' || !value || basename(value) !== value || value.includes('..')) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

async function writeRestoreActivationJournal(
  directory: string,
  journal: RestoreActivationJournal,
) {
  const filePath = join(directory, RESTORE_ACTIVATION_JOURNAL)
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryPath, filePath)
  await chmod(filePath, 0o600)
}

function validCoreDatabase(filePath: string) {
  let database: Database | null = null
  try {
    database = new Database(filePath, { create: false, strict: true })
    const valid = databaseQuickCheck(database) === 'ok' && foreignKeyViolations(database).length === 0
    if (valid) {
      database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
      database.exec('PRAGMA journal_mode = DELETE;')
    }
    return valid
  } catch {
    return false
  } finally {
    database?.close(false)
  }
}

async function removeSqliteSidecars(filePath: string) {
  await Promise.all([
    rm(`${filePath}-wal`, { force: true }),
    rm(`${filePath}-shm`, { force: true }),
  ])
}

export async function recoverInterruptedSqliteRestore(dataDir: string) {
  const directory = join(dataDir, 'databases')
  const journalPath = join(directory, RESTORE_ACTIVATION_JOURNAL)
  let journal: RestoreActivationJournal
  try {
    journal = JSON.parse(await readFile(journalPath, 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { recovered: false as const }
    throw new Error('SQLite restore activation journal is invalid.', { cause: error })
  }
  if (journal.version !== 1 || !['prepared', 'active-moved', 'staging-active'].includes(journal.stage)) {
    throw new Error('SQLite restore activation journal uses an unsupported format.')
  }
  const active = join(directory, assertLocalDatabaseFile(journal.activeFile, 'Restore active database'))
  const staging = join(directory, assertLocalDatabaseFile(journal.stagingFile, 'Restore staging database'))
  const rollback = join(directory, assertLocalDatabaseFile(journal.rollbackFile, 'Restore rollback database'))
  const activeExists = await exists(active)
  const stagingExists = await exists(staging)
  const rollbackExists = await exists(rollback)

  if (activeExists && validCoreDatabase(active)) {
    await Promise.all([
      rm(staging, { force: true }),
      rm(rollback, { force: true }),
      removeSqliteSidecars(active),
      removeSqliteSidecars(staging),
      removeSqliteSidecars(rollback),
      rm(journalPath, { force: true }),
    ])
    return { recovered: true as const, action: journal.stage === 'prepared' ? 'kept-active' : 'completed-activation' }
  }
  if (journal.stage === 'active-moved' && stagingExists && validCoreDatabase(staging)) {
    await rm(active, { force: true })
    await Promise.all([removeSqliteSidecars(active), removeSqliteSidecars(staging)])
    await rename(staging, active)
    await chmod(active, 0o600)
    await Promise.all([
      rm(rollback, { force: true }),
      removeSqliteSidecars(rollback),
      rm(journalPath, { force: true }),
    ])
    return { recovered: true as const, action: 'completed-activation' }
  }
  if (rollbackExists && validCoreDatabase(rollback)) {
    await rm(active, { force: true })
    await Promise.all([removeSqliteSidecars(active), removeSqliteSidecars(rollback)])
    await rename(rollback, active)
    await chmod(active, 0o600)
    await Promise.all([
      rm(staging, { force: true }),
      removeSqliteSidecars(staging),
      rm(journalPath, { force: true }),
    ])
    return { recovered: true as const, action: 'restored-rollback' }
  }
  throw new Error('Interrupted SQLite restore has no valid active or rollback database.')
}

function json(value: unknown) {
  return JSON.stringify(value)
}

function itemAliases(database: Database) {
  return new Map((database.query(`
    SELECT legacy_type_key, legacy_id, item_id
    FROM inventory_identity_aliases
  `).all() as Row[]).map((row) => [`${row.legacy_type_key}:${row.legacy_id}`, row.item_id]))
}

function clearProjectTopology(database: Database, projectId: number, workspaceId: number) {
  database.query('DELETE FROM project_connections WHERE project_id = ?').run(projectId)
  database.query('DELETE FROM component_assignments WHERE project_id = ?').run(projectId)
  database.query('DELETE FROM workspace_placements WHERE project_id = ? AND workspace_id = ?').run(projectId, workspaceId)
}

const PROJECT_DOMAIN_DELETE_ORDER = [
  'compatibility_audit_ignores',
  'compatibility_audit_findings',
  'compatibility_audits',
  'workspace_route_cache',
  'workspace_manual_bend_points',
  'workspace_connection_visibility',
  'connection_endpoints',
  'component_assignment_slots',
  'component_assignments',
  'project_connections',
  'workspace_placements',
  'project_inventory_overrides',
  'project_inventory_memberships',
] as const

const PROJECT_WORKBOOK_INSERT_ORDER = [
  'projects',
  'workspaces',
  'canvas_workspaces',
  'project_preferences',
  'project_compatibility_policies',
  'project_inventory_memberships',
  'project_inventory_overrides',
  'workspace_placements',
  'component_assignments',
  'component_assignment_slots',
  'project_connections',
  'connection_endpoints',
  'workspace_connection_visibility',
  'workspace_manual_bend_points',
  'compatibility_audits',
  'compatibility_audit_findings',
  'compatibility_audit_ignores',
] as const

function insertRows(database: Database, table: string, rows: Row[]) {
  const allowedColumns = new Set((database.query(`PRAGMA table_info(\`${table}\`)`).all() as Row[])
    .map((column) => String(column.name)))
  if (allowedColumns.size === 0) throw new Error(`Restore table ${table} is unavailable.`)
  for (const row of rows) {
    const entries = Object.entries(row)
    if (entries.length === 0) throw new Error(`Restore table ${table} contains an empty row.`)
    for (const [column] of entries) {
      if (!allowedColumns.has(column)) {
        throw new Error(`Restore table ${table} contains unsupported column ${column}.`)
      }
    }
    const columns = entries.map(([column]) => `\`${column}\``).join(', ')
    const placeholders = entries.map(() => '?').join(', ')
    try {
      database.query(`INSERT INTO \`${table}\` (${columns}) VALUES (${placeholders})`)
        .run(...entries.map(([, value]) => value))
    } catch (error) {
      throw new Error(`Restore failed while inserting ${table} row ${JSON.stringify(row)}.`, { cause: error })
    }
  }
}

function identityLookup(rows: Row[], key: (row: Row) => string) {
  return new Map(rows.map((row) => [Number(row.canonical_id), key(row)]))
}

function currentIdentityMaps(database: Database) {
  const items = new Map((database.query(`
    SELECT a.legacy_type_key AS item_type, a.legacy_id AS item_id, a.item_id AS canonical_id
    FROM inventory_identity_aliases a
  `).all() as Row[]).map((row) => [`${row.item_type}:${row.item_id}`, Number(row.canonical_id)]))
  const ports = new Map((database.query(`
    SELECT a.legacy_type_key AS item_type, a.legacy_id AS item_id,
           pa.legacy_port_id AS port_id, pa.port_id AS canonical_id
    FROM port_identity_aliases pa
    JOIN inventory_ports p ON p.id = pa.port_id
    JOIN inventory_identity_aliases a ON a.item_id = p.item_id
  `).all() as Row[]).map((row) => [`${row.item_type}:${row.item_id}:${row.port_id}`, Number(row.canonical_id)]))
  const faces = new Map((database.query(`
    SELECT a.legacy_type_key AS item_type, a.legacy_id AS item_id,
           pa.legacy_port_id AS port_id, f.endpoint_number, f.id AS canonical_id
    FROM port_endpoint_faces f
    JOIN inventory_ports p ON p.id = f.port_id
    JOIN port_identity_aliases pa ON pa.port_id = p.id
    JOIN inventory_identity_aliases a ON a.item_id = p.item_id
  `).all() as Row[]).map((row) => [
    `${row.item_type}:${row.item_id}:${row.port_id}:${row.endpoint_number}`,
    Number(row.canonical_id),
  ]))
  const slots = new Map((database.query(`
    SELECT a.legacy_type_key AS item_type, a.legacy_id AS item_id,
           ra.legacy_resource_key, s.position,
           s.id AS canonical_id
    FROM host_resource_slots s
    JOIN host_resource_groups g ON g.id = s.resource_group_id
    JOIN inventory_identity_aliases a ON a.item_id = g.host_item_id
    JOIN resource_identity_aliases ra ON ra.resource_id = g.resource_identity_id
  `).all() as Row[]).map((row) => [
    `${row.item_type}:${row.item_id}:${row.legacy_resource_key}:${row.position}`,
    Number(row.canonical_id),
  ]))
  return { items, ports, faces, slots }
}

function prepareProjectWorkbookRestore(database: Database) {
  for (const table of PROJECT_DOMAIN_DELETE_ORDER) {
    if (table !== 'project_inventory_memberships') database.query(`DELETE FROM ${table}`).run()
  }
}

function replaceProjectWorkbooks(database: Database, workbooks: Row, legacyProject: Row, now: number) {
  if (workbooks?.contractVersion !== 1) {
    throw new Error('Project workbook backup contract is unsupported.')
  }
  const tables = workbooks.tables
  const identities = workbooks.identities
  if (!tables || typeof tables !== 'object' || !identities || typeof identities !== 'object') {
    throw new Error('Project workbook backup is invalid.')
  }
  for (const table of PROJECT_WORKBOOK_INSERT_ORDER) {
    if (!Array.isArray(tables[table])) throw new Error(`Project workbook table ${table} is missing.`)
  }

  database.query("UPDATE inventory_items SET scope = 'global', owner_project_id = NULL").run()
  database.query('DELETE FROM projects').run()
  const current = currentIdentityMaps(database)
  const archivedItems = identityLookup(identities.items ?? [], (row) => `${row.item_type}:${row.item_id}`)
  const archivedPorts = identityLookup(
    identities.ports ?? [],
    (row) => `${row.item_type}:${row.item_id}:${row.port_id}`,
  )
  const archivedFaces = identityLookup(
    identities.endpointFaces ?? [],
    (row) => `${row.item_type}:${row.item_id}:${row.port_id}:${row.endpoint_number}`,
  )
  const archivedSlots = identityLookup(
    identities.resourceSlots ?? [],
    (row) => `${row.item_type}:${row.item_id}:${row.legacy_resource_key}:${row.position}`,
  )
  const mapRequired = (source: Map<number, string>, target: Map<string, number>, value: unknown, label: string) => {
    const key = source.get(Number(value))
    const mapped = key ? target.get(key) : undefined
    if (!mapped) throw new Error(`${label} cannot be resolved during project restore.`)
    return mapped
  }
  const mapOptional = (source: Map<number, string>, target: Map<string, number>, value: unknown, label: string) => (
    value == null ? null : mapRequired(source, target, value, label)
  )

  const transformed = structuredClone(tables) as Record<string, Row[]>
  for (const row of transformed.project_inventory_memberships) {
    row.item_id = mapRequired(archivedItems, current.items, row.item_id, 'Project inventory membership')
  }
  for (const row of transformed.project_inventory_overrides) {
    row.item_id = mapRequired(archivedItems, current.items, row.item_id, 'Project inventory override')
  }
  for (const row of transformed.workspace_placements) {
    row.item_id = mapRequired(archivedItems, current.items, row.item_id, 'Workspace placement')
  }
  for (const row of transformed.component_assignments) {
    row.host_item_id = mapRequired(archivedItems, current.items, row.host_item_id, 'Assignment host')
    row.component_item_id = mapRequired(archivedItems, current.items, row.component_item_id, 'Assignment component')
    row.resource_slot_id = mapOptional(archivedSlots, current.slots, row.resource_slot_id, 'Assignment resource slot')
  }
  for (const row of transformed.component_assignment_slots) {
    row.host_item_id = mapRequired(archivedItems, current.items, row.host_item_id, 'Assignment slot host')
    row.resource_slot_id = mapRequired(archivedSlots, current.slots, row.resource_slot_id, 'Assignment slot resource')
  }
  for (const row of transformed.connection_endpoints) {
    row.port_id = mapRequired(archivedPorts, current.ports, row.port_id, 'Connection endpoint port')
    row.endpoint_face_id = mapOptional(archivedFaces, current.faces, row.endpoint_face_id, 'Connection endpoint face')
  }
  for (const row of transformed.compatibility_audit_findings) {
    row.host_item_id = mapRequired(archivedItems, current.items, row.host_item_id, 'Compatibility finding host')
    row.component_item_id = mapOptional(archivedItems, current.items, row.component_item_id, 'Compatibility finding component')
    row.resource_slot_id = mapOptional(
      archivedSlots,
      current.slots,
      row.resource_slot_id,
      'Compatibility finding resource slot',
    )
  }
  for (const row of transformed.compatibility_audit_ignores) {
    if (row.ignored_by_user_id != null && !database.query('SELECT 1 FROM users WHERE id = ?').get(row.ignored_by_user_id)) {
      row.ignored_by_user_id = null
    }
  }

  for (const table of PROJECT_WORKBOOK_INSERT_ORDER) insertRows(database, table, transformed[table])
  for (const identity of identities.items ?? []) {
    const itemId = current.items.get(`${identity.item_type}:${identity.item_id}`)
    if (!itemId) continue
    const scope = identity.scope === 'project' ? 'project' : 'global'
    const ownerProjectId = scope === 'project' ? identity.owner_project_id : null
    if (scope === 'project' && !database.query('SELECT 1 FROM projects WHERE id = ?').get(ownerProjectId)) {
      throw new Error(`Project-bound inventory owner ${ownerProjectId} is missing from the backup.`)
    }
    database.query('UPDATE inventory_items SET scope = ?, owner_project_id = ?, updated_at_ms = ? WHERE id = ?')
      .run(scope, ownerProjectId, now, itemId)
  }

  const firstProject = database.query('SELECT id, name, updated_at_ms FROM projects WHERE id = 1').get() as Row | null
  if (firstProject) {
    const policy = database.query('SELECT policy_json FROM project_compatibility_policies WHERE project_id = 1').get() as Row | null
    database.query(`
      INSERT INTO application_metadata (key, value_json, updated_at_ms)
      VALUES ('legacy.project-metadata', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms
    `).run(json({
      ...structuredClone(legacyProject.metadata ?? {}),
      name: firstProject.name,
      updatedAt: new Date(firstProject.updated_at_ms).toISOString(),
    }), firstProject.updated_at_ms)
    database.query(`
      INSERT INTO application_metadata (key, value_json, updated_at_ms)
      VALUES ('legacy.compatibility-policy', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms
    `).run(policy?.policy_json ?? json({ disabledHosts: [], ignoredWarningIds: [] }), firstProject.updated_at_ms)
  }
}

function replaceWorkspaceRouteCache(database: Database, routeCache: Row, now: number) {
  const workspaces = routeCache?.workspaces
  if (!workspaces) return false
  if (workspaces.contractVersion !== 1 || !Array.isArray(workspaces.rows)) {
    throw new Error('Workspace route-cache backup contract is unsupported.')
  }
  database.query('DELETE FROM workspace_route_cache').run()
  insertRows(database, 'workspace_route_cache', workspaces.rows)
  const { entries: _entries, workspaces: _workspaces, ...envelope } = routeCache
  database.query(`
    INSERT INTO application_metadata (key, value_json, updated_at_ms)
    VALUES ('legacy.routing-cache-envelope', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms
  `).run(json(envelope), now)
  return true
}

function legacyProjectSection(project: Row) {
  const { workbooks: _workbooks, ...legacy } = project
  return legacy
}

function replaceInventory(database: Database, inventory: Row, projectId: number, now: number) {
  const current = itemAliases(database)
  const target = new Map<string, { type: InventoryType; item: Row }>()
  for (const [type, table] of Object.entries(LEGACY_TABLE_BY_TYPE) as [InventoryType, string][]) {
    for (const item of inventory[table] ?? []) target.set(`${type}:${item.id}`, { type, item })
  }
  for (const [key, itemId] of current) {
    if (target.has(key)) continue
    database.query('UPDATE inventory_items SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?').run(now, now, itemId)
    database.query('DELETE FROM port_identity_aliases WHERE port_id IN (SELECT id FROM inventory_ports WHERE item_id = ?)').run(itemId)
    database.query('DELETE FROM resource_identity_aliases WHERE resource_id IN (SELECT id FROM inventory_resources WHERE item_id = ?)').run(itemId)
    database.query('DELETE FROM inventory_identity_aliases WHERE item_id = ?').run(itemId)
    database.query('DELETE FROM inventory_items WHERE id = ?').run(itemId)
  }
  for (const [key, entry] of target) {
    const existingId = current.get(key)
    if (existingId) {
      const membership = database.query(`
        SELECT project_id FROM project_inventory_memberships
        WHERE item_id = ? ORDER BY project_id LIMIT 1
      `).get(existingId) as { project_id: number } | null
      const owner = database.query(
        'SELECT owner_project_id FROM inventory_items WHERE id = ?',
      ).get(existingId) as { owner_project_id: number | null } | null
      const replacementProjectId = owner?.owner_project_id ?? membership?.project_id ?? projectId
      const temporaryMembership = membership == null && owner?.owner_project_id == null
      if (temporaryMembership) {
        database.query(`
          INSERT OR IGNORE INTO project_inventory_memberships (project_id, item_id, created_at_ms)
          VALUES (?, ?, ?)
        `).run(replacementProjectId, existingId, now)
      }
      replaceLegacyInventoryItem({
        database,
        projectId: replacementProjectId,
        type: entry.type,
        item: cleanItemForStore(entry.item),
        itemId: existingId,
        now,
      })
      if (temporaryMembership) {
        database.query('DELETE FROM project_inventory_memberships WHERE project_id = ? AND item_id = ?')
          .run(replacementProjectId, existingId)
      }
    } else {
      insertLegacyInventoryItem({
        database,
        projectId,
        type: entry.type,
        item: cleanItemForStore(entry.item),
        now,
      })
    }
  }
}

const INVENTORY_METADATA_DELETE_ORDER = [
  'inventory_custom_field_option_values',
  'inventory_item_tags',
  'inventory_custom_field_values',
  'custom_field_options',
  'custom_field_applicability',
  'inventory_tags',
  'custom_field_definitions',
] as const

function replaceInventoryMetadata(database: Database, metadata: Row) {
  if (metadata?.contractVersion !== 1 || !metadata.tables || !metadata.identities) {
    throw new Error('Inventory metadata backup contract is unsupported.')
  }
  const requiredTables = [...INVENTORY_METADATA_DELETE_ORDER].reverse()
  for (const table of requiredTables) {
    if (!Array.isArray(metadata.tables[table])) {
      throw new Error(`Inventory metadata table ${table} is missing.`)
    }
  }
  const archivedItemIdentities = new Map((metadata.identities.items ?? []).map((row: Row) => [
    Number(row.canonical_id),
    `${row.item_type}:${row.item_id}`,
  ]))
  const currentItems = itemAliases(database)
  const mapItemId = (sourceId: unknown) => {
    const key = archivedItemIdentities.get(Number(sourceId))
    const itemId = key ? currentItems.get(key) : undefined
    if (!itemId) throw new Error('Inventory metadata references an unavailable inventory item.')
    return itemId
  }
  const tables = structuredClone(metadata.tables) as Record<string, Row[]>
  for (const row of tables.inventory_custom_field_values) row.item_id = mapItemId(row.item_id)
  for (const row of tables.inventory_item_tags) row.item_id = mapItemId(row.item_id)

  const archivedDefinitions = new Map<number, number | null>()
  const archivedOptions = new Map<number, number | null>()
  const archivedTags = new Map<number, number | null>()
  for (const row of tables.custom_field_definitions) {
    archivedDefinitions.set(Number(row.id), row.archived_at_ms ?? null)
    row.archived_at_ms = null
  }
  for (const row of tables.custom_field_options) {
    archivedOptions.set(Number(row.id), row.archived_at_ms ?? null)
    row.archived_at_ms = null
  }
  for (const row of tables.inventory_tags) {
    archivedTags.set(Number(row.id), row.archived_at_ms ?? null)
    row.archived_at_ms = null
  }

  for (const table of INVENTORY_METADATA_DELETE_ORDER) database.query(`DELETE FROM ${table}`).run()
  for (const table of requiredTables) insertRows(database, table, tables[table])
  const restoreArchived = (table: string, values: Map<number, number | null>) => {
    const update = database.query(`UPDATE ${table} SET archived_at_ms = ? WHERE id = ?`)
    for (const [id, archivedAt] of values) {
      if (archivedAt != null) update.run(archivedAt, id)
    }
  }
  restoreArchived('custom_field_options', archivedOptions)
  restoreArchived('custom_field_definitions', archivedDefinitions)
  restoreArchived('inventory_tags', archivedTags)
}

function resolveItem(database: Database, type: string, id: number) {
  const row = database.query(`
    SELECT item_id FROM inventory_identity_aliases
    WHERE legacy_type_key = ? AND legacy_id = ?
  `).get(type, id) as { item_id: number } | null
  if (!row) throw new Error(`Restore references missing inventory item ${type}:${id}.`)
  return row.item_id
}

function clearAgents(database: Database) {
  database.query('DELETE FROM agent_enrollment_codes').run()
  database.query('DELETE FROM agent_host_bindings').run()
  database.query('DELETE FROM agent_identity_aliases').run()
  database.query('DELETE FROM agents').run()
}

function replaceAgents(database: Database, agents: Row, agentStatus: Row, now: number) {
  clearAgents(database)
  for (const enrollment of Object.values(agents.enrollments ?? {}) as Row[]) {
    database.query(`
      INSERT INTO agent_enrollment_codes (
        id, host_item_id, token_hash, expires_at_ms, used_at_ms, revoked_at_ms, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      enrollment.id,
      resolveItem(database, enrollment.hostType, enrollment.hostId),
      enrollment.tokenHash,
      Date.parse(enrollment.expiresAt),
      enrollment.usedAt ? Date.parse(enrollment.usedAt) : null,
      enrollment.revokedAt ? Date.parse(enrollment.revokedAt) : null,
      enrollment.createdAt ? Date.parse(enrollment.createdAt) : now,
    )
  }
  for (const device of Object.values(agents.devices ?? {}) as Row[]) {
    database.query(`
      INSERT INTO agents (
        id, public_key, protocol_major, agent_version, capabilities_json,
        last_sequence, last_seen_at_ms, revoked_at_ms, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      device.id,
      device.publicKey,
      device.protocolMajor ?? 1,
      device.agentVersion ?? device.version ?? 'unknown',
      json(device.capabilities ?? {}),
      device.lastSequence ?? 0,
      device.lastSeenAt ? Date.parse(device.lastSeenAt) : null,
      device.revokedAt ? Date.parse(device.revokedAt) : null,
      device.createdAt ? Date.parse(device.createdAt) : now,
    )
    database.query('INSERT INTO agent_identity_aliases (agent_id, legacy_id, created_at_ms) VALUES (?, ?, ?)')
      .run(device.id, device.id, now)
    database.query(`
      INSERT INTO agent_host_bindings (agent_id, host_item_id, state, bound_at_ms, unbound_at_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      device.id,
      resolveItem(database, device.hostType, device.hostId),
      device.state ?? 'active',
      device.boundAt ? Date.parse(device.boundAt) : (device.createdAt ? Date.parse(device.createdAt) : now),
      device.unboundAt ? Date.parse(device.unboundAt) : null,
    )
  }
  database.query(`
    INSERT INTO application_metadata (key, value_json, updated_at_ms)
    VALUES ('legacy.agent-extended-state', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms
  `).run(json({
    enrollments: agents.enrollments ?? {},
    deviceExtensions: Object.fromEntries(
      Object.entries(agents.devices ?? {}).map(([id, device]) => [id, device]),
    ),
    hardwareSnapshots: agents.hardwareSnapshots ?? {},
    hardwareEvents: agents.hardwareEvents ?? {},
    status: agentStatus,
  }), now)
}

function activateReopenedHandle(active: ManagedDatabase, reopened: ManagedDatabase) {
  Object.assign(active as Row, {
    database: reopened.database,
    readonly: reopened.readonly,
    closed: false,
  })
  reopened.closed = true
}

export async function stageAndActivateSqliteRestore({
  active,
  replacements,
  currentStores,
  projectId,
  workspaceId,
  appVersion,
  dataDir,
  now,
  failAtActivationStage = null,
}: {
  active: ManagedDatabase
  replacements: Row
  currentStores: Row
  projectId: number
  workspaceId: number
  appVersion: string
  dataDir: string
  now: () => number
  failAtActivationStage?: RestoreActivationStage | null
}) {
  const directory = dirname(active.filePath)
  const stagingPath = join(directory, `.core-restore-${process.pid}-${Date.now()}.sqlite`)
  const rollbackPath = `${active.filePath}.restore-rollback`
  await rm(stagingPath, { force: true })
  await rm(rollbackPath, { force: true })
  await writeFile(stagingPath, active.database.serialize(), { mode: 0o600 })
  await chmod(stagingPath, 0o600)
  const staged = await openManagedDatabase({ filePath: stagingPath, schemaName: 'core' })
  try {
    const { SqliteHomelabInventoryStore } = await import('../persistence/sqlite-store.ts')
    const store = new SqliteHomelabInventoryStore({
      core: staged,
      projectId,
      workspaceId,
      appVersion,
      dataDir,
      now,
    })
    const beforeProject = structuredClone(currentStores.project)
    const beforeRegistry = structuredClone(currentStores.registry)
    const beforeAgents = structuredClone(currentStores.agents)
    const beforeAgentStatus = structuredClone(currentStores.agentStatus)

    const workbookRestore = replacements.project?.workbooks
    if (workbookRestore) prepareProjectWorkbookRestore(staged.database)
    else if (replacements.project) clearProjectTopology(staged.database, projectId, workspaceId)
    if (replacements.registry) staged.database.query('DELETE FROM registry_links').run()
    if (replacements.agents) clearAgents(staged.database)
    if (replacements.inventory) {
      replaceInventory(staged.database, replacements.inventory, projectId, now())
      if (replacements.inventory.metadata) {
        replaceInventoryMetadata(staged.database, replacements.inventory.metadata)
      }
    }
    if (workbookRestore) {
      replaceProjectWorkbooks(staged.database, workbookRestore, replacements.project, now())
    } else if (replacements.project) {
      const current = store.getProject()
      const submitted = runtimeProjectFromLogical(replacements.project, current.items)
      submitted.revision = current.revision
      store.setProject(submitted)
      const restoredProjectUpdatedAt = Date.parse(replacements.project.metadata?.updatedAt ?? '')
      const projectUpdatedAt = Number.isFinite(restoredProjectUpdatedAt) ? restoredProjectUpdatedAt : now()
      staged.database.query('UPDATE projects SET revision = ?, updated_at_ms = ? WHERE id = ?')
        .run(replacements.project.revision, projectUpdatedAt, projectId)
      staged.database.query(`
        INSERT INTO application_metadata (key, value_json, updated_at_ms)
        VALUES ('legacy.project-metadata', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms
      `).run(json(replacements.project.metadata), projectUpdatedAt)
    }
    if (replacements.registry) store.registryTransaction((draft: Row) => Object.assign(draft, structuredClone(replacements.registry)))
    if (replacements.authentication) store.updateAuthentication((draft: Row) => Object.assign(draft, structuredClone(replacements.authentication)))
    if (replacements.backupManagement) store.updateBackupManagement((draft: Row) => Object.assign(draft, structuredClone(replacements.backupManagement)))
    if (replacements.routingCache) {
      if (!replaceWorkspaceRouteCache(staged.database, replacements.routingCache, now())) {
        store.setRoutingCache(replacements.routingCache)
      }
    }
    if (replacements.agents || replacements.agentStatus) {
      replaceAgents(
        staged.database,
        replacements.agents ?? beforeAgents,
        replacements.agentStatus ?? beforeAgentStatus,
        now(),
      )
    }
    if (replacements.meta) {
      const {
        schemaVersion: _schemaVersion,
        databaseSchemas: _databaseSchemas,
        ...applicationMeta
      } = replacements.meta
      staged.database.query(`
        INSERT INTO application_metadata (key, value_json, updated_at_ms)
        VALUES ('legacy.application-meta', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms
      `).run(json(applicationMeta), now())
    }

    if (
      !replacements.project
      && JSON.stringify(legacyProjectSection((await store.snapshotStores()).project))
        !== JSON.stringify(legacyProjectSection(beforeProject))
    ) {
      throw new Error('Selected restore would change project relationships without the Project section.')
    }
    if (!replacements.registry && JSON.stringify(store.getRegistryState()) !== JSON.stringify(beforeRegistry)) {
      throw new Error('Selected restore would change registry relationships without the Registry configuration section.')
    }
    if (!replacements.agents && JSON.stringify(projectAgentState(staged.database)) !== JSON.stringify(beforeAgents)) {
      throw new Error('Selected restore would change agent relationships without the Agents section.')
    }
    if (!replacements.agentStatus && JSON.stringify(projectAgentStatusState(staged.database)) !== JSON.stringify(beforeAgentStatus)) {
      throw new Error('Selected restore would change agent telemetry state without the Agent telemetry section.')
    }
    const violations = foreignKeyViolations(staged.database)
    if (violations.length > 0) throw new Error(`SQLite restore staging has ${violations.length} foreign-key violation(s).`)
    if (databaseQuickCheck(staged.database) !== 'ok') throw new Error('SQLite restore staging failed its integrity check.')
    await store.flush()
    staged.database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    staged.database.exec('PRAGMA journal_mode = DELETE;')
    store.close()
    const journal = {
      version: 1 as const,
      stage: 'prepared' as RestoreActivationStage,
      activeFile: basename(active.filePath),
      stagingFile: basename(stagingPath),
      rollbackFile: basename(rollbackPath),
    }
    await writeRestoreActivationJournal(directory, journal)
    if (failAtActivationStage === 'prepared') throw new Error('Injected SQLite restore failure at prepared.')

    active.database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    active.database.exec('PRAGMA journal_mode = DELETE;')
    active.close()
    try {
      await Promise.all([
        removeSqliteSidecars(active.filePath),
        removeSqliteSidecars(stagingPath),
        removeSqliteSidecars(rollbackPath),
      ])
      await rename(active.filePath, rollbackPath)
      await writeRestoreActivationJournal(directory, { ...journal, stage: 'active-moved' })
      if (failAtActivationStage === 'active-moved') throw new Error('Injected SQLite restore failure at active-moved.')
      await rename(stagingPath, active.filePath)
      await writeRestoreActivationJournal(directory, { ...journal, stage: 'staging-active' })
      if (failAtActivationStage === 'staging-active') throw new Error('Injected SQLite restore failure at staging-active.')
      const reopened = await openManagedDatabase({ filePath: active.filePath, schemaName: 'core' })
      activateReopenedHandle(active, reopened)
      await Promise.all([
        rm(rollbackPath, { force: true }),
        rm(join(directory, RESTORE_ACTIVATION_JOURNAL), { force: true }),
      ])
    } catch (error) {
      await recoverInterruptedSqliteRestore(dataDir)
      const reopened = await openManagedDatabase({ filePath: active.filePath, schemaName: 'core' })
      activateReopenedHandle(active, reopened)
      throw error
    }
  } catch (error) {
    if (!staged.closed) staged.close()
    await rm(stagingPath, { force: true })
    throw error
  }
}
