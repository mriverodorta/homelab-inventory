import path from 'node:path'
import { HomelabInventoryStore } from '../db/store.mjs'
import { readAuthRuntimeConfig } from './config.mjs'
import { SessionService } from './session-service.mjs'
import { AuthService } from './auth-service.mjs'

const dataDir = process.env.DATA_DIR ?? path.resolve('data')
const store = new HomelabInventoryStore({
  appVersion: 'recovery-cli', dataDir, legacyProjectPath: path.join(dataDir, 'homelab-inventory-project.json'),
  seedEmptyData: false, seedDir: path.resolve('server/seed'),
})
await store.init()
const runtime = await readAuthRuntimeConfig({ dataDir, log() {} })
const sessions = new SessionService({ store, externalUrl: runtime.externalUrl })
const service = new AuthService({ store, sessionService: sessions, runtime })
const grant = await service.createRecoveryGrant()
const origin = runtime.externalUrl || `http://127.0.0.1:${process.env.PORT ?? '8798'}`
console.log(`Owner recovery URL (valid for 15 minutes):\n${origin}/?recovery=${encodeURIComponent(grant.token)}`)
await store.flush()
