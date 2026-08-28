import express from 'express'
import { rateLimit } from 'express-rate-limit'
import fs from 'node:fs/promises'
import helmet from 'helmet'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_NOTES } from '../src/release-notes.ts'
import { registerAgentRoutes } from './agent-routes.mjs'
import { createAgentV1BodyMiddleware, registerAgentV1Routes } from './agents/v1-routes.mjs'
import { AgentLifecycleScheduler } from './agents/lifecycle-scheduler.mjs'
import { AgentReleaseService, registerAgentReleaseRoutes } from './agents/release-service.mjs'
import { registerBackupRoutes } from './backup-routes.mjs'
import { registerBootstrapRoute } from './bootstrap-routes.mjs'
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
import { APPLICATION_CATALOG_CONTRACT_VERSION, applicationHealth } from './app-health.mjs'
import { EngineCommandService } from './engine/command-service.mjs'
import { ServerEngineRuntime } from './engine/runtime.mjs'
import { EngineSseHub } from './engine/sse-hub.mjs'
import { registerEngineRoutes } from './engine-routes.mjs'
import { registerInventoryRoutes } from './inventory-routes.mjs'
import { registerInventoryMetadataRoutes } from './inventory-metadata/routes.mjs'
import { registerOnboardingRoutes } from './onboarding-routes.mjs'
import { registerProjectRoutes } from './project-routes.mjs'
import { registerWorkspaceRoutes } from './workspace-routes.mjs'
import { CompatibilityAuditService } from './compatibility/audit-service.mjs'
import { registerCompatibilityRoutes } from './compatibility/routes.mjs'
import { registerSystemsRoutes } from './systems/routes.mjs'
import { SystemsSavedViewService } from './systems/saved-view-service.mjs'
import { SystemAttentionProjector } from './systems/attention-projector.mjs'
import { SystemsReadService } from './systems/read-service.mjs'
import { registerRegistryRoutes } from './registry-routes.mjs'
import { registerRoutingCacheRoutes } from './routing-cache-routes.mjs'
import { browserMutationGuard } from './request-security.mjs'
import { readRuntimeConfig } from './runtime-config.mjs'
import { gracefullyStopServer } from './server-lifecycle.mjs'
import { createResponseCompression, registerProductionAssets } from './http-delivery.mjs'
import {
  CatalogRefreshCoordinator,
  readCatalogRefreshInterval,
} from './registry/catalog-refresh-coordinator.mjs'
import { CatalogUpdateCoordinator } from './registry/catalog-update-coordinator.mjs'
import { runCatalogUpdatesAfterStartup } from './registry/catalog-update-startup.mjs'
import { ContributionDeliveryService } from './registry/contribution-delivery.mjs'
import { CatalogStatusService } from './registry/catalog-status-service.mjs'
import { CatalogRuntime } from './registry/catalog-runtime.mjs'
import { InstallationIdentityService } from './registry/installation-identity.mjs'
import {
  createRateLimitOptions,
  readRateLimitConfig,
  shouldEnableRateLimit,
} from './rate-limit.mjs'
import { DockerHubUpdateChecker } from './update-checker.mjs'
import { registerUpdateRoutes } from './update-routes.mjs'
import { startUpdateCheckSchedule } from './update-scheduler.mjs'
import { storeRequestError } from './store-request-error.mjs'
import { closeTelemetryDatabase, openTelemetryDatabase } from './telemetry/database.mjs'
import { TelemetryRepository } from './telemetry/repository.mjs'
import { startTelemetryRetentionSchedule } from './telemetry/retention.mjs'
import { createNotificationRuntime } from './notifications/runtime.mjs'
import { SqliteNotificationPersistence } from './notifications/sqlite-persistence.ts'
import { registerNotificationRoutes } from './notifications/routes.mjs'
import { activateSqliteRuntime } from './persistence/runtime.ts'
import { StartupProfiler } from './startup/startup-profiler.mjs'
import { createStagingPolicy, stagingRegistryPolicy } from './staging-policy.mjs'
import { ApplicationLiveEventBus } from './live-events/event-bus.mjs'
import { ApplicationSseHub } from './live-events/sse-hub.mjs'
import { registerApplicationEventRoutes } from './live-events/routes.mjs'
import { boundedTelemetryPayloads, compactAgentStatus } from './live-events/agent-payloads.mjs'
import { createRepositoryContext } from './persistence/core/repositories/repository-context.ts'
import { createSharingRepository } from './persistence/core/repositories/sharing-repository.ts'
import { SharingInstallationIdentityService } from './sharing/installation-identity.mjs'
import { SharingEnrollmentCoordinator } from './sharing/enrollment-coordinator.mjs'
import { ShareProjector } from './sharing/share-projector.mjs'
import { SharingPublicIdService } from './sharing/public-id-service.mjs'
import { LabGdPublicationClient } from './sharing/labgd-client.mjs'
import { SharingPublicationService } from './sharing/publication-service.mjs'
import { SharingPublicationCoordinator } from './sharing/publication-coordinator.mjs'
import { SharingInstallationEventCoordinator } from './sharing/installation-event-coordinator.mjs'
import { createSharingResourceSnapshotProvider, createSharingSourceProvider } from './sharing/source-provider.mjs'
import { registerSharingRoutes } from './sharing/routes.mjs'
import { AccountUnlinkService } from './sharing/account-unlink-service.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProduction = process.env.NODE_ENV === 'production'
const runtimeConfig = readRuntimeConfig()
const startupProfiler = new StartupProfiler({ enabled: process.env.STARTUP_PROFILE === '1' })
const appMode = runtimeConfig.appMode
const isDemoMode = appMode === 'demo'
const stagingPolicy = createStagingPolicy(appMode)
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
const agentReleasePin = JSON.parse(await fs.readFile(path.join(root, 'server', 'agent-release-pin.json'), 'utf8'))
const agentReleaseService = new AgentReleaseService({
  expectedVersion: agentReleasePin.version,
  expectedSourceRevision: agentReleasePin.sourceRevision,
})

