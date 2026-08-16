import { Database } from 'bun:sqlite'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { closeTelemetryDatabase, openTelemetryDatabase } from '../../telemetry/database.mjs'
import { TelemetryRepository } from '../../telemetry/repository.mjs'

type MigrationOptions = Readonly<{
  sourcePath: string
  targetPath: string
  identityPlan: CanonicalIdentityPlan
}>

type TelemetryRow = Record<string, unknown>

const LEGACY_TABLES = Object.freeze([
  'telemetry_samples',
  'latest_host_state',
  'latest_component_state',
  'component_events',
])
const PRESERVED_TABLES = Object.freeze([
  'latest_virtualization_state',
  'virtualization_events',
  'manual_inventory_reports',
  'manual_inventory_components',
  'agent_field_suggestions',
])
const MIGRATION_BATCH_SIZE = 128

function tableExists(database: Database, table: string) {
  return Boolean(database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function count(database: Database, table: string) {
  return tableExists(database, table)
    ? Number((database.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count)
    : 0
}

function canonicalIds(row: TelemetryRow, identityPlan: CanonicalIdentityPlan) {
  const hostKey = `${String(row.host_type)}:${Number(row.host_id)}`
  const hostItemId = identityPlan.items.get(hostKey)
  if (!hostItemId) throw new Error(`Telemetry references unknown legacy host ${hostKey}.`)
  const agentId = identityPlan.agents.get(String(Number(row.device_id)))
  if (!agentId) throw new Error(`Telemetry references unknown legacy agent ${String(row.device_id)}.`)
  return { hostItemId, agentId }
}

function canonicalRelationship(value: unknown, candidates: Iterable<number>, label: string) {
  const numeric = Number(value)
  if (Number.isSafeInteger(numeric) && numeric > 0) {
    for (const candidate of candidates) if (candidate === numeric) return numeric
  }
  throw new Error(`Telemetry ${label} relationship is unresolved.`)
}

function forEachSample(database: Database, callback: (rows: TelemetryRow[]) => void) {
  if (!tableExists(database, 'telemetry_samples')) return
  const first = database.query('SELECT * FROM telemetry_samples ORDER BY id LIMIT ?')
  const next = database.query('SELECT * FROM telemetry_samples WHERE id > ? ORDER BY id LIMIT ?')
  let cursor: unknown = null
  while (true) {
    const rows = (cursor === null ? first.all(MIGRATION_BATCH_SIZE) : next.all(cursor, MIGRATION_BATCH_SIZE)) as TelemetryRow[]
    if (rows.length === 0) break
    callback(rows)
    cursor = rows.at(-1)?.id
  }
}

function normalizedHeartbeat(row: TelemetryRow) {
  const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>
  return {
    ...payload,
    protocolMajor: 1,
    sequence: Number(row.sequence),
    agentVersion: String(row.agent_version ?? payload.agentVersion ?? 'legacy'),
    collectedAt: new Date(Number(row.collected_at_ms)).toISOString(),
    capabilities: payload.capabilities ?? {},
    metrics: payload.metrics ?? {},
    services: payload.services ?? [],
    containers: payload.containers ?? [],
    storageHealth: payload.storageHealth ?? [],
  }
}

function copyPreservedTables(source: Database, target: Database, identityPlan: CanonicalIdentityPlan) {
  const hostIds = new Set(identityPlan.items.values())
  const agentIds = new Set(identityPlan.agents.values())
  for (const table of PRESERVED_TABLES) {
    if (!tableExists(source, table)) continue
    const rows = source.query(`SELECT * FROM ${table} ORDER BY rowid`).all() as TelemetryRow[]
    if (rows.length === 0) continue
    const columns = Object.keys(rows[0])
    const insert = target.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    for (const original of rows) {
      const row = { ...original }
      if ('host_item_id' in row) row.host_item_id = canonicalRelationship(row.host_item_id, hostIds, 'host')
      if ('agent_id' in row) row.agent_id = canonicalRelationship(row.agent_id, agentIds, 'agent')
      insert.run(...columns.map((column) => row[column]))
    }
  }
}

function verifyTarget(database: Database) {
  const integrity = database.query('PRAGMA quick_check').get() as { quick_check: string }
  if (integrity.quick_check !== 'ok') throw new Error(`Telemetry migration integrity check failed: ${integrity.quick_check}`)
  if (database.query('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('Telemetry migration produced invalid foreign-key relationships.')
  }
  const oversized = database.query(`
    SELECT host_item_id FROM host_metric_samples GROUP BY host_item_id HAVING count(*) > 30
    UNION ALL
    SELECT host_item_id FROM heartbeat_receipts GROUP BY host_item_id HAVING count(*) > 30
  `).all()
  if (oversized.length > 0) throw new Error('Telemetry migration exceeded the compact 30-slot history bound.')
}

export async function migrateTelemetryReferences({ sourcePath, targetPath, identityPlan }: MigrationOptions) {
  const source = resolve(sourcePath)
  const target = resolve(targetPath)
  if (source === target) throw new Error('Telemetry migration requires a separate staging path.')
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await rm(target, { force: true })

  const sourceDatabase = new Database(source, { readonly: true, strict: true })
  let targetDatabase: Database | null = null
  try {
    const counts = Object.fromEntries(LEGACY_TABLES.map((table) => [table, count(sourceDatabase, table)]))

    // Validate every relationship before creating the replacement file.
    forEachSample(sourceDatabase, (rows) => {
      for (const row of rows) canonicalIds(row, identityPlan)
    })

    targetDatabase = await openTelemetryDatabase({ dataDir: dirname(dirname(target)), filePath: target })
    const repository = new TelemetryRepository(targetDatabase)
    forEachSample(sourceDatabase, (rows) => {
      targetDatabase?.transaction(() => {
        for (const row of rows) {
          const { hostItemId, agentId } = canonicalIds(row, identityPlan)
          repository.recordHeartbeat({
            deviceId: Number(row.device_id),
            agentId,
            hostType: String(row.host_type),
            hostId: Number(row.host_id),
            hostItemId,
            receivedAt: new Date(Number(row.received_at_ms)).toISOString(),
            payload: normalizedHeartbeat(row),
          })
        }
      }).immediate()
    })
    copyPreservedTables(sourceDatabase, targetDatabase, identityPlan)
    verifyTarget(targetDatabase)
    closeTelemetryDatabase(targetDatabase)
    targetDatabase = null
    await chmod(target, 0o600)
    return { targetPath: target, ...counts }
  } catch (error) {
    if (targetDatabase) closeTelemetryDatabase(targetDatabase)
    await rm(target, { force: true }).catch(() => {})
    throw error
  } finally {
    sourceDatabase.close(false)
  }
}
