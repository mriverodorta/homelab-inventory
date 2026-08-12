import { Database } from 'bun:sqlite'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
type BackupServiceFactoryOptions = Readonly<{ includeTelemetry: boolean }>
type SnapshotService = Readonly<{
  trustedKeys: readonly unknown[]
  resolveActivePaths(): Promise<null | { snapshot: string, facets?: string | null }>
}>

export type EnsureSqlitePersistenceOptions = Readonly<{
  dataDir: string
  appVersion: string
  legacyProjectPath?: string | null
  seedDir?: string | null
  backupServiceFactory: (options?: BackupServiceFactoryOptions) => BackupService | Promise<BackupService>
  backupPassphrase?: string | null
  snapshotService?: SnapshotService | null
  failAtStage?: CutoverStage | null
  now?: () => Date
}>

const LOCK_MAX_AGE_MS = 30 * 60 * 1000
const MIGRATION_ARCHIVE_SECTIONS = Object.freeze(
  COMPLETE_BACKUP_SECTIONS.filter((section) => section !== 'agentTelemetry'),
)

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
  const directory = join(dataDir, 'backups', 'migrations')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const timestamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const filePath = join(directory, `pre-sqlite-${timestamp}.hlibackup`)
  const telemetryPath = `${filePath}.telemetry.sqlite`
  const manifestPath = `${filePath}.manifest.json`
  let keyPath: string | null = null
  try {
    const telemetry = await createTelemetryMigrationSnapshot({ dataDir, targetPath: telemetryPath })
    const service = await backupServiceFactory({ includeTelemetry: false })
    const generatedPassphrase = backupPassphrase ? null : randomBytes(32).toString('base64url')
    const effectivePassphrase = backupPassphrase ?? generatedPassphrase
    const result = await service.create({
      sections: MIGRATION_ARCHIVE_SECTIONS,
      label: `Pre-SQLite migration ${appVersion}`,
      kind: 'migration',
      passphrase: effectivePassphrase,
      persist: false,
    })
    if (!(result.archive instanceof Uint8Array) || result.archive.byteLength === 0) {
      throw new Error('Pre-migration backup service returned an invalid archive.')
    }
    await writeFile(filePath, result.archive, { mode: 0o600 })
    await chmod(filePath, 0o600)
    const written = await readFile(filePath)
    if (!written.equals(Buffer.from(result.archive))) throw new Error('Pre-migration backup verification failed after writing.')
    if (generatedPassphrase) {
      keyPath = `${filePath}.key`
      await writeFile(keyPath, `${generatedPassphrase}\n`, { mode: 0o600 })
      await chmod(keyPath, 0o600)
    }
    const archiveStat = await stat(filePath)
    await writeFile(manifestPath, `${JSON.stringify({
      version: 1,
      kind: 'pre-sqlite-migration-set',
      createdAt: now.toISOString(),
      applicationVersion: appVersion,
      archive: {
        file: basename(filePath),
        sizeBytes: archiveStat.size,
        sha256: await hashFile(filePath),
        sections: MIGRATION_ARCHIVE_SECTIONS,
      },
      telemetry,
    }, null, 2)}\n`, { mode: 0o600 })
    await chmod(manifestPath, 0o600)
    return {
      filePath,
      keyPath,
      manifestPath,
      telemetryPath: telemetry ? telemetryPath : null,
    }
  } catch (error) {
    await Promise.all([
      rm(filePath, { force: true }),
      rm(`${filePath}.key`, { force: true }),
      rm(telemetryPath, { force: true }),
      rm(manifestPath, { force: true }),
    ])
    throw error
  }
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function hashFile(filePath: string) {
  return new Promise<string>((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectHash)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function createTelemetryMigrationSnapshot({ dataDir, targetPath }: { dataDir: string, targetPath: string }) {
  const sourcePath = join(dataDir, TELEMETRY_DATABASE_RELATIVE_PATH)
  try {
    await stat(sourcePath)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  await rm(targetPath, { force: true })
  const source = new Database(sourcePath, { readonly: true, strict: true })
  try {
    const integrity = source.query('PRAGMA quick_check').get() as { quick_check: string }
    if (integrity.quick_check !== 'ok') throw new Error(`Telemetry backup source integrity check failed: ${integrity.quick_check}`)
    source.exec(`VACUUM INTO ${sqlString(targetPath)}`)
  } finally {
    source.close(false)
  }
  await chmod(targetPath, 0o600)
  const snapshot = new Database(targetPath, { readonly: true, strict: true })
  let schemaVersion = 0
  try {
    const integrity = snapshot.query('PRAGMA quick_check').get() as { quick_check: string }
    if (integrity.quick_check !== 'ok') throw new Error(`Telemetry backup integrity check failed: ${integrity.quick_check}`)
    schemaVersion = Number((snapshot.query('PRAGMA user_version').get() as { user_version: number }).user_version)
  } finally {
    snapshot.close(false)
  }
  const snapshotStat = await stat(targetPath)
  return {
    file: basename(targetPath),
    sizeBytes: snapshotStat.size,
    sha256: await hashFile(targetPath),
    schemaVersion,
  }
}

async function migrateCore(stagingPath: string, snapshot: Record<string, any>, appVersion: string) {
  const handle = await openManagedDatabase({ filePath: stagingPath, schemaName: 'core' })
  try {
    await applyCommittedMigrations(handle, await committedCoreMigrations(), { applicationVersion: appVersion })
    const identityPlan = buildCanonicalIdentityPlan(snapshot)
    importLegacyCore({ database: handle.database, snapshot, identityPlan })
    verifyImportedCore({ database: handle.database, expected: legacySemanticSnapshot(snapshot) })
    return identityPlan
  } finally {
    closeManagedDatabase(handle)
  }
}

async function committedCoreMigrations() {
  const migrationsDir = resolve(import.meta.dir, '../core/migrations/generated')
  return Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(join(migrationsDir, migration.file), 'utf8'),
  })))
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