function assignmentHostsFromPatch(patch, hosts = new Map()) {
  if (patch?.kind === 'batch') {
    for (const child of patch.payload?.patches ?? []) assignmentHostsFromPatch(child, hosts)
    return hosts
  }
  if (patch?.kind !== 'patch-assignments') return hosts
  for (const assignment of patch.payload?.upsert ?? []) {
    const type = assignment?.host?.item_type
    const id = Number(assignment?.host?.id)
    if (['server', 'nas', 'pcBuild'].includes(type) && Number.isSafeInteger(id) && id > 0) hosts.set(`${type}:${id}`, { type, id })
  }
  return hosts
}

function incidentHosts(...states) {
  const hosts = new Map()
  for (const state of states) {
    for (const incident of state?.incidents ?? []) {
      const type = incident?.hostType
      const id = Number(incident?.hostId)
      if (['server', 'nas', 'pcBuild'].includes(type) && Number.isSafeInteger(id) && id > 0) hosts.set(`${type}:${id}`, { type, id })
    }
  }
  return hosts.values()
}
await agentReleaseService.initialize()
startupProfiler.mark('agent-release')
const configuredUpdateChannel = process.env.UPDATE_CHANNEL ?? (isDemoMode ? 'latest' : 'stable')
const updateChannel = ['stable', 'latest'].includes(configuredUpdateChannel)
  ? configuredUpdateChannel
  : 'stable'
const updateCheckEnabled = runtimeConfig.updateCheckEnabled
const runningRevision = process.env.APP_REVISION ?? 'unknown'
const registryOrigin = 'https://registry.homelabinventory.com'
const catalogRuntime = new CatalogRuntime({ officialOrigin: registryOrigin })
const registryRefreshIntervalMs = !runtimeConfig.registryNetworkRefreshEnabled
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
let resolveHttpReady
const httpReady = new Promise((resolve) => { resolveHttpReady = resolve })
const applicationEventBus = new ApplicationLiveEventBus()
const applicationSseHub = new ApplicationSseHub({ bus: applicationEventBus })
const rateLimitConfig = readRateLimitConfig()

app.set('trust proxy', rateLimitConfig.trustProxy)

let store = null
let demoManager = null
let telemetryDatabase = null
let telemetryRepository = null
let telemetryRetentionSchedule = null
let notificationRuntime = null
let notificationEventUnsubscribe = null
let backupService = null
let sqlitePersistence = null
let sqliteRuntime = null

