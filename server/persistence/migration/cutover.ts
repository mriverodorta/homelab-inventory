import { Database } from 'bun:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { COMPLETE_BACKUP_SECTIONS } from '../../../shared/backup/contract.mjs'
import { CatalogIndex, CATALOG_INDEX_SCHEMA_VERSION } from '../../registry/catalog-index.mjs'
import {
  closeTelemetryDatabase,
  openTelemetryDatabase,
  TELEMETRY_DATABASE_RELATIVE_PATH,
} from '../../telemetry/database.mjs'
import { TELEMETRY_SCHEMA_VERSION } from '../../telemetry/schema.mjs'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { buildCanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { legacySemanticSnapshot } from '../legacy/semantic-snapshot.ts'
import { LEGACY_SCHEMA_VERSION, readLatestLegacySnapshot } from '../legacy/snapshot-reader.ts'
import { closeManagedDatabase, openManagedDatabase } from '../sqlite/database.ts'
import { applyCommittedMigrations } from '../sqlite/migrator.ts'
import {
  markerDatabasePaths,
  readActivationMarker,
  relativeDataPath,
  writeActivationMarker,
  type PersistenceActivationMarker,
} from './activation-marker.ts'
import { rebuildVerifiedCatalog } from './catalog-rebuilder.ts'
import { importLegacyCore } from './core-importer.ts'
import { verifyImportedCore } from './core-verifier.ts'
import { migrateTelemetryReferences } from './telemetry-importer.ts'

export const CUTOVER_STAGES = Object.freeze([
  'backup',
  'snapshot',
  'core',
  'telemetry',
  'catalog',
  'verify',
  'activate',
  'marker',
] as const)

type CutoverStage = typeof CUTOVER_STAGES[number]

type BackupResult = Readonly<{ archive: Uint8Array, manifest?: unknown }>
type BackupService = Readonly<{
  create(options: Record<string, unknown>): Promise<BackupResult>
}>
type SnapshotService = Readonly<{
  trustedKeys: readonly unknown[]
  resolveActivePaths(): Promise<null | { snapshot: string, facets?: string | null }>
}>

export type EnsureSqlitePersistenceOptions = Readonly<{
  dataDir: string
  appVersion: string
  legacyProjectPath?: string | null
  seedDir?: string | null
  backupServiceFactory: () => BackupService | Promise<BackupService>
  backupPassphrase?: string | null
  snapshotService?: SnapshotService | null
  failAtStage?: CutoverStage | null
  now?: () => Date
}>

const LOCK_MAX_AGE_MS = 30 * 60 * 1000

function stageFailure(stage: CutoverStage, configured?: CutoverStage | null) {
  if (configured === stage) throw new Error(`Injected persistence migration failure at ${stage}.`)
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    return error?.code === 'EPERM'
  }
}

