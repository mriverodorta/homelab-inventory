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
      replaceLegacyInventoryItem({
        database,
        projectId,
        type: entry.type,
        item: cleanItemForStore(entry.item),
        itemId: existingId,
        now,
      })
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

    if (replacements.project) clearProjectTopology(staged.database, projectId, workspaceId)
    if (replacements.registry) staged.database.query('DELETE FROM registry_links').run()
    if (replacements.agents) clearAgents(staged.database)
    if (replacements.inventory) replaceInventory(staged.database, replacements.inventory, projectId, now())
    if (replacements.project) {
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
    if (replacements.routingCache) store.setRoutingCache(replacements.routingCache)
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

    if (!replacements.project && JSON.stringify((await store.snapshotStores()).project) !== JSON.stringify(beforeProject)) {
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
