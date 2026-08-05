import express from 'express'
import { rateLimit } from 'express-rate-limit'
import fs from 'node:fs/promises'
import helmet from 'helmet'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_NOTES } from '../src/release-notes.ts'
import { registerAgentRoutes } from './agent-routes.mjs'
import { registerBackupRoutes } from './backup-routes.mjs'
import { AuthService } from './auth/auth-service.mjs'
import { AccessService } from './auth/access-service.mjs'
import { registerAccessRoutes } from './auth/access-routes.mjs'
import { createAuthorizationGuard } from './auth/api-permissions.mjs'
import { AuthorizationService } from './auth/authorization-service.mjs'
import { readAuthRuntimeConfig } from './auth/config.mjs'
import { InvitationService } from './auth/invitation-service.mjs'
import { createAuthenticationGuard } from './auth/middleware.mjs'
import { OidcService } from './auth/oidc-service.mjs'
import { registerAuthenticationRoutes } from './auth/routes.mjs'
import { SessionService } from './auth/session-service.mjs'
import { BackupScheduler } from './backup/backup-scheduler.mjs'
import { BackupService } from './backup/backup-service.mjs'
import { apiErrorHandler } from './api-error-handler.mjs'
import { applicationHealth } from './app-health.mjs'
import { HomelabInventoryStore } from './db/store.mjs'
import { EngineCommandService } from './engine/command-service.mjs'
import { ServerEngineRuntime } from './engine/runtime.mjs'
import { EngineSseHub } from './engine/sse-hub.mjs'
import { registerEngineRoutes } from './engine-routes.mjs'
import { registerInventoryRoutes } from './inventory-routes.mjs'
import { registerOnboardingRoutes } from './onboarding-routes.mjs'
import { registerProjectRoutes } from './project-routes.mjs'
import { registerRegistryRoutes } from './registry-routes.mjs'
import { registerRoutingCacheRoutes } from './routing-cache-routes.mjs'
import { browserMutationGuard } from './request-security.mjs'
import { readRuntimeConfig } from './runtime-config.mjs'
import { gracefullyStopServer } from './server-lifecycle.mjs'
import {
  CatalogRefreshCoordinator,
  readCatalogRefreshInterval,
} from './registry/catalog-refresh-coordinator.mjs'
import { ContributionDeliveryService } from './registry/contribution-delivery.mjs'
import { InstallationIdentityService } from './registry/installation-identity.mjs'
import { SnapshotService } from './registry/snapshot-service.mjs'
import {
  createRateLimitOptions,
  readRateLimitConfig,
  shouldEnableRateLimit,
} from './rate-limit.mjs'
import { DockerHubUpdateChecker } from './update-checker.mjs'
import { registerUpdateRoutes } from './update-routes.mjs'
import { startUpdateCheckSchedule } from './update-scheduler.mjs'
import { storeRequestError } from './store-request-error.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProduction = process.env.NODE_ENV === 'production'
const runtimeConfig = readRuntimeConfig()
const appMode = runtimeConfig.appMode
const isDemoMode = appMode === 'demo'
const port = runtimeConfig.port
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const demoSourceDir = process.env.DEMO_SOURCE_DIR ?? '/read-only-data'
const demoSessionMinutes = runtimeConfig.demoSessionMinutes
const demoMaxSessions = runtimeConfig.demoMaxSessions
const saveDebounceMs = runtimeConfig.saveDebounceMs
const legacyProjectPath = process.env.PROJECT_DB_PATH ?? path.join(dataDir, 'homelab-inventory-project.json')
const seedEmptyData = runtimeConfig.seedEmptyData
const seedDir = path.join(root, 'server', 'seed')
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const configuredUpdateChannel = process.env.UPDATE_CHANNEL ?? (isDemoMode ? 'latest' : 'stable')
const updateChannel = ['stable', 'latest'].includes(configuredUpdateChannel)
  ? configuredUpdateChannel
  : 'stable'
