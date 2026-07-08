import express from 'express'
import fs from 'node:fs/promises'
import helmet from 'helmet'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAgentRoutes } from './agent-routes.mjs'
import { HomelabInventoryStore } from './db/store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? 5173)
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const saveDebounceMs = Number(process.env.SAVE_DEBOUNCE_MS ?? 500)
const legacyProjectPath = process.env.PROJECT_DB_PATH ?? path.join(dataDir, 'homelab-inventory-project.json')
const seedEmptyData = process.env.SEED_EMPTY_DATA === undefined
  ? !isProduction
  : process.env.SEED_EMPTY_DATA === 'true'
const seedDir = path.join(root, 'server', 'seed')
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))

const store = new HomelabInventoryStore({
  appVersion: packageJson.version,
  dataDir,
  legacyProjectPath,
  saveDebounceMs,
  seedEmptyData,
  seedDir,
})

await store.init()

const app = express()
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

app.use(express.json({ limit: '10mb' }))

registerAgentRoutes(app, store)

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    schemaVersion: store.databases.meta.data.schemaVersion,
  })
})

app.get('/api/project', (_request, response) => {
  try {
    response.json(store.getProject())
  } catch (error) {
    response.status(500).json({ message: error instanceof Error ? error.message : 'Unable to load project.' })
  }
})

app.put('/api/project', async (request, response) => {
  try {
    const project = store.setProject(request.body)
    response.json(project)
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save project.' })
  }
})

app.post('/api/inventory/items', async (request, response) => {
  try {
    const project = store.addInventoryItem(request.body)
    response.status(201).json(project)
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : 'Unable to create item.' })
  }
})

app.post('/api/flush', async (_request, response) => {
  try {
    await store.flush()
    response.json({ ok: true })
  } catch (error) {
    response.status(500).json({ message: error instanceof Error ? error.message : 'Unable to flush data.' })
  }
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
      await store.flush()
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
