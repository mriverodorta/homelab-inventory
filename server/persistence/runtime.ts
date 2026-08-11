import { CatalogIndex, CATALOG_INDEX_SCHEMA_VERSION } from '../registry/catalog-index.mjs'
import {
  closeTelemetryDatabase,
  openTelemetryDatabase,
  telemetryDatabaseStatus,
} from '../telemetry/database.mjs'
import { TelemetryRepository } from '../telemetry/repository.mjs'
import { CORE_MIGRATIONS } from './core/migrations/manifest.ts'
import { ensureSqlitePersistence, type EnsureSqlitePersistenceOptions } from './migration/cutover.ts'
import { SqliteHomelabInventoryStore } from './sqlite-store.ts'
import { closeManagedDatabase, openManagedDatabase } from './sqlite/database.ts'

type RuntimeOptions = EnsureSqlitePersistenceOptions & Readonly<{
  projectId?: number
  workspaceId?: number
}>

export async function activateSqliteRuntime(options: RuntimeOptions) {
  const persistence = await ensureSqlitePersistence(options)
  const core = await openManagedDatabase({
    filePath: persistence.paths.core,
    schemaName: 'core',
    maximumSchemaVersion: CORE_MIGRATIONS.length,
  })
  let telemetryDatabase: Awaited<ReturnType<typeof openTelemetryDatabase>> | null = null
  try {
    const store = new SqliteHomelabInventoryStore({
      core,
      dataDir: options.dataDir,
      projectId: options.projectId,
      workspaceId: options.workspaceId,
      appVersion: options.appVersion,
    })
    telemetryDatabase = await openTelemetryDatabase({
      dataDir: options.dataDir,
      filePath: persistence.paths.telemetry,
    })
    const telemetryRepository = new TelemetryRepository(telemetryDatabase)
    const catalogIndex = new CatalogIndex(persistence.paths.catalog)
    if (!catalogIndex.isCurrent()) throw new Error('Catalog SQLite index is not current.')

    const schemas = {
      core: store.getDatabaseStatus().schemaVersion,
      telemetry: telemetryDatabaseStatus(telemetryDatabase).schemaVersion,
      catalog: CATALOG_INDEX_SCHEMA_VERSION,
    }
    return {
      store,
      telemetryDatabase,
      telemetryRepository,
      persistence: { ...persistence, versions: schemas },
      schemas,
      async close() {
        await store.flush()
        closeTelemetryDatabase(telemetryDatabase)
        telemetryDatabase = null
        store.close()
      },
    }
  } catch (error) {
    closeTelemetryDatabase(telemetryDatabase)
    closeManagedDatabase(core)
    throw error
  }
}