if (isDemoMode) {
  const { DemoSessionManager, DEMO_COOKIE_NAME } = await import('./demo/session-manager.mjs')

  demoManager = new DemoSessionManager({
    appVersion: packageJson.version,
    catalogBootstrap: async (currentStore) => {
      await catalogRuntime.start(currentStore)
    },
    dataDir,
    sourceDir: demoSourceDir,
    sessionMinutes: demoSessionMinutes,
    maxSessions: demoMaxSessions,
    saveDebounceMs,
  })
  await demoManager.init()

  app.locals.demoCookieName = DEMO_COOKIE_NAME
} else {
  let legacyMigrationResources = null
  const legacyBackupServiceFactory = async ({ includeTelemetry = true } = {}) => {
    const { HomelabInventoryStore } = await import('./persistence/legacy/legacy-store.mjs')
    const legacyStore = new HomelabInventoryStore({
      appVersion: packageJson.version,
      dataDir,
      legacyProjectPath,
      saveDebounceMs,
      seedEmptyData,
      seedDir,
    })
    await legacyStore.init()
    const legacyTelemetryDatabase = includeTelemetry ? await openTelemetryDatabase({ dataDir }) : null
    const legacyTelemetryRepository = legacyTelemetryDatabase ? new TelemetryRepository(legacyTelemetryDatabase) : null
    const legacyNotificationRuntime = await createNotificationRuntime({
      dataDir,
      workspaceStore: legacyStore,
    })
    const service = new BackupService({
      store: legacyStore,
      appVersion: packageJson.version,
      environmentPassphrase: backupEnvironmentPassphrase,
      environmentTimezone: backupEnvironmentTimezone,
      telemetryRepository: legacyTelemetryRepository,
      notificationStore: legacyNotificationRuntime.store,
      notificationVault: legacyNotificationRuntime.vault,
    })
    await service.init()
    legacyMigrationResources = {
      store: legacyStore,
      telemetryDatabase: legacyTelemetryDatabase,
      notificationRuntime: legacyNotificationRuntime,
    }
    return service
  }

  try {
    sqliteRuntime = await activateSqliteRuntime({
      dataDir,
      appVersion: packageJson.version,
      legacyProjectPath,
      seedDir,
      backupPassphrase: backupEnvironmentPassphrase,
      backupServiceFactory: legacyBackupServiceFactory,
    })
  } finally {
    if (legacyMigrationResources) {
      await legacyMigrationResources.notificationRuntime.stop().catch(() => {})
      closeTelemetryDatabase(legacyMigrationResources.telemetryDatabase)
      await legacyMigrationResources.store.flush().catch(() => {})
    }
  }
  store = sqliteRuntime.store
  telemetryDatabase = sqliteRuntime.telemetryDatabase
  telemetryRepository = sqliteRuntime.telemetryRepository
  sqlitePersistence = sqliteRuntime.persistence
  telemetryRetentionSchedule = startTelemetryRetentionSchedule(telemetryDatabase)
  notificationRuntime = stagingPolicy.notificationsDisabled
    ? null
    : await createNotificationRuntime({
        dataDir,
        workspaceStore: store,
        persistence: new SqliteNotificationPersistence({ database: store.core.database }),
      })
  backupService = new BackupService({
    store,
    appVersion: packageJson.version,
    environmentPassphrase: backupEnvironmentPassphrase,
    environmentTimezone: backupEnvironmentTimezone,
    telemetryRepository,
    notificationStore: notificationRuntime?.store ?? null,
    notificationVault: notificationRuntime?.vault ?? null,
  })
  await backupService.init()
}
startupProfiler.mark('persistence')

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
app.use(createResponseCompression())

if (shouldEnableRateLimit()) {
  app.use('/api', rateLimit(createRateLimitOptions(rateLimitConfig)))
}
app.use(browserMutationGuard)
app.use('/api/registry/catalog/import', express.json({ limit: '66mb' }))
app.use('/api/agent/enrollments', express.json({ limit: '16kb' }))
app.use('/api/agent/servers/:serverId/register', express.json({ limit: '16kb' }))
app.use('/api/agent/servers/:serverId/heartbeat', express.json({ limit: '256kb' }))
app.use('/api/agent/hosts/:hostType/:hostId/enrollments', express.json({ limit: '16kb' }))
app.use('/api/agent/hosts/:hostType/:hostId/activate', express.json({ limit: '16kb' }))
app.use('/api/agent/hosts/:hostType/:hostId/heartbeats', createAgentV1BodyMiddleware())
app.use('/api/agent/hosts/:hostType/:hostId/hardware-snapshots', createAgentV1BodyMiddleware({
  maxBytes: 2 * 1024 * 1024,
  label: 'Hardware snapshot',
}))
app.use(express.json({ limit: '10mb' }))

const authRuntime = store && !stagingPolicy.authenticationDisabled ? await readAuthRuntimeConfig({
  dataDir,
  log: store.getAuthenticationState().bootstrapState.setupRequired ? console.log : () => {},
}) : null
if (authRuntime) authRuntime.backupEncryptionConfigured = Boolean(backupEnvironmentPassphrase)
const sessionService = store && authRuntime ? new SessionService({ store, externalUrl: authRuntime.externalUrl }) : null
const authorizationService = store && authRuntime
  ? await AuthorizationService.create({ readState: () => store.getAuthenticationState() })
  : null
