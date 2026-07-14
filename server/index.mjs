import express from 'express'
import { rateLimit } from 'express-rate-limit'
import fs from 'node:fs/promises'
import helmet from 'helmet'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_NOTES } from '../src/release-notes.ts'
import { registerAgentRoutes } from './agent-routes.mjs'
import { HomelabInventoryStore } from './db/store.mjs'
import { createRateLimitOptions, readRateLimitConfig } from './rate-limit.mjs'
import { DockerHubUpdateChecker } from './update-checker.mjs'
import { registerUpdateRoutes } from './update-routes.mjs'
import { startUpdateCheckSchedule } from './update-scheduler.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProduction = process.env.NODE_ENV === 'production'
const appMode = process.env.APP_MODE ?? 'production'
const isDemoMode = appMode === 'demo'
const port = Number(process.env.PORT ?? 5173)
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const demoSourceDir = process.env.DEMO_SOURCE_DIR ?? '/read-only-data'
const demoSessionMinutes = Number(process.env.DEMO_SESSION_MINUTES ?? 30)
const demoMaxSessions = Number(process.env.DEMO_MAX_SESSIONS ?? 100)
const saveDebounceMs = Number(process.env.SAVE_DEBOUNCE_MS ?? 500)
const legacyProjectPath = process.env.PROJECT_DB_PATH ?? path.join(dataDir, 'homelab-inventory-project.json')
const seedEmptyData = process.env.SEED_EMPTY_DATA === undefined
  ? !isProduction
  : process.env.SEED_EMPTY_DATA === 'true'
const seedDir = path.join(root, 'server', 'seed')
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const configuredUpdateChannel = process.env.UPDATE_CHANNEL ?? (isDemoMode ? 'latest' : 'stable')
const updateChannel = ['stable', 'latest'].includes(configuredUpdateChannel)
  ? configuredUpdateChannel
  : 'stable'
const updateCheckEnabled = process.env.UPDATE_CHECK_ENABLED !== 'false'
const runningRevision = process.env.APP_REVISION ?? 'unknown'

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
  scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
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

app.use(rateLimit(createRateLimitOptions(rateLimitConfig)))
app.use(express.json({ limit: '10mb' }))

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
  const demo = await demoManager.getOrCreateSessionStore(sessionCookie)

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
    const busy = error instanceof Error && error.message === 'The public demo is temporarily busy.'
    const status = busy ? 503 : (options.status ?? 500)

    response.status(status).json({
      message: error instanceof Error ? error.message : (options.message ?? 'Unable to access data store.'),
    })
  }
}

registerUpdateRoutes(app, {
  withStore,
  checker: updateChecker,
  releaseNotes: RELEASE_NOTES,
})

startUpdateCheckSchedule({
  checker: updateChecker,
  store,
})

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    mode: isDemoMode ? 'demo' : 'production',
    schemaVersion: isDemoMode ? null : store.databases.meta.data.schemaVersion,
  })
})

app.get('/api/project', (request, response) => {
  void withStore(request, response, async (currentStore) => {
    response.json(currentStore.getProject())
  }, { message: 'Unable to load project.' })
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

app.put('/api/project', (request, response) => {
  void withStore(request, response, async (currentStore) => {
    response.json(currentStore.setProject(request.body))
  }, { status: 400, message: 'Unable to save project.' })
})

app.post('/api/inventory/items', (request, response) => {
  void withStore(request, response, async (currentStore) => {
    response.status(201).json(currentStore.addInventoryItem(request.body))
  }, { status: 400, message: 'Unable to create item.' })
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
    if (sessionId) {
      await demoManager.expireSession(sessionId)
    }

    response.clearCookie(app.locals.demoCookieName, { path: '/' })
    response.json({ ok: true })
  })()
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

async function shutdown(signal) {
  console.log(`${signal} received; flushing lowdb stores.`)
  server.close(async () => {
    try {
      if (demoManager) {
        await demoManager.flushAll()
      } else {
        await store.flush()
      }

      process.exit(0)
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