async function acquireLock(dataDir: string, now: Date) {
  const lockPath = join(dataDir, '.sqlite-migration.lock')
  const token = randomUUID()
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  try {
    const handle = await open(lockPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify({ version: 1, token, pid: process.pid, startedAt: now.toISOString() })}\n`)
    await handle.close()
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error
    let stale = false
    try {
      const existing = JSON.parse(await readFile(lockPath, 'utf8'))
      const startedAt = Date.parse(existing.startedAt)
      stale = !Number.isSafeInteger(existing.pid)
        || !Number.isFinite(startedAt)
        || now.getTime() - startedAt > LOCK_MAX_AGE_MS
        || !processExists(existing.pid)
    } catch {
      stale = true
    }
    if (!stale) throw new Error('A SQLite persistence migration is already running.')
    await rm(lockPath, { force: true })
    return acquireLock(dataDir, now)
  }
  return {
    path: lockPath,
    async release() {
      try {
        const existing = JSON.parse(await readFile(lockPath, 'utf8'))
        if (existing.token === token) await rm(lockPath, { force: true })
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error
      }
    },
  }
}

async function createMigrationBackup({
  dataDir,
  appVersion,
  backupServiceFactory,
  backupPassphrase,
  now,
}: Pick<EnsureSqlitePersistenceOptions, 'dataDir' | 'appVersion' | 'backupServiceFactory' | 'backupPassphrase'> & { now: Date }) {
  const service = await backupServiceFactory()
  const generatedPassphrase = backupPassphrase ? null : randomBytes(32).toString('base64url')
  const effectivePassphrase = backupPassphrase ?? generatedPassphrase
  const result = await service.create({
    sections: COMPLETE_BACKUP_SECTIONS,
    label: `Pre-SQLite migration ${appVersion}`,
    kind: 'migration',
    passphrase: effectivePassphrase,
    persist: false,
  })
  if (!(result.archive instanceof Uint8Array) || result.archive.byteLength === 0) {
    throw new Error('Pre-migration backup service returned an invalid archive.')
  }
  const directory = join(dataDir, 'backups', 'migrations')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const timestamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const filePath = join(directory, `pre-sqlite-${timestamp}.hlibackup`)
  await writeFile(filePath, result.archive, { mode: 0o600 })
  await chmod(filePath, 0o600)
  const written = await readFile(filePath)
  if (!written.equals(Buffer.from(result.archive))) throw new Error('Pre-migration backup verification failed after writing.')
  let keyPath = null
  if (generatedPassphrase) {
    keyPath = `${filePath}.key`
    await writeFile(keyPath, `${generatedPassphrase}\n`, { mode: 0o600 })
    await chmod(keyPath, 0o600)
  }
  return { filePath, keyPath }
}

async function migrateCore(stagingPath: string, snapshot: Record<string, any>, appVersion: string) {
  const handle = await openManagedDatabase({ filePath: stagingPath, schemaName: 'core' })
  try {
    const migrationsDir = resolve(import.meta.dir, '../core/migrations/generated')
    await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
      id: migration.id,
      sha256: migration.sha256,
      sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
    }))), { applicationVersion: appVersion })
    const identityPlan = buildCanonicalIdentityPlan(snapshot)
    importLegacyCore({ database: handle.database, snapshot, identityPlan })
    verifyImportedCore({ database: handle.database, expected: legacySemanticSnapshot(snapshot) })
    return identityPlan
  } finally {
    closeManagedDatabase(handle)
  }
}

async function migrateTelemetry(dataDir: string, stagingPath: string, identityPlan: ReturnType<typeof buildCanonicalIdentityPlan>) {
  const sourcePath = join(dataDir, TELEMETRY_DATABASE_RELATIVE_PATH)
  try {
    await stat(sourcePath)
    return migrateTelemetryReferences({ sourcePath, targetPath: stagingPath, identityPlan })
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
    const database = await openTelemetryDatabase({ dataDir, filePath: stagingPath })
    closeTelemetryDatabase(database)
    return { targetPath: stagingPath, telemetry_samples: 0 }
  }
}

async function rebuildCatalog(stagingPath: string, snapshotService?: SnapshotService | null) {
  if (snapshotService && await snapshotService.resolveActivePaths()) {
    return rebuildVerifiedCatalog({ snapshotService, targetPath: stagingPath })
  }
  const snapshot = { catalogRevision: 0, templates: [] }
  const index = new CatalogIndex(stagingPath)
  await index.rebuild(snapshot, stagingPath, null)
  index.verify(snapshot, null)
  await chmod(stagingPath, 0o600)
  return { targetPath: stagingPath, catalogRevision: 0, templateCount: 0 }
}

function sqliteVersion(filePath: string) {
  // WAL databases may need to recreate shared-memory files after an atomic move.
  const database = new Database(filePath, { strict: true })
  try {
    const integrity = database.query('PRAGMA quick_check').get() as { quick_check: string }
    if (integrity.quick_check !== 'ok') throw new Error(`${basename(filePath)} integrity check failed: ${integrity.quick_check}`)
    return Number((database.query('PRAGMA user_version').get() as { user_version: number }).user_version)
  } finally {
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    database.close(false)
  }
}

async function verifyDatabaseSet(paths: Record<'core' | 'telemetry' | 'catalog', string>) {
  const versions = {
    core: sqliteVersion(paths.core),
    telemetry: sqliteVersion(paths.telemetry),
    catalog: sqliteVersion(paths.catalog),
  }
  const expected = {
    core: CORE_MIGRATIONS.length,
    telemetry: TELEMETRY_SCHEMA_VERSION,
    catalog: CATALOG_INDEX_SCHEMA_VERSION,
  }
  for (const name of ['core', 'telemetry', 'catalog'] as const) {
    if (versions[name] > expected[name]) throw new Error(`${name} SQLite schema ${versions[name]} is newer than supported schema ${expected[name]}.`)
    if (versions[name] !== expected[name]) throw new Error(`${name} SQLite schema ${versions[name]} does not match required schema ${expected[name]}.`)
    if (((await stat(paths[name])).mode & 0o777) !== 0o600) throw new Error(`${name} SQLite database permissions are not private.`)
  }
  return versions
}

async function prepareDatabaseForAtomicMove(filePath: string) {
  const portable = `${filePath}.portable`
  await rm(portable, { force: true })
  const database = new Database(filePath, { strict: true })
  try {
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    database.exec(`VACUUM INTO '${portable.replaceAll("'", "''")}'`)
  } finally {
    database.close(false)
  }
  await rm(filePath, { force: true })
  await Promise.all([
    rm(`${filePath}-wal`, { force: true }),
    rm(`${filePath}-shm`, { force: true }),
  ])
  await rename(portable, filePath)
  await chmod(filePath, 0o600)
}