const systemsSavedViews = store ? new SystemsSavedViewService() : null
const systemsAttention = store ? new SystemAttentionProjector() : null
let systemsReadService = null
const compatibilityAudit = new CompatibilityAuditService({
  onChanged: (currentStore, event) => {
    systemsAttention?.markHostDirty(currentStore, {
      projectId: event.projectId,
      hostType: event.hostType,
      hostId: event.hostId,
      workspaceId: event.workspaceId,
      reason: 'compatibility-changed',
    })
    systemsAttention?.reconcile(currentStore)
    applicationEventBus.publish({
      scope: currentStore,
      topics: [
        `compatibility:${event.projectId}`,
        `systems:${event.projectId}`,
        ...(event.workspaceId ? [`systems:${event.projectId}:workspace:${event.workspaceId}`] : []),
      ],
      kind: 'compatibility.changed',
      payload: {
        projectId: event.projectId,
        workspaceId: event.workspaceId ?? null,
        host: { hostType: event.hostType, hostId: event.hostId },
        counts: event.counts,
      },
    })
  },
})
systemsReadService = store
  ? new SystemsReadService({ telemetryRepository, releaseService: agentReleaseService, attentionProjector: systemsAttention })
  : null
if (store) {
  systemsAttention?.start(store)
  compatibilityAudit?.schedule(store)
  store.subscribeToProjectCommits((commit) => {
    if (commit.type === 'canonical-invalidated') {
      compatibilityAudit?.markProjectDirty(store, store.projectId, 'canonical-invalidated')
      compatibilityAudit?.schedule(store)
      systemsAttention?.markProjectDirty(store, store.projectId, 'canonical-invalidated')
      return
    }
    compatibilityAudit?.markProjectDirty(store, store.projectId, 'project-commit')
    compatibilityAudit?.schedule(store)
    const hosts = assignmentHostsFromPatch(commit.forward)
    assignmentHostsFromPatch(commit.inverse, hosts)
    for (const host of hosts.values()) systemsAttention?.markHostDirty(store, { projectId: store.projectId, hostType: host.type, hostId: host.id, reason: 'assignment-changed' })
    const kinds = [commit.forward?.kind, commit.inverse?.kind]
    if (kinds.some((kind) => kind === 'add-connection' || kind === 'remove-connection' || kind === 'batch')) {
      systemsAttention?.markProjectDirty(store, store.projectId, 'topology-changed')
    }
  })
  notificationRuntime?.store.subscribe((event) => {
    if (event.section !== 'state') return
    for (const host of incidentHosts(event.previous, event.current)) systemsAttention?.markHostDirty(store, { projectId: store.projectId, hostType: host.type, hostId: host.id, reason: 'notification-changed' })
  })
}
const authService = store && authRuntime
  ? new AuthService({ store, sessionService, authorization: authorizationService, savedViews: systemsSavedViews, runtime: authRuntime })
  : null
const accessService = store ? new AccessService({ store, authorization: authorizationService, sessions: sessionService }) : null
const invitationService = accessService ? new InvitationService({ accessService, sessionService }) : null
const oidcService = store ? new OidcService({ store, authService, invitationService, runtime: authRuntime }) : null
startupProfiler.mark('identity-auth')