const updateCheckEnabled = runtimeConfig.updateCheckEnabled
const runningRevision = process.env.APP_REVISION ?? 'unknown'
const registryOrigin = 'https://registry.homelabinventory.com'
const registryRefreshIntervalMs = isDemoMode
  ? 0
  : readCatalogRefreshInterval()
const backupEnvironmentPassphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE?.trim() || null
const backupEnvironmentTimezone = process.env.TZ?.trim() || null

if (configuredUpdateChannel !== updateChannel) {
  console.warn(`Unsupported UPDATE_CHANNEL "${configuredUpdateChannel}"; using stable.`)
}

const updateChecker = new DockerHubUpdateChecker({
  enabled: updateCheckEnabled,
  channel: updateChannel,
  runningVersion: packageJson.version,
  runningRevision,
})

const app = express()
const rateLimitConfig = readRateLimitConfig()

app.set('trust proxy', rateLimitConfig.trustProxy)

let store = null
let demoManager = null

if (isDemoMode) {
  const { DemoSessionManager, DEMO_COOKIE_NAME } = await import('./demo/session-manager.mjs')

  demoManager = new DemoSessionManager({
    appVersion: packageJson.version,
    catalogBootstrap: (currentStore) => new SnapshotService(currentStore, {
      officialOrigin: registryOrigin,
    }).refreshConnected(),
    dataDir,
    sourceDir: demoSourceDir,
    sessionMinutes: demoSessionMinutes,
    maxSessions: demoMaxSessions,
    saveDebounceMs,
  })
  await demoManager.init()

  app.locals.demoCookieName = DEMO_COOKIE_NAME
} else {
  store = new HomelabInventoryStore({
    appVersion: packageJson.version,
    dataDir,
    legacyProjectPath,
    saveDebounceMs,
    seedEmptyData,
    seedDir,
  })

  await store.init()
}

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: isProduction
    ? ["'self'"]
    : ["'self'", 'ws:', 'wss:', 'http://127.0.0.1:*', 'http://localhost:*'],
  fontSrc: ["'self'", 'data:'],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  objectSrc: ["'none'"],
  scriptSrc: isProduction
    ? ["'self'", "'wasm-unsafe-eval'"]
    : ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  upgradeInsecureRequests: null,
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: cspDirectives,
  },
  crossOriginEmbedderPolicy: false,
}))

if (shouldEnableRateLimit()) {
  app.use('/api', rateLimit(createRateLimitOptions(rateLimitConfig)))
}
app.use(browserMutationGuard)
app.use('/api/registry/catalog/import', express.json({ limit: '66mb' }))
app.use('/api/agent/enrollments', express.json({ limit: '16kb' }))
app.use('/api/agent/servers/:serverId/register', express.json({ limit: '16kb' }))
app.use('/api/agent/servers/:serverId/heartbeat', express.json({ limit: '256kb' }))
app.use(express.json({ limit: '10mb' }))

const authRuntime = store ? await readAuthRuntimeConfig({
  dataDir,
  log: store.getAuthenticationState().bootstrapState.setupRequired ? console.log : () => {},
}) : null
if (authRuntime) authRuntime.backupEncryptionConfigured = Boolean(backupEnvironmentPassphrase)
const sessionService = store ? new SessionService({ store, externalUrl: authRuntime.externalUrl }) : null
const authorizationService = store ? await AuthorizationService.create({ readState: () => store.getAuthenticationState() }) : null
const authService = store ? new AuthService({ store, sessionService, authorization: authorizationService, runtime: authRuntime }) : null
const accessService = store ? new AccessService({ store, authorization: authorizationService, sessions: sessionService }) : null
const invitationService = accessService ? new InvitationService({ accessService, sessionService }) : null
const oidcService = store ? new OidcService({ store, authService, invitationService, runtime: authRuntime }) : null