async function verifyActiveMarker(dataDir: string, marker: PersistenceActivationMarker) {
  const paths = markerDatabasePaths(dataDir, marker)
  const versions = await verifyDatabaseSet(paths)
  for (const name of ['core', 'telemetry', 'catalog'] as const) {
    if (marker.databases[name].schemaVersion !== versions[name]) {
      throw new Error(`Persistence marker ${name} schema does not match its database.`)
    }
  }
  return { paths, versions }
}

export async function ensureSqlitePersistence(options: EnsureSqlitePersistenceOptions) {
  const dataDir = resolve(options.dataDir)
  const failurePath = join(dataDir, 'databases', 'persistence-migration-failure.json')
  const existing = await readActivationMarker(dataDir)
  if (existing) {
    const verified = await verifyActiveMarker(dataDir, existing)
    await rm(failurePath, { force: true })
    return { ok: true, status: 'active', migrated: false, marker: existing, ...verified }
  }

  const now = options.now?.() ?? new Date()
  const lock = await acquireLock(dataDir, now)
  const stagingRoot = join(dataDir, '.sqlite-migration', randomUUID())
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
  try {
    const backup = await createMigrationBackup({ ...options, dataDir, now })
    stageFailure('backup', options.failAtStage)

    const snapshot = await readLatestLegacySnapshot(dataDir)
    stageFailure('snapshot', options.failAtStage)

    const staged = {
      core: join(stagingRoot, 'homelab-inventory.sqlite'),
      telemetry: join(stagingRoot, 'telemetry.sqlite'),
      catalog: join(stagingRoot, 'catalog.sqlite'),
    }
    const identityPlan = await migrateCore(staged.core, snapshot, options.appVersion)
    stageFailure('core', options.failAtStage)
    await migrateTelemetry(dataDir, staged.telemetry, identityPlan)
    stageFailure('telemetry', options.failAtStage)
    await rebuildCatalog(staged.catalog, options.snapshotService)
    stageFailure('catalog', options.failAtStage)

    const versions = await verifyDatabaseSet(staged)
    stageFailure('verify', options.failAtStage)

    const databaseDirectory = join(dataDir, 'databases')
    await mkdir(databaseDirectory, { recursive: true, mode: 0o700 })
    const active = {
      core: join(databaseDirectory, 'homelab-inventory.sqlite'),
      telemetry: join(databaseDirectory, 'telemetry.sqlite'),
      catalog: join(databaseDirectory, 'catalog.sqlite'),
    }
    for (const name of ['core', 'telemetry', 'catalog'] as const) {
      await prepareDatabaseForAtomicMove(staged[name])
      await rm(`${active[name]}-wal`, { force: true })
      await rm(`${active[name]}-shm`, { force: true })
      await rename(staged[name], active[name])
    }
    stageFailure('activate', options.failAtStage)
    await verifyDatabaseSet(active)

    const marker: PersistenceActivationMarker = {
      version: 1,
      engine: 'sqlite',
      status: 'active',
      applicationVersion: options.appVersion,
      activatedAt: now.toISOString(),
      sourceSchemaVersion: Number(snapshot.meta?.schemaVersion ?? LEGACY_SCHEMA_VERSION),
      backupPath: relativeDataPath(dataDir, backup.filePath),
      ...(backup.keyPath ? { backupKeyPath: relativeDataPath(dataDir, backup.keyPath) } : {}),
      databases: {
        core: { path: relativeDataPath(dataDir, active.core), schemaVersion: versions.core },
        telemetry: { path: relativeDataPath(dataDir, active.telemetry), schemaVersion: versions.telemetry },
        catalog: { path: relativeDataPath(dataDir, active.catalog), schemaVersion: versions.catalog },
      },
    }
    stageFailure('marker', options.failAtStage)
    await writeActivationMarker(dataDir, marker)
    await rm(failurePath, { force: true })
    await rm(dirname(stagingRoot), { recursive: true, force: true })
    return { ok: true, status: 'active', migrated: true, marker, paths: active, versions }
  } catch (error) {
    await rm(dirname(stagingRoot), { recursive: true, force: true }).catch(() => {})
    await mkdir(dirname(failurePath), { recursive: true, mode: 0o700 })
    await writeFile(failurePath, `${JSON.stringify({
      version: 1,
      failedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`, { mode: 0o600 })
    throw error
  } finally {
    await lock.release()
  }
}