registerAuthenticationRoutes(app, {
  service: authService,
  oidcService,
  authorization: authorizationService,
  demo: isDemoMode || stagingPolicy.authenticationDisabled,
})
app.use(createAuthenticationGuard({ service: authService, demo: isDemoMode || stagingPolicy.authenticationDisabled }))
app.use(createAuthorizationGuard({ service: authService, authorization: authorizationService, demo: isDemoMode || stagingPolicy.authenticationDisabled }))
registerAccessRoutes(app, {
  access: accessService,
  invitations: invitationService,
  sessions: sessionService,
  demo: isDemoMode || stagingPolicy.authenticationDisabled,
})
let agentLifecycleScheduler = null
function publishAgentChanged({ store: currentStore, host, kind, liveTelemetry = null }, { schedule = true } = {}) {
  let projectIds = []
  try {
    projectIds = currentStore.listInventoryProjectIds({ type: host.hostType, id: host.hostId })
  } catch {}
  const status = compactAgentStatus(currentStore, host)
  applicationEventBus.publish({
    scope: currentStore,
    topics: 'agents:fleet',
    kind: `agent.${kind}`,
    payload: { host, status },
  })
  for (const payload of boundedTelemetryPayloads(host, status, liveTelemetry)) applicationEventBus.publish({
    scope: currentStore,
    topics: `agent-telemetry:${host.hostType}:${host.hostId}`,
    kind: `agent.${kind}`,
    payload,
  })
  if (kind === 'hardware') applicationEventBus.publish({
    scope: currentStore,
    topics: `agent-hardware:${host.hostType}:${host.hostId}`,
    kind: 'agent.hardware',
    payload: { host },
  })
  for (const projectId of projectIds) {
    let system = null
    try { system = systemsReadService?.liveHost(currentStore, projectId, host, null) ?? null } catch {}
    applicationEventBus.publish({
      scope: currentStore,
      topics: `systems:${projectId}`,
      kind: `agent.${kind}`,
      payload: { projectId, host, system },
    })
    const canvases = currentStore.core.database.query(`
      SELECT workspace.id
      FROM workspaces workspace
      JOIN workspace_placements placement
        ON placement.project_id = workspace.project_id AND placement.workspace_id = workspace.id
      JOIN inventory_identity_aliases identity ON identity.item_id = placement.item_id
      WHERE workspace.project_id = ? AND workspace.type = 'canvas'
        AND workspace.archived_at_ms IS NULL
        AND identity.legacy_type_key = ? AND identity.legacy_id = ?
    `).all(projectId, host.hostType, host.hostId)
    for (const canvas of canvases) {
      let scopedSystem = null
      try {
        scopedSystem = systemsReadService?.liveHost(currentStore, projectId, host, null, {
          workspaceId: canvas.id,
        }) ?? null
      } catch {}
      applicationEventBus.publish({
        scope: currentStore,
        topics: `systems:${projectId}:workspace:${canvas.id}`,
        kind: `agent.${kind}`,
        payload: { projectId, workspaceId: canvas.id, host, system: scopedSystem },
      })
    }
  }
  if (schedule) agentLifecycleScheduler?.changed(host)
}
if (!isDemoMode && store && !stagingPolicy.agentsDisabled) {
  agentLifecycleScheduler = new AgentLifecycleScheduler({
    summary: (now) => store.getAgentStatusSummary({ now }),
    onTransition: (host, status) => publishAgentChanged({ store, host, kind: `status-${status.state}` }, { schedule: false }),
  })
}
registerAgentReleaseRoutes(app, agentReleaseService, { disabled: isDemoMode || stagingPolicy.agentsDisabled })
registerAgentRoutes(app, store, {
  disabled: isDemoMode || stagingPolicy.agentsDisabled,
  releaseService: agentReleaseService,
  onAgentChanged: publishAgentChanged,
})
registerAgentV1Routes(app, store, {
  disabled: isDemoMode || stagingPolicy.agentsDisabled,
  releaseService: agentReleaseService,
  heartbeatSink: telemetryRepository
    ? async (heartbeat) => {
        const telemetry = await telemetryRepository.recordHeartbeat(heartbeat)
        if (!notificationRuntime) return telemetry
        try {
          const hostName = store.getProject().items?.[`${heartbeat.hostType}:${heartbeat.hostId}`]?.name
          await notificationRuntime.evaluator.evaluateHeartbeat({ ...heartbeat, hostName })
          void notificationRuntime.deliveryCoordinator.wake()
        } catch (error) {
          console.error('[notifications] Heartbeat evaluation failed.', error instanceof Error ? error.message : error)
        }
        return telemetry
      }
    : null,
  monitoringConfigProvider: notificationRuntime
    ? (hostType, hostId) => notificationRuntime.monitoringConfig(hostType, hostId)
    : null,
  notificationHostLifecycle: notificationRuntime?.incidentManager ?? null,
  telemetryRepository,
  onAgentChanged: publishAgentChanged,
})
registerNotificationRoutes(app, {
  store: notificationRuntime?.store ?? null,
  vault: notificationRuntime?.vault ?? null,
  incidentManager: notificationRuntime?.incidentManager ?? null,
  deliveryCoordinator: notificationRuntime?.deliveryCoordinator ?? null,
  demo: isDemoMode || stagingPolicy.notificationsDisabled,
})
notificationEventUnsubscribe = notificationRuntime?.store.subscribe(({ section }) => {
  if (section === 'secrets') return
  const topics = section === 'state'
    ? ['notifications:summary', 'notifications:incidents']
    : ['notifications:summary']
  applicationEventBus.publish({
    scope: store,
    topics,
    kind: `notifications.${section}-changed`,
    payload: { section },
  })
}) ?? null
notificationRuntime?.start()
agentLifecycleScheduler?.start()

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

const sharingRepository = store
  ? createSharingRepository(createRepositoryContext(store.core.database))
  : null