registerAuthenticationRoutes(app, {
  service: authService,
  oidcService,
  authorization: authorizationService,
  demo: isDemoMode,
})
app.use(createAuthenticationGuard({ service: authService, demo: isDemoMode }))
app.use(createAuthorizationGuard({ service: authService, authorization: authorizationService, demo: isDemoMode }))
registerAccessRoutes(app, {
  access: accessService,
  invitations: invitationService,
  sessions: sessionService,
  demo: isDemoMode,
})
registerAgentRoutes(app, store, { disabled: isDemoMode })

function parseCookie(header, name) {
  return (header ?? '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=')
}

async function resolveStore(request, response) {
  if (!isDemoMode) {
    return { store, demoSession: null }
  }

  const cookieName = app.locals.demoCookieName
  const sessionCookie = parseCookie(request.get('cookie'), cookieName)
  const demo = await demoManager.getOrCreateSessionStore(sessionCookie, { clientKey: request.ip })

  response.cookie(cookieName, demo.sessionId, demoManager.cookieOptions())

  return {
    store: demo.store,
    demoSession: demo.session,
  }
}

async function withStore(request, response, handler, options = {}) {
  try {
    const context = await resolveStore(request, response)
    await handler(context.store, context.demoSession)
  } catch (error) {
    const failure = storeRequestError(error, options)
    if (!failure.expose) {
      console.error('[store] Request failed.', error instanceof Error ? error.message : error)
    }
    response.status(failure.status).json({ message: failure.message })
  }
}

registerUpdateRoutes(app, {
  withStore,
  checker: updateChecker,
  releaseNotes: RELEASE_NOTES,
})

const installationIdentity = !isDemoMode
  ? new InstallationIdentityService({ dataDir, officialOrigin: registryOrigin })
  : null
const contributionDelivery = installationIdentity
  ? new ContributionDeliveryService({
      identityService: installationIdentity,
      digestHashes: (currentStore) => new SnapshotService(currentStore, { officialOrigin: registryOrigin }).knownContributionHashes(),
    })
  : null
await installationIdentity?.initialize(store)
const catalogRefreshCoordinator = store
  ? new CatalogRefreshCoordinator({
      store,
      snapshotService: new SnapshotService(store, { officialOrigin: registryOrigin }),
      intervalMs: registryRefreshIntervalMs,
    })
  : null
const backupService = store
  ? new BackupService({
      store,
      appVersion: packageJson.version,
      environmentPassphrase: backupEnvironmentPassphrase,
      environmentTimezone: backupEnvironmentTimezone,
      onRestoreApplied: async ({ sections }) => {
        if (sections.includes('authentication')) {
          await authorizationService.rebuild(store.getAuthenticationState())
        }
        if (sections.includes('registryEnrollment') || sections.includes('registryConfiguration')) {
          await installationIdentity?.initialize(store)
        }
      },
    })
  : null
await backupService?.init()
const backupScheduler = backupService
  ? new BackupScheduler({ store, service: backupService, environmentTimezone: backupEnvironmentTimezone })
  : null

registerBackupRoutes(app, {
  service: backupService,
  scheduler: backupScheduler,
  withStore,
  demo: isDemoMode,
  appVersion: packageJson.version,
})

registerInventoryRoutes(app, { withStore })
registerRegistryRoutes(app, {
  withStore,
  officialOrigin: registryOrigin,
  identityService: installationIdentity,
  deliveryService: contributionDelivery,
  catalogRefreshCoordinator,
  registryPolicy: isDemoMode
    ? { forcedMode: 'connected', contributionsAllowed: false }
    : undefined,
})
catalogRefreshCoordinator?.start()
const backupSchedule = backupScheduler?.start()
registerProjectRoutes(app, { withStore })
registerRoutingCacheRoutes(app, { withStore })
registerOnboardingRoutes(app, { withStore, disabled: isDemoMode })

const engineRuntime = await ServerEngineRuntime.create()
const sseHub = new EngineSseHub()
registerEngineRoutes(app, {
  withStore,
  commandService: new EngineCommandService(engineRuntime),
  sseHub,
  authService,
  authorization: authorizationService,
  demo: isDemoMode,
})

