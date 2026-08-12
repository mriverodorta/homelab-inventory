import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { closeTelemetryDatabase, openTelemetryDatabase } from '../../telemetry/database.mjs'

type MigrationOptions = Readonly<{
  sourcePath: string
  targetPath: string
  identityPlan: CanonicalIdentityPlan
}>

type TelemetryRow = Record<string, unknown>

const REFERENCED_TABLES = Object.freeze([
  'telemetry_samples',
  'latest_host_state',
  'latest_component_state',
  'component_events',
])

const ROW_IDENTIFIERS = Object.freeze({
  telemetry_samples: ['id'],
  latest_host_state: ['host_type', 'host_id'],
  latest_component_state: ['host_type', 'host_id', 'family', 'entity_key'],
  component_events: ['id'],
} as const)
const MIGRATION_BATCH_SIZE = 32
const EVENT_MIGRATION_BATCH_SIZE = 256

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function count(database: Database, table: string) {
  return Number((database.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count)
}

function canonicalIds(row: TelemetryRow, identityPlan: CanonicalIdentityPlan) {
  const hostKey = `${String(row.host_type)}:${Number(row.host_id)}`
  const hostItemId = identityPlan.items.get(hostKey)
  if (!hostItemId) throw new Error(`Telemetry references unknown legacy host ${hostKey}.`)
  const agentId = 'device_id' in row ? identityPlan.agents.get(String(Number(row.device_id))) : null
  if ('device_id' in row && !agentId) {
    throw new Error(`Telemetry references unknown legacy agent ${String(row.device_id)}.`)
  }
  return { hostItemId, agentId }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function optionalInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function projectSample(database: Database, row: TelemetryRow) {
  const hostItemId = Number(row.host_item_id)
  const payload = JSON.parse(String(row.payload_json)) as Record<string, any>
  const metrics = payload.metrics ?? {}
  const load = Array.isArray(metrics.loadAverage) ? metrics.loadAverage : []
  database.query(`
    INSERT INTO host_metric_samples (
      sample_id, host_item_id, uptime_seconds, cpu_percent,
      memory_used_bytes, memory_total_bytes, load_1, load_5, load_15
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    hostItemId,
    optionalInteger(metrics.uptimeSeconds),
    optionalNumber(metrics.cpu?.percent),
    optionalInteger(metrics.memory?.usedBytes),
    optionalInteger(metrics.memory?.totalBytes),
    optionalNumber(load[0]),
    optionalNumber(load[1]),
    optionalNumber(load[2]),
  )
  for (const [index, network] of (metrics.network ?? []).entries()) {
    const key = network.name ?? network.interface ?? network.device ?? `network-${index + 1}`
    database.query('INSERT INTO network_interface_samples (sample_id, host_item_id, interface_key, metrics_json) VALUES (?, ?, ?, ?)')
      .run(row.id, hostItemId, String(key), canonicalJson(network))
  }
  for (const [index, storage] of (metrics.diskIo ?? []).entries()) {
    const key = storage.deviceId ?? storage.device ?? storage.name ?? `storage-${index + 1}`
    database.query('INSERT INTO storage_device_samples (sample_id, host_item_id, device_key, metrics_json) VALUES (?, ?, ?, ?)')
      .run(row.id, hostItemId, String(key), canonicalJson(storage))
  }
  for (const [index, filesystem] of (metrics.filesystems ?? []).entries()) {
    const key = filesystem.mountPoint ?? filesystem.mount ?? `filesystem-${index + 1}`
    database.query(`
      INSERT INTO filesystem_samples (
        sample_id, host_item_id, mount_key, device_key, filesystem_type,
        total_bytes, used_bytes, available_bytes, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      hostItemId,
      String(key),
      filesystem.deviceId ?? filesystem.device ?? null,
      filesystem.filesystemType ?? filesystem.type ?? null,
      optionalInteger(filesystem.totalBytes),
      optionalInteger(filesystem.usedBytes),
      optionalInteger(filesystem.availableBytes),
      canonicalJson(filesystem),
    )
  }
}

function sourceSummary(database: Database) {
  const sequenceHash = createHash('sha256')
  const firstPage = database.query(`
    SELECT id, device_id, host_type, host_id, sequence,
      received_at_ms, collected_at_ms, payload_json
    FROM telemetry_samples
    ORDER BY id
    LIMIT ?
  `)
  const nextPage = database.query(`
    SELECT id, device_id, host_type, host_id, sequence,
      received_at_ms, collected_at_ms, payload_json
    FROM telemetry_samples
    WHERE id > ?
    ORDER BY id
    LIMIT ?
  `)
  let lastId: unknown = null
  while (true) {
    const rows = (lastId === null
      ? firstPage.all(MIGRATION_BATCH_SIZE)
      : nextPage.all(lastId, MIGRATION_BATCH_SIZE)) as TelemetryRow[]
    if (rows.length === 0) break
    for (const row of rows) {
      sequenceHash.update(JSON.stringify([
        row.id, row.device_id, row.host_type, row.host_id, row.sequence,
        row.received_at_ms, row.collected_at_ms,
        createHash('sha256').update(String(row.payload_json)).digest('hex'),
      ]))
      sequenceHash.update('\n')
    }
    lastId = rows.at(-1)?.id
  }
  return {
    counts: Object.fromEntries(REFERENCED_TABLES.map((table) => [table, count(database, table)])),
    sequenceHash: sequenceHash.digest('hex'),
  }
}

function forEachBatch(
  database: Database,
  table: string,
  order: readonly string[],
  callback: (rows: TelemetryRow[]) => void,
  batchSize = MIGRATION_BATCH_SIZE,
) {
  const columns = order.join(', ')
  const placeholders = order.map(() => '?').join(', ')
  const firstPage = database.query(`SELECT * FROM ${table} ORDER BY ${columns} LIMIT ?`)
  const nextPage = database.query(`SELECT * FROM ${table} WHERE (${columns}) > (${placeholders}) ORDER BY ${columns} LIMIT ?`)
  let cursor: unknown[] | null = null
  while (true) {
    const rows = (cursor === null
      ? firstPage.all(batchSize)
      : nextPage.all(...cursor, batchSize)) as TelemetryRow[]
    if (rows.length === 0) break
    callback(rows)
    const last = rows.at(-1) as TelemetryRow
    cursor = order.map((column) => last[column])
  }
}

function verifyMigratedTelemetry(database: Database, before: ReturnType<typeof sourceSummary>) {
  const after = sourceSummary(database)
  if (JSON.stringify(after.counts) !== JSON.stringify(before.counts) || after.sequenceHash !== before.sequenceHash) {
    throw new Error('Telemetry migration changed source sample semantics.')
  }
  for (const table of REFERENCED_TABLES) {
    const row = database.query(`SELECT count(*) AS count FROM ${table} WHERE host_item_id IS NULL`).get() as { count: number }
    if (Number(row.count) !== 0) throw new Error(`Telemetry migration left unresolved hosts in ${table}.`)
  }
  for (const table of ['telemetry_samples', 'latest_host_state']) {
    const row = database.query(`SELECT count(*) AS count FROM ${table} WHERE agent_id IS NULL`).get() as { count: number }
    if (Number(row.count) !== 0) throw new Error(`Telemetry migration left unresolved agents in ${table}.`)
  }
  const foreignKeys = database.query('PRAGMA foreign_key_check').all()
  if (foreignKeys.length !== 0) throw new Error('Telemetry migration produced invalid foreign-key relationships.')
  const integrity = database.query('PRAGMA quick_check').get() as { quick_check: string }
  if (integrity.quick_check !== 'ok') throw new Error(`Telemetry migration integrity check failed: ${integrity.quick_check}`)
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
    const before = sourceSummary(sourceDatabase)
    sourceDatabase.exec(`VACUUM INTO ${sqlString(target)}`)
    targetDatabase = await openTelemetryDatabase({ dataDir: dirname(dirname(target)), filePath: target })
    for (const table of REFERENCED_TABLES) {
      const identifiers = ROW_IDENTIFIERS[table as keyof typeof ROW_IDENTIFIERS]
      forEachBatch(targetDatabase, table, identifiers, (rows) => {
        targetDatabase?.transaction(() => {
          for (const row of rows) {
            const { hostItemId, agentId } = canonicalIds(row, identityPlan)
            const where = identifiers.map((column) => `${column} = ?`).join(' AND ')
            const values = identifiers.map((column) => row[column])
            if (table === 'telemetry_samples' || table === 'latest_host_state') {
              targetDatabase?.query(`UPDATE ${table} SET host_item_id = ?, agent_id = ? WHERE ${where}`)
                .run(hostItemId, agentId, ...values)
            } else {
              targetDatabase?.query(`UPDATE ${table} SET host_item_id = ? WHERE ${where}`).run(hostItemId, ...values)
            }
          }
        }).immediate()
      }, table === 'component_events' ? EVENT_MIGRATION_BATCH_SIZE : MIGRATION_BATCH_SIZE)
    }
    targetDatabase.exec(`
        DELETE FROM filesystem_samples;
        DELETE FROM storage_device_samples;
        DELETE FROM network_interface_samples;
        DELETE FROM host_metric_samples;
    `)
    forEachBatch(targetDatabase, 'telemetry_samples', ['id'], (samples) => {
      targetDatabase?.transaction(() => {
        for (const sample of samples) projectSample(targetDatabase as Database, sample)
      }).immediate()
    })
    verifyMigratedTelemetry(targetDatabase, before)
    closeTelemetryDatabase(targetDatabase)
    targetDatabase = null
    await chmod(target, 0o600)
    return { targetPath: target, ...before.counts }
  } catch (error) {
    if (targetDatabase) closeTelemetryDatabase(targetDatabase)
    await rm(target, { force: true }).catch(() => {})
    throw error
  } finally {
    sourceDatabase.close(false)
  }
}