const sharingEffectiveEnabled = Boolean(
  store
  && !isDemoMode
  && !stagingPolicy.sharingDisabled
  && runtimeConfig.labGdEnabled,
)
const labGdOrigin = process.env.LABGD_ORIGIN?.trim() || 'https://lab.gd'
const sharingIdentity = sharingEffectiveEnabled
  ? new SharingInstallationIdentityService({ dataDir, repository: sharingRepository, labGdOrigin })
  : null
const sharingPublicIds = sharingEffectiveEnabled ? new SharingPublicIdService({ dataDir }) : null
const sharingProjector = sharingPublicIds ? new ShareProjector({ publicIds: sharingPublicIds }) : null
const sharingPublicationClient = sharingIdentity ? new LabGdPublicationClient({ identityService: sharingIdentity }) : null
let sharingPublicationCoordinator = null
let sharingEventCoordinator = null
let sharingProjectUnsubscribe = null
let sharingMetadataUnsubscribe = null
const publishSharingState = (value, kind = 'sharing.status-changed') => {
  if (!store) return
  const share = value && Number.isSafeInteger(value.id) ? value : null
  applicationEventBus.publish({
    scope: store,
    topics: ['sharing:status'],
    kind,
    payload: share
      ? { shareId: share.id, state: share.state, localRevision: share.localRevision, remoteRevision: share.remoteRevision }
      : { enrollmentState: value?.enrollmentState ?? sharingRepository?.getSettings().enrollmentState ?? 'disabled' },
  })
}
const sharingPublicationService = sharingEffectiveEnabled
  ? new SharingPublicationService({
      repository: sharingRepository,
      projector: sharingProjector,
      sourceProvider: createSharingSourceProvider(store),
      client: sharingPublicationClient,
      publicIds: sharingPublicIds,
      onStateChanged: (share) => publishSharingState(share, 'sharing.share-changed'),
    })
  : null
const sharingAccountUnlinkService = sharingIdentity
  ? new AccountUnlinkService({
      repository: sharingRepository,
      identityService: sharingIdentity,
      onStateChanged: (value, kind) => publishSharingState(value, kind),
    })
  : null
if (sharingPublicationService) {
  sharingPublicationCoordinator = new SharingPublicationCoordinator({
    repository: sharingRepository,
    publicationService: sharingPublicationService,
  })
  const scheduleProjectShares = (projectIds = null) => {
    const accepted = projectIds ? new Set(projectIds) : null
    for (const share of sharingRepository.listShares()) {
      if (accepted && !accepted.has(share.projectId)) continue
      void sharingPublicationService.markRelevantChange(share.id)
        .then(() => sharingPublicationCoordinator?.wake())
        .catch((error) => console.error('[sharing] Unable to schedule synchronized share.', error instanceof Error ? error.message : error))
    }
  }
  sharingProjectUnsubscribe = store.subscribeToProjectCommits(() => scheduleProjectShares())
  sharingMetadataUnsubscribe = applicationEventBus.subscribe(({ scope, event }) => {
    if (scope !== store || !event.kind.startsWith('inventory-metadata.')) return
    const projectIds = event.topics.flatMap((topic) => {
      const match = /^inventory-metadata:([1-9]\d*)$/u.exec(topic)
      return match ? [Number(match[1])] : []
    })
    if (projectIds.length) scheduleProjectShares(projectIds)
  })
}
if (sharingPublicationService) {
  sharingEventCoordinator = new SharingInstallationEventCoordinator({
    repository: sharingRepository,
    client: sharingPublicationClient,
    identityService: sharingIdentity,
    onStateChanged: (value, kind) => publishSharingState(value, kind),
  })
}
const sharingEnrollmentCoordinator = sharingEffectiveEnabled
  ? new SharingEnrollmentCoordinator({
      repository: sharingRepository,
      identityService: sharingIdentity,
      localReady: httpReady,
      onStateChanged: (settings) => {
        publishSharingState(settings)
        sharingEventCoordinator?.wake()
        if (settings.enrollmentState === 'connected') {
          sharingPublicationCoordinator?.wake()
        }
      },
    })
  : null
const sharingResourceSnapshotProvider = sharingEffectiveEnabled
  ? createSharingResourceSnapshotProvider({ store, telemetryRepository, publicIds: sharingPublicIds })
  : null