const updateCheckSchedule = startUpdateCheckSchedule({
  checker: updateChecker,
  store,
})
if (contributionDelivery && store) contributionDelivery.start(store)

app.get('/api/health', (_request, response) => {
  const health = applicationHealth({
    mode: isDemoMode ? 'demo' : 'production',
    schemaVersion: isDemoMode ? null : store.databases.meta.data.schemaVersion,
    persistence: isDemoMode ? null : store.getPersistenceHealth(),
  })
  response.status(health.status).json(health.payload)
})

app.get('/api/release-notes/status', (request, response) => {
  void withStore(request, response, async (currentStore) => {
    response.json(currentStore.getReleaseNotesStatus(RELEASE_NOTES))
  }, { message: 'Unable to load release notes status.' })
})

app.post('/api/release-notes/acknowledge', (request, response) => {
  void withStore(request, response, async (currentStore) => {
    response.json(await currentStore.acknowledgeReleaseNotes())
  }, { message: 'Unable to acknowledge release notes.' })
})

app.post('/api/flush', (request, response) => {
  void withStore(request, response, async (currentStore) => {
    await currentStore.flush()
    response.json({ ok: true })
  }, { message: 'Unable to flush data.' })
})

app.get('/api/demo/session', (request, response) => {
  if (!isDemoMode) {
    response.json({ mode: 'production' })
    return
  }

  void withStore(request, response, async (_currentStore, demoSession) => {
    response.json(demoManager.sessionStatus(demoSession))
  })
})

app.post('/api/demo/session/extend', (request, response) => {
  if (!isDemoMode) {
    response.status(404).json({ message: 'Demo mode is not enabled.' })
    return
  }

  const sessionId = parseCookie(request.get('cookie'), app.locals.demoCookieName)

  void (async () => {
    try {
      response.json(await demoManager.extendSession(sessionId))
    } catch (error) {
      response.status(410).json({ message: error instanceof Error ? error.message : 'Demo session is expired.' })
    }
  })()
})

app.post('/api/demo/session/expire', (request, response) => {
  if (!isDemoMode) {
    response.status(404).json({ message: 'Demo mode is not enabled.' })
    return
  }

  const sessionId = parseCookie(request.get('cookie'), app.locals.demoCookieName)

  void (async () => {
    try {
      if (sessionId) {
        await demoManager.expireSession(sessionId)
      }

      response.clearCookie(app.locals.demoCookieName, { path: '/' })
      response.json({ ok: true })
    } catch (error) {
      console.error('[demo] Unable to expire session.', error instanceof Error ? error.message : error)
      response.status(500).json({ message: 'Unable to expire the demo session.' })
    }
  })()
})

app.use(apiErrorHandler)

app.use('/api', (_request, response) => {
  response.status(404).json({ message: 'API endpoint was not found.' })
})

if (isProduction) {
  app.use(express.static(path.join(root, 'dist')))
  app.use((_request, response) => {
    response.sendFile(path.join(root, 'dist', 'index.html'))
  })
} else {
  const vitePackage = 'vite'
  const { createServer } = await import(vitePackage)
  const vite = await createServer({
    root,
    server: {
      middlewareMode: true,
      watch: {
        ignored: ['**/data/**'],
      },
    },
    appType: 'spa',
  })

  app.use(vite.middlewares)
}

const server = app.listen(port, () => {
  console.log(`Homelab Inventory running at http://127.0.0.1:${port}`)
  console.log(`Lowdb data directory: ${dataDir}`)
})

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received; flushing lowdb stores.`)
  try {
    await gracefullyStopServer({
      server,
      sseHub,
      stoppers: [
        () => updateCheckSchedule.stop(),
        () => backupSchedule?.stop(),
        () => catalogRefreshCoordinator?.stop(),
        () => contributionDelivery?.stop(store),
      ],
      flush: () => demoManager ? demoManager.flushAll() : store.flush(),
    })
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