function sha256(body: Uint8Array) {
  return createHash('sha256').update(body).digest('hex')
}

async function createActivatedDatabaseBackup({
  dataDir,
  paths,
  now,
}: {
  dataDir: string
  paths: Record<'core' | 'telemetry' | 'catalog', string>
  now: Date
}) {
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const directory = join(dataDir, 'backups', 'migrations', `sqlite-upgrade-${stamp}`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const files: Record<string, { file: string, sizeBytes: number, sha256: string }> = {}
  try {
    for (const name of ['core', 'telemetry', 'catalog'] as const) {
      const checkpoint = new Database(paths[name], { strict: true })
      try {
        checkpoint.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      } finally {
        checkpoint.close(false)
      }
      const file = `${name}.sqlite`
      const target = join(directory, file)
      await copyFile(paths[name], target)
      await chmod(target, 0o600)
      const body = await readFile(target)
      files[name] = { file, sizeBytes: body.length, sha256: sha256(body) }
    }
    const manifestPath = join(directory, 'manifest.json')
    await writeFile(manifestPath, `${JSON.stringify({
      version: 1,
      kind: 'sqlite-upgrade',
      createdAt: now.toISOString(),
      files,
    }, null, 2)}\n`, { mode: 0o600 })
    for (const entry of Object.values(files)) {
      const body = await readFile(join(directory, entry.file))
      if (body.length !== entry.sizeBytes || sha256(body) !== entry.sha256) {
        throw new Error(`SQLite migration backup verification failed for ${entry.file}.`)
      }
    }
    return { directory, manifestPath }
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
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

async function upgradeActivatedDatabases({
  dataDir,
  marker,
  paths,
  options,
}: {
  dataDir: string
  marker: PersistenceActivationMarker
  paths: Record<'core' | 'telemetry' | 'catalog', string>
  options: EnsureSqlitePersistenceOptions
}) {
  const now = options.now?.() ?? new Date()
  const current = {
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
    if (current[name] > expected[name]) {
      throw new Error(`${name} SQLite schema ${current[name]} is newer than supported schema ${expected[name]}.`)
    }
  }
  if ((['core', 'telemetry', 'catalog'] as const).every((name) => current[name] === expected[name])) {
    const markerMatches = (['core', 'telemetry', 'catalog'] as const)
      .every((name) => marker.databases[name].schemaVersion === current[name])
    if (markerMatches) {
      const verified = await verifyActiveMarker(dataDir, marker)
      await rm(join(dataDir, 'databases', 'persistence-migration-failure.json'), { force: true })
      return { migrated: false, marker, ...verified }
    }
    const reconciledMarker: PersistenceActivationMarker = {
      ...marker,
      applicationVersion: options.appVersion,
      databases: {
        core: { ...marker.databases.core, schemaVersion: current.core },
        telemetry: { ...marker.databases.telemetry, schemaVersion: current.telemetry },
        catalog: { ...marker.databases.catalog, schemaVersion: current.catalog },
      },
    }
    await writeActivationMarker(dataDir, reconciledMarker)
    await rm(join(dataDir, 'databases', 'persistence-migration-failure.json'), { force: true })
    return { migrated: false, markerReconciled: true, marker: reconciledMarker, paths, versions: current }
  }

  const lock = await acquireLock(dataDir, now)
  const failurePath = join(dataDir, 'databases', 'persistence-migration-failure.json')
  let backup: Awaited<ReturnType<typeof createActivatedDatabaseBackup>> | null = null
  try {
    backup = await createActivatedDatabaseBackup({ dataDir, paths, now })
    const core = await openManagedDatabase({
      filePath: paths.core,
      schemaName: 'core',
      maximumSchemaVersion: CORE_MIGRATIONS.length,
    })
    try {
      await applyCommittedMigrations(core, await committedCoreMigrations(), {
        applicationVersion: options.appVersion,
      })
    } finally {
      closeManagedDatabase(core)
    }

    const telemetry = await openTelemetryDatabase({ dataDir, filePath: paths.telemetry })
    closeTelemetryDatabase(telemetry)

    if (current.catalog < expected.catalog) {
      const temporaryCatalog = `${paths.catalog}.${randomUUID()}.upgrade`
      try {
        await rebuildCatalog(temporaryCatalog, options.snapshotService)
        await prepareDatabaseForAtomicMove(temporaryCatalog)
        await rm(paths.catalog, { force: true })
        await rename(temporaryCatalog, paths.catalog)
      } finally {
        await rm(temporaryCatalog, { force: true }).catch(() => {})
      }
    }

    const versions = await verifyDatabaseSet(paths)
    const updatedMarker: PersistenceActivationMarker = {
      ...marker,
      applicationVersion: options.appVersion,
      databases: {
        core: { ...marker.databases.core, schemaVersion: versions.core },
        telemetry: { ...marker.databases.telemetry, schemaVersion: versions.telemetry },
        catalog: { ...marker.databases.catalog, schemaVersion: versions.catalog },
      },
    }
    await writeActivationMarker(dataDir, updatedMarker)
    await rm(failurePath, { force: true })
    return {
      migrated: true,
      marker: updatedMarker,
      paths,
      versions,
      upgradeBackup: backup.directory,
    }
  } catch (error) {
    await mkdir(dirname(failurePath), { recursive: true, mode: 0o700 })
    await writeFile(failurePath, `${JSON.stringify({
      version: 1,
      failedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      ...(backup ? { backupPath: relativeDataPath(dataDir, backup.directory) } : {}),
    }, null, 2)}\n`, { mode: 0o600 })
    throw error
  } finally {
    await lock.release()
  }
}

export async function ensureSqlitePersistence(options: EnsureSqlitePersistenceOptions) {
  const dataDir = resolve(options.dataDir)
  const failurePath = join(dataDir, 'databases', 'persistence-migration-failure.json')
  const existing = await readActivationMarker(dataDir)
  if (existing) {
    const paths = markerDatabasePaths(dataDir, existing)
    const activated = await upgradeActivatedDatabases({ dataDir, marker: existing, paths, options })
    return { ok: true, status: 'active', ...activated }
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
      backupSetManifestPath: relativeDataPath(dataDir, backup.manifestPath),
      ...(backup.telemetryPath ? { backupTelemetryPath: relativeDataPath(dataDir, backup.telemetryPath) } : {}),
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
