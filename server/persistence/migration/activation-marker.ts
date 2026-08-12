import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

export const PERSISTENCE_MARKER_VERSION = 1
export const PERSISTENCE_MARKER_RELATIVE_PATH = 'databases/persistence-engine.json'

export type PersistenceActivationMarker = Readonly<{
  version: 1
  engine: 'sqlite'
  status: 'active'
  applicationVersion: string
  activatedAt: string
  sourceSchemaVersion: number
  backupPath: string
  backupKeyPath?: string
  backupSetManifestPath?: string
  backupTelemetryPath?: string
  databases: Readonly<{
    core: Readonly<{ path: string, schemaVersion: number }>
    telemetry: Readonly<{ path: string, schemaVersion: number }>
    catalog: Readonly<{ path: string, schemaVersion: number }>
  }>
}>

function validRelativePath(value: unknown) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.split('/').includes('..')
}

export function validateActivationMarker(value: unknown): PersistenceActivationMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Persistence activation marker is invalid.')
  const marker = value as Record<string, any>
  if (marker.version !== PERSISTENCE_MARKER_VERSION || marker.engine !== 'sqlite' || marker.status !== 'active') {
    throw new Error('Persistence activation marker version or state is unsupported.')
  }
  if (typeof marker.applicationVersion !== 'string' || !marker.applicationVersion) throw new Error('Persistence activation marker application version is invalid.')
  if (!Number.isFinite(Date.parse(marker.activatedAt))) throw new Error('Persistence activation marker timestamp is invalid.')
  if (!Number.isSafeInteger(marker.sourceSchemaVersion) || marker.sourceSchemaVersion < 0) throw new Error('Persistence activation marker source schema is invalid.')
  if (!validRelativePath(marker.backupPath)) throw new Error('Persistence activation marker backup path is invalid.')
  if (marker.backupKeyPath !== undefined && !validRelativePath(marker.backupKeyPath)) {
    throw new Error('Persistence activation marker backup key path is invalid.')
  }
  if (marker.backupSetManifestPath !== undefined && !validRelativePath(marker.backupSetManifestPath)) {
    throw new Error('Persistence activation marker backup set manifest path is invalid.')
  }
  if (marker.backupTelemetryPath !== undefined && !validRelativePath(marker.backupTelemetryPath)) {
    throw new Error('Persistence activation marker telemetry backup path is invalid.')
  }
  for (const name of ['core', 'telemetry', 'catalog']) {
    const database = marker.databases?.[name]
    if (!database || !validRelativePath(database.path) || !Number.isSafeInteger(database.schemaVersion) || database.schemaVersion < 0) {
      throw new Error(`Persistence activation marker ${name} database is invalid.`)
    }
  }
  return marker as PersistenceActivationMarker
}

export async function readActivationMarker(dataDir: string) {
  const markerPath = resolve(dataDir, PERSISTENCE_MARKER_RELATIVE_PATH)
  try {
    return validateActivationMarker(JSON.parse(await readFile(markerPath, 'utf8')))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function writeActivationMarker(dataDir: string, marker: PersistenceActivationMarker) {
  const valid = validateActivationMarker(marker)
  const markerPath = resolve(dataDir, PERSISTENCE_MARKER_RELATIVE_PATH)
  await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 })
  const temporary = `${markerPath}.${process.pid}-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, markerPath)
    await chmod(markerPath, 0o600)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
  return valid
}

export function markerDatabasePaths(dataDir: string, marker: PersistenceActivationMarker) {
  return Object.fromEntries(Object.entries(marker.databases).map(([name, database]) => [
    name,
    resolve(dataDir, database.path),
  ])) as Record<'core' | 'telemetry' | 'catalog', string>
}

export function relativeDataPath(dataDir: string, filePath: string) {
  const value = relative(resolve(dataDir), resolve(filePath)).replaceAll('\\', '/')
  if (!validRelativePath(value)) throw new Error('Persistence path must remain inside the data directory.')
  return value
}
