import path from 'node:path'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { markerDatabasePaths, readActivationMarker } from '../persistence/migration/activation-marker.ts'
import { SqliteHomelabInventoryStore } from '../persistence/sqlite-store.ts'
import { openManagedDatabase } from '../persistence/sqlite/database.ts'
import { readAuthRuntimeConfig } from './config.mjs'
import { SessionService } from './session-service.mjs'
import { AuthService } from './auth-service.mjs'

const dataDir = process.env.DATA_DIR ?? path.resolve('data')
const marker = await readActivationMarker(dataDir)
if (!marker) {
  throw new Error('SQLite persistence is not active. Start the application once before running owner recovery.')
}
const paths = markerDatabasePaths(dataDir, marker)
const core = await openManagedDatabase({
  filePath: paths.core,
  schemaName: 'core',
  maximumSchemaVersion: CORE_MIGRATIONS.length,
})
const store = new SqliteHomelabInventoryStore({ core, dataDir, appVersion: 'recovery-cli' })
try {
  if (store.getDatabaseStatus().schemaVersion !== CORE_MIGRATIONS.length) {
    throw new Error('SQLite persistence requires migration. Start the application before running owner recovery.')
  }
  const runtime = await readAuthRuntimeConfig({ dataDir, log() {} })
  const sessions = new SessionService({ store, externalUrl: runtime.externalUrl })
  const service = new AuthService({ store, sessionService: sessions, runtime })
  const grant = await service.createRecoveryGrant()
  const origin = runtime.externalUrl || `http://127.0.0.1:${process.env.PORT ?? '8798'}`
  console.log(`Owner recovery URL (valid for 15 minutes):\n${origin}/?recovery=${encodeURIComponent(grant.token)}`)
  await store.flush()
} finally {
  store.close()
}
