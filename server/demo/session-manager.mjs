import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertInventoryStoreShape, assertProjectStoreShape } from '../db/validation.mjs'
import { sanitizeDemoStores } from './sanitizer.mjs'

const INDEX_FILE = 'index.json'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const EXTENSION_GRACE_SECONDS = 30
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/

async function pathExists(filePath) {
  try {
    await fs.access(filePath)

    return true
  } catch {
    return false
  }
}

async function readJson(filePath, fallback) {
  if (!(await pathExists(filePath))) {
    return fallback
  }

  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}-${crypto.randomUUID()}.tmp`

  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

function nowIso() {
  return new Date().toISOString()
}

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

function sessionIndex(payload = {}) {
  return Object.assign(Object.create(null), payload)
}

function normalizeSessionIndex(payload, sessionsDir) {
  const normalized = sessionIndex()
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return normalized

  for (const [id, record] of Object.entries(payload)) {
    if (
      !SESSION_ID_PATTERN.test(id)
      || !record
      || typeof record !== 'object'
      || Array.isArray(record)
      || !Number.isFinite(Date.parse(record.createdAt))
      || !Number.isFinite(Date.parse(record.expiresAt))
    ) {
      continue
    }

    normalized[id] = {
      id,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastSeenAt: Number.isFinite(Date.parse(record.lastSeenAt)) ? record.lastSeenAt : record.createdAt,
      dataDir: path.join(sessionsDir, id),
    }
  }

  return normalized
}

function hasSession(sessions, sessionId) {
  return typeof sessionId === 'string' && Object.hasOwn(sessions, sessionId)
}

function expired(session, graceSeconds = 0) {
  return Date.parse(session.expiresAt) + graceSeconds * 1000 <= Date.now()
}

function createSessionId() {
  return crypto.randomBytes(24).toString('base64url')
}

export const DEMO_COOKIE_NAME = 'homelab_inventory_demo_session'

export class DemoSessionLimitError extends Error {
  constructor(message = 'Too many new demo sessions. Please try again later.') {
    super(message)
    this.name = 'DemoSessionLimitError'
    this.status = 429
  }
}

export class DemoSessionManager {
  constructor({
    appVersion,
    catalogBootstrap = null,
    dataDir,
    logger = console,
    sourceDir,
    sessionMinutes = 30,
    maxSessions = 100,
    maxSessionCreationsPerClient = 5,
    maxSessionCreationsGlobally = 50,
    sessionCreationWindowMs = 10 * 60 * 1000,
    saveDebounceMs = 500,
    storeFactory = null,
  }) {
    this.appVersion = appVersion
    this.catalogBootstrap = catalogBootstrap
    this.dataDir = dataDir
    this.logger = logger
    this.sourceDir = sourceDir
    this.sessionMinutes = sessionMinutes
    this.maxSessions = maxSessions
    this.maxSessionCreationsPerClient = maxSessionCreationsPerClient
    this.maxSessionCreationsGlobally = maxSessionCreationsGlobally
    this.sessionCreationWindowMs = sessionCreationWindowMs
    this.saveDebounceMs = saveDebounceMs
    this.storeFactory = storeFactory
    this.sessionsDir = path.join(dataDir, 'demo-sessions')
    this.indexPath = path.join(this.sessionsDir, INDEX_FILE)
    this.sessions = sessionIndex()
    this.stores = new Map()
    this.runtimes = new Map()
    this.openingStores = new Map()
    this.sessionMutationQueue = Promise.resolve()
    this.sessionCreationsByClient = new Map()
    this.globalSessionCreations = []
  }

  async init() {
    await this.validateSource()
    await fs.mkdir(this.sessionsDir, { recursive: true })
    let persistedSessions
    try {
      persistedSessions = await readJson(this.indexPath, {})
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      await fs.rename(this.indexPath, `${this.indexPath}.corrupt-${Date.now()}`)
      persistedSessions = {}
    }
    this.sessions = normalizeSessionIndex(persistedSessions, this.sessionsDir)
    await this.saveIndex()
    await this.cleanupExpiredSessions()
  }

  async validateSource() {
    const metaPath = path.join(this.sourceDir, 'meta.json')
    const inventoryPath = path.join(this.sourceDir, 'stores', 'inventory.json')
    const projectPath = path.join(this.sourceDir, 'stores', 'project.json')
    const required = [metaPath, inventoryPath, projectPath]

    for (const filePath of required) {
      if (!(await pathExists(filePath))) {
        throw new Error(`Demo source data is missing required file: ${filePath}`)
      }
    }

    const meta = await readJson(metaPath, null)
    const inventory = await readJson(inventoryPath, null)
    const project = await readJson(projectPath, null)

    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      throw new Error('Demo source metadata must be an object.')
    }

    assertInventoryStoreShape(inventory)
    assertProjectStoreShape(project)
  }

  async saveIndex() {
    await writeJson(this.indexPath, this.sessions)
  }

  withSessionMutation(task) {
    const operation = this.sessionMutationQueue.catch(() => {}).then(task)
    this.sessionMutationQueue = operation
    return operation
  }

  recordSessionCreation(clientKey = 'unknown') {
    const cutoff = Date.now() - this.sessionCreationWindowMs
    const prune = (timestamps) => timestamps.filter((timestamp) => timestamp > cutoff)
    const normalizedClientKey = String(clientKey || 'unknown').slice(0, 256)
    const clientCreations = prune(this.sessionCreationsByClient.get(normalizedClientKey) ?? [])
    this.globalSessionCreations = prune(this.globalSessionCreations)

    if (
      clientCreations.length >= this.maxSessionCreationsPerClient
      || this.globalSessionCreations.length >= this.maxSessionCreationsGlobally
    ) {
      throw new DemoSessionLimitError()
    }

    const timestamp = Date.now()
    clientCreations.push(timestamp)
    this.globalSessionCreations.push(timestamp)
    this.sessionCreationsByClient.set(normalizedClientKey, clientCreations)
  }

  async getSession(sessionId) {
    if (!hasSession(this.sessions, sessionId) || expired(this.sessions[sessionId])) {
      return null
    }

    return this.sessions[sessionId]
  }

  async getOrCreateSessionStore(sessionId, { clientKey = 'unknown' } = {}) {
    let session = await this.withSessionMutation(async () => {
      await this.cleanupExpiredSessionsUnlocked()

      const existing = await this.getSession(sessionId)
      if (existing) {
        existing.lastSeenAt = nowIso()
        await this.saveIndex()
        return existing
      }

      if (Object.keys(this.sessions).length >= this.maxSessions) {
        throw new Error('The public demo is temporarily busy.')
      }

      this.recordSessionCreation(clientKey)
      const id = createSessionId()
      const dataDir = path.join(this.sessionsDir, id)
      const created = {
        id,
        createdAt: nowIso(),
        expiresAt: addMinutes(this.sessionMinutes),
        lastSeenAt: nowIso(),
        dataDir,
      }

      await sanitizeDemoStores({
        sourceDir: this.sourceDir,
        targetDir: dataDir,
        appVersion: this.appVersion,
      })

      this.sessions[id] = created
      await this.saveIndex()
      return created
    })

    try {
      return {
        sessionId: session.id,
        session,
        store: await this.openStore(session),
      }
    } catch {
      // Demo sessions are disposable. Rebuild stale sandboxes created by an
      // older sanitizer instead of leaving the visitor on a broken session.
      await this.expireSession(session.id)
      session = await this.withSessionMutation(async () => {
        this.recordSessionCreation(clientKey)
        const id = createSessionId()
        const dataDir = path.join(this.sessionsDir, id)
        const created = {
          id,
          createdAt: nowIso(),
          expiresAt: addMinutes(this.sessionMinutes),
          lastSeenAt: nowIso(),
          dataDir,
        }
        await sanitizeDemoStores({ sourceDir: this.sourceDir, targetDir: dataDir, appVersion: this.appVersion })
        this.sessions[id] = created
        await this.saveIndex()
        return created
      })

      return {
        sessionId: session.id,
        session,
        store: await this.openStore(session),
      }
    }
  }

  async openStore(session) {
    if (this.stores.has(session.id)) {
      return this.stores.get(session.id)
    }

    if (this.openingStores.has(session.id)) {
      return this.openingStores.get(session.id)
    }

    const opening = this.initializeStore(session)
    this.openingStores.set(session.id, opening)

    try {
      return await opening
    } finally {
      if (this.openingStores.get(session.id) === opening) {
        this.openingStores.delete(session.id)
      }
    }
  }

  async initializeStore(session) {
    const runtime = this.storeFactory
      ? await this.storeFactory(session)
      : await this.createSqliteStore(session)
    const { store } = runtime
    const registry = store.getRegistryState()
    if (registry.settings.mode !== 'connected' || registry.settings.automaticContributions) {
      store.updateRegistrySettings({ mode: 'connected', automaticContributions: false })
    }
    if (!store.getRegistryState().snapshot && this.catalogBootstrap) {
      try {
        await this.catalogBootstrap(store)
      } catch {
        this.logger.warn('Automatic demo catalog refresh failed; manual refresh remains available.')
      }
    }
    this.runtimes.set(session.id, runtime)
    this.stores.set(session.id, store)

    return store
  }

  async createSqliteStore(session) {
    const { activateSqliteRuntime } = await import('../persistence/runtime.ts')
    const runtime = await activateSqliteRuntime({
      appVersion: this.appVersion,
      dataDir: session.dataDir,
      legacyProjectPath: path.join(session.dataDir, 'homelab-inventory-project.json'),
      seedDir: path.join(session.dataDir, 'missing-seed'),
      backupServiceFactory: () => ({
        async create() {
          return { archive: Buffer.from('verified-ephemeral-demo-migration') }
        },
      }),
    })
    await Promise.all([
      fs.rm(path.join(session.dataDir, 'meta.json'), { force: true }),
      fs.rm(path.join(session.dataDir, 'stores'), { recursive: true, force: true }),
      fs.rm(path.join(session.dataDir, 'telemetry'), { recursive: true, force: true }),
    ])
    return runtime
  }

  async extendSession(sessionId) {
    return this.withSessionMutation(async () => {
      if (!hasSession(this.sessions, sessionId) || expired(this.sessions[sessionId], EXTENSION_GRACE_SECONDS)) {
        throw new Error('Demo session is expired.')
      }

      const session = this.sessions[sessionId]
      session.expiresAt = addMinutes(this.sessionMinutes)
      session.lastSeenAt = nowIso()
      await this.saveIndex()

      return this.sessionStatus(session)
    })
  }

  async expireSession(sessionId) {
    return this.withSessionMutation(() => this.expireSessionUnlocked(sessionId))
  }

  async expireSessionUnlocked(sessionId) {
    if (!hasSession(this.sessions, sessionId)) {
      return
    }

    const session = this.sessions[sessionId]
    const opening = this.openingStores.get(sessionId)
    if (opening) {
      await opening.catch(() => {})
    }
    const store = this.stores.get(sessionId)
    if (store) {
      await store.flush().catch(() => {})
      this.stores.delete(sessionId)
    }
    const runtime = this.runtimes.get(sessionId)
    if (runtime) {
      await runtime.close().catch(() => {})
      this.runtimes.delete(sessionId)
    }

    delete this.sessions[sessionId]
    await fs.rm(session.dataDir, { recursive: true, force: true })
    await this.saveIndex()
  }

  async cleanupExpiredSessions() {
    return this.withSessionMutation(() => this.cleanupExpiredSessionsUnlocked())
  }

  async cleanupExpiredSessionsUnlocked() {
    const expiredIds = Object.values(this.sessions)
      .filter((session) => expired(session, EXTENSION_GRACE_SECONDS))
      .map((session) => session.id)

    for (const sessionId of expiredIds) {
      await this.expireSessionUnlocked(sessionId)
    }
  }

  sessionStatus(session) {
    return {
      mode: 'demo',
      expiresAt: session.expiresAt,
      remainingSeconds: Math.max(0, Math.ceil((Date.parse(session.expiresAt) - Date.now()) / 1000)),
    }
  }

  cookieOptions() {
    const configuredSecure = process.env.DEMO_COOKIE_SECURE
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: configuredSecure === undefined
        ? process.env.NODE_ENV === 'production'
        : configuredSecure === 'true',
      maxAge: COOKIE_MAX_AGE_SECONDS * 1000,
      path: '/',
    }
  }

  async flushAll() {
    await Promise.allSettled(this.openingStores.values())
    await Promise.all([...this.stores.values()].map((store) => store.flush().catch(() => {})))
  }

  async closeAll() {
    await Promise.allSettled(this.openingStores.values())
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.close().catch(() => {})))
    this.runtimes.clear()
    this.stores.clear()
  }
}
