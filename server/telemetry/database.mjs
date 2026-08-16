import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { migrateTelemetrySchema, TELEMETRY_SCHEMA_VERSION } from './schema.mjs'

const sqliteModule = ['bun', 'sqlite'].join(':')
const { Database } = await import(sqliteModule)

export const TELEMETRY_DATABASE_RELATIVE_PATH = path.join('telemetry', 'telemetry.sqlite')

function assertDatabaseIntegrity(database) {
  const result = database.query('PRAGMA quick_check').get()
  if (result?.quick_check !== 'ok') {
    throw new Error(`Telemetry database integrity check failed: ${String(result?.quick_check ?? 'unknown')}`)
  }
}

async function exists(filePath) {
  try { await fs.access(filePath); return true } catch { return false }
}

async function fileHash(filePath) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) digest.update(chunk)
  return digest.digest('hex')
}

function schemaVersion(database) {
  return Number(database.query('PRAGMA user_version').get().user_version)
}

async function compactTelemetryDatabaseIfNeeded(resolvedPath) {
  const targetPath = `${resolvedPath}.compact-v3.tmp`
  const rollbackPath = `${resolvedPath}.schema-v2.rollback`
  const manifestPath = `${resolvedPath}.compact-v3.json`

  if (!await exists(resolvedPath) && await exists(rollbackPath)) await fs.rename(rollbackPath, resolvedPath)
  if (!await exists(resolvedPath)) return
  let source = new Database(resolvedPath, { create: false, strict: true })
  const current = schemaVersion(source)
  if (current >= TELEMETRY_SCHEMA_VERSION) {
    source.close(false)
    await fs.rm(targetPath, { force: true })
    await fs.rm(rollbackPath, { force: true })
    await fs.rm(manifestPath, { force: true })
    return
  }
  source.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  assertDatabaseIntegrity(source)
  source.close(false)
  source = null

  await fs.rm(targetPath, { force: true })
  let target
  try {
    target = new Database(targetPath, { create: true, strict: true })
    target.exec('PRAGMA foreign_keys = ON;')
    migrateTelemetrySchema(target)
    target.query('ATTACH DATABASE ? AS legacy').run(resolvedPath)
    for (const table of [
      'latest_virtualization_state', 'virtualization_events', 'manual_inventory_reports',
      'manual_inventory_components', 'agent_field_suggestions',
    ]) {
      const present = target.query("SELECT 1 FROM legacy.sqlite_master WHERE type = 'table' AND name = ?").get(table)
      if (present) target.exec(`INSERT INTO main.${table} SELECT * FROM legacy.${table};`)
    }
    target.exec('DETACH DATABASE legacy;')
    target.exec('VACUUM;')
    assertDatabaseIntegrity(target)
    if (schemaVersion(target) !== TELEMETRY_SCHEMA_VERSION) throw new Error('Compacted telemetry schema was not activated.')
    target.close(false)
    target = null
    const manifest = {
      sourceSchemaVersion: current,
      targetSchemaVersion: TELEMETRY_SCHEMA_VERSION,
      sourceSha256: await fileHash(resolvedPath),
      targetSha256: await fileHash(targetPath),
      preparedAt: new Date().toISOString(),
    }
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    await fs.rm(rollbackPath, { force: true })
    await fs.rename(resolvedPath, rollbackPath)
    await fs.rename(targetPath, resolvedPath)

    const activated = new Database(resolvedPath, { create: false, strict: true })
    assertDatabaseIntegrity(activated)
    if (schemaVersion(activated) !== TELEMETRY_SCHEMA_VERSION) throw new Error('Activated telemetry database has the wrong schema.')
    activated.close(false)
    await fs.rm(rollbackPath, { force: true })
    await fs.rm(manifestPath, { force: true })
  } catch (error) {
    target?.close(false)
    if (!await exists(resolvedPath) && await exists(rollbackPath)) await fs.rename(rollbackPath, resolvedPath)
    await fs.rm(targetPath, { force: true })
    throw error
  }
}

export async function openTelemetryDatabase({ dataDir, filePath } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new Error('Telemetry data directory is required.')
  const resolvedPath = filePath ?? path.join(dataDir, TELEMETRY_DATABASE_RELATIVE_PATH)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true, mode: 0o700 })

  let database
  try {
    await compactTelemetryDatabaseIfNeeded(resolvedPath)
    database = new Database(resolvedPath, { create: true, strict: true })
    database.exec('PRAGMA busy_timeout = 5000;')
    assertDatabaseIntegrity(database)
    database.exec('PRAGMA foreign_keys = ON;')
    database.exec('PRAGMA journal_mode = WAL;')
    database.exec('PRAGMA synchronous = NORMAL;')
    database.exec('PRAGMA wal_autocheckpoint = 1000;')
    migrateTelemetrySchema(database)
    await fs.chmod(resolvedPath, 0o600)
    return database
  } catch (error) {
    database?.close(false)
    throw new Error(`Unable to initialize telemetry database: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}

export function telemetryDatabaseStatus(database) {
  return {
    schemaVersion: Number(database.query('PRAGMA user_version').get().user_version),
    journalMode: String(database.query('PRAGMA journal_mode').get().journal_mode).toLowerCase(),
    expectedSchemaVersion: TELEMETRY_SCHEMA_VERSION,
  }
}

export function closeTelemetryDatabase(database) {
  if (!database) return
  database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  database.close(false)
}