registerSharingRoutes(app, {
  repository: sharingRepository,
  publicationService: sharingPublicationService,
  publicationCoordinator: sharingPublicationCoordinator,
  enrollmentCoordinator: sharingEnrollmentCoordinator,
  eventCoordinator: sharingEventCoordinator,
  identityService: sharingIdentity,
  accountUnlinkService: sharingAccountUnlinkService,
  resourceSnapshotProvider: sharingResourceSnapshotProvider,
  demo: isDemoMode,
  staging: stagingPolicy.staging,
  effectiveEnabled: sharingEffectiveEnabled,
  origin: labGdOrigin,
})

registerApplicationEventRoutes(app, {
  withStore,
  hub: applicationSseHub,
  authorization: authorizationService,
  demo: isDemoMode || stagingPolicy.authenticationDisabled,
})

registerUpdateRoutes(app, {
  withStore,
  checker: updateChecker,
  releaseNotes: RELEASE_NOTES,
  onChanged: (currentStore) => applicationEventBus.publish({
    scope: currentStore ?? null,
    topics: ['updates:status'],
    kind: 'updates.status-changed',
  }),
})

const installationIdentity = !isDemoMode && !stagingPolicy.registryIdentityDisabled && runtimeConfig.registryIdentityEnabled
  ? new InstallationIdentityService({ dataDir, officialOrigin: registryOrigin })
  : null
const contributionDelivery = installationIdentity
  ? new ContributionDeliveryService({
      identityService: installationIdentity,
      digestHashes: (currentStore) => catalogRuntime.forStore(currentStore).knownContributionHashes(),
    })
  : null
await installationIdentity?.initialize(store)
const catalogStatusService = installationIdentity && store
  ? new CatalogStatusService({
      store,
      identityService: installationIdentity,
      applicationVersion: packageJson.version,
      applicationCatalogContractVersion: APPLICATION_CATALOG_CONTRACT_VERSION,
    })
  : null
const catalogSnapshotService = store ? catalogRuntime.forRequest(store) : null
if (store) await catalogRuntime.start(store)
startupProfiler.mark('catalog')
const catalogUpdateCoordinator = store
  ? new CatalogUpdateCoordinator({
      store,
      snapshotService: catalogSnapshotService,
      forceAutomatic: isDemoMode,
      onChanged: () => systemsAttention?.markProjectDirty(store, store.projectId, 'registry-updates-changed'),
    })
  : null
const catalogRefreshCoordinator = store
  ? new CatalogRefreshCoordinator({
      store,
      snapshotService: catalogSnapshotService,
      intervalMs: registryRefreshIntervalMs,
      onRefresh: () => {
        void catalogStatusService?.trigger('catalog-activated')
        void catalogUpdateCoordinator?.run().catch(() => {})
      },
    })
  : null
if (backupService) {
  backupService.onRestoreApplied = async ({ sections }) => {
    if (sections.includes('authentication')) {
      await authorizationService.rebuild(store.getAuthenticationState())
    }
    if (sections.includes('registryEnrollment') || sections.includes('registryConfiguration')) {
      await installationIdentity?.initialize(store)
      void catalogStatusService?.trigger('enrollment-restored')
    }
    if (sections.includes('notifications') || sections.includes('notificationHistory')) {
      await notificationRuntime?.incidentManager.reconcilePolicies({ reason: 'notification-backup-restored' })
    }
    if (sections.includes('sharingConfiguration') || sections.includes('sharingIdentity')) {
      if (sharingEffectiveEnabled) await sharingIdentity?.ensure()
      sharingEnrollmentCoordinator?.wake()
      sharingPublicationCoordinator?.wake()
      publishSharingState(sharingRepository?.getSettings())
    }
  }
}
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

registerInventoryRoutes(app, {
  withStore,
  onHostsDeleted: notificationRuntime
    ? async (hosts) => {
        for (const host of hosts) await notificationRuntime.incidentManager.cancelHost(host.type, host.id, 'host-deleted')
      }
    : null,
})
registerInventoryMetadataRoutes(app, {
  withStore,
  eventBus: applicationEventBus,
})
registerRegistryRoutes(app, {
  withStore,
  officialOrigin: registryOrigin,
  identityService: installationIdentity,
  deliveryService: contributionDelivery,
  snapshotServiceFactory: (currentStore) => catalogRuntime.forRequest(currentStore),
  catalogRefreshCoordinator,
  catalogUpdateCoordinator,
  catalogStatusService,
  onUpdatesChanged: () => systemsAttention?.markProjectDirty(store, store.projectId, 'registry-decision-changed'),
  registryPolicy: isDemoMode
    ? { forcedMode: 'connected', contributionsAllowed: false, networkRefreshAllowed: false, automaticSafeUpdatesForced: true }
    : stagingRegistryPolicy(stagingPolicy),
})
if (runtimeConfig.registryNetworkRefreshEnabled && !stagingPolicy.registryNetworkRefreshDisabled) catalogRefreshCoordinator?.start()
catalogStatusService?.start()
const backupSchedule = stagingPolicy.scheduledBackupsDisabled ? null : backupScheduler?.start()
registerProjectRoutes(app, { withStore })
registerCompatibilityRoutes(app, { withStore, service: compatibilityAudit, eventBus: applicationEventBus })
registerSystemsRoutes(app, {
  withStore,
  service: systemsReadService,
  savedViews: systemsSavedViews,
  attention: systemsAttention,
  authorization: authorizationService,
})
registerWorkspaceRoutes(app, { withStore })
registerRoutingCacheRoutes(app, { withStore })
registerOnboardingRoutes(app, { withStore, disabled: isDemoMode })

registerBootstrapRoute(app, {
  withStore,
  authService,
  authorization: authorizationService,
  agentReleaseService,
  notificationStore: notificationRuntime?.store ?? null,
  updateChecker,
  releaseNotes: RELEASE_NOTES,
  demo: isDemoMode,
  demoManager,
})

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
  onChanged: (currentStore) => applicationEventBus.publish({
    scope: currentStore ?? null,
    topics: ['updates:status'],
    kind: 'updates.status-changed',
  }),
})
if (contributionDelivery && store && runtimeConfig.registryContributionEnabled && !stagingPolicy.registryContributionsDisabled) contributionDelivery.start(store)

app.get('/api/health', (_request, response) => {
  const health = applicationHealth({
    mode: appMode,
    schemaVersion: isDemoMode ? null : store.getDatabaseStatus().schemaVersion,
    persistence: isDemoMode
      ? null
      : {
          ...store.getPersistenceHealth(),
          status: sqlitePersistence?.status ?? 'unavailable',
          schemas: sqlitePersistence?.versions ?? null,
        },
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
      const session = await demoManager.getSession(sessionId)
      const currentStore = session
        ? (await demoManager.getOrCreateSessionStore(sessionId, { clientKey: request.ip })).store
        : null
      const status = await demoManager.extendSession(sessionId)
      if (currentStore) {
        applicationEventBus.publish({
          scope: currentStore,
          topics: ['demo:session'],
          kind: 'demo.session-extended',
          payload: { expiresAt: status.expiresAt },
        })
      }
      response.json(status)
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
        const session = await demoManager.getSession(sessionId)
        const currentStore = session
          ? (await demoManager.getOrCreateSessionStore(sessionId, { clientKey: request.ip })).store
          : null
        if (currentStore) {
          applicationEventBus.publish({
            scope: currentStore,
            topics: ['demo:session'],
            kind: 'demo.session-expired',
          })
        }
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
  registerProductionAssets(app, express, path.join(root, 'dist'))
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
  console.log(`SQLite data directory: ${dataDir}`)
  startupProfiler.mark('http-listener')
  startupProfiler.complete()
  resolveHttpReady()
  sharingEnrollmentCoordinator?.start()
  sharingPublicationCoordinator?.start()
  sharingEventCoordinator?.start()
  if (store) {
    void runCatalogUpdatesAfterStartup({
      runtime: catalogRuntime,
      store,
      coordinator: catalogUpdateCoordinator,
    }).catch((error) => {
      console.error('[registry-updates] Catalog startup recovery failed.', error instanceof Error ? error.message : error)
    })
  }
})

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received; checkpointing SQLite stores.`)
  try {
    await gracefullyStopServer({
      server,
      sseHub: {
        closeAll() {
          sseHub.closeAll()
          applicationSseHub.closeAll()
          applicationEventBus.close()
        },
      },
      stoppers: [
        () => updateCheckSchedule.stop(),
        () => backupSchedule?.stop(),
        () => catalogRefreshCoordinator?.stop(),
        () => catalogStatusService?.stop(),
        () => contributionDelivery?.stop(store),
        () => telemetryRetentionSchedule?.stop(),
        () => notificationEventUnsubscribe?.(),
        () => notificationRuntime?.stop(),
        () => systemsAttention?.stop(),
        () => agentLifecycleScheduler?.stop(),
        () => sharingEnrollmentCoordinator?.stop(),
        () => sharingPublicationCoordinator?.stop(),
        () => sharingEventCoordinator?.stop(),
        () => sharingProjectUnsubscribe?.(),
        () => sharingMetadataUnsubscribe?.(),
      ],
      flush: () => demoManager ? demoManager.flushAll() : store.flush(),
      closers: demoManager
        ? [() => demoManager.closeAll()]
        : [() => sqliteRuntime?.close()],
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
