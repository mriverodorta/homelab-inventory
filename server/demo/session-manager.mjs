import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { HomelabInventoryStore } from '../db/store.mjs'
import { sanitizeDemoStores } from './sanitizer.mjs'

const INDEX_FILE = 'index.json'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

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
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

function nowIso() {
  return new Date().toISOString()
}

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

function expired(session) {
  return Date.parse(session.expiresAt) <= Date.now()
}

function createSessionId() {
  return crypto.randomBytes(24).toString('base64url')
}

export const DEMO_COOKIE_NAME = 'homelab_inventory_demo_session'

export class DemoSessionManager {
  constructor({
    appVersion,
    dataDir,
    sourceDir,
    sessionMinutes = 30,
    maxSessions = 100,
    saveDebounceMs = 500,
  }) {
    this.appVersion = appVersion
    this.dataDir = dataDir
    this.sourceDir = sourceDir
    this.sessionMinutes = sessionMinutes
    this.maxSessions = maxSessions
    this.saveDebounceMs = saveDebounceMs
    this.sessionsDir = path.join(dataDir, 'demo-sessions')
    this.indexPath = path.join(this.sessionsDir, INDEX_FILE)
    this.sessions = {}
    this.stores = new Map()
  }

  async init() {
    await this.validateSource()
    await fs.mkdir(this.sessionsDir, { recursive: true })
    this.sessions = await readJson(this.indexPath, {})
    await this.cleanupExpiredSessions()
  }

  async validateSource() {
    const required = [
      path.join(this.sourceDir, 'meta.json'),
      path.join(this.sourceDir, 'stores', 'inventory.json'),
      path.join(this.sourceDir, 'stores', 'project.json'),
    ]

    for (const filePath of required) {
      if (!(await pathExists(filePath))) {
        throw new Error(`Demo source data is missing required file: ${filePath}`)
      }
    }
  }

  async saveIndex() {
    await writeJson(this.indexPath, this.sessions)
  }

  async getSession(sessionId) {
    if (!sessionId || !this.sessions[sessionId] || expired(this.sessions[sessionId])) {
      return null
    }

    return this.sessions[sessionId]
  }

  async getOrCreateSessionStore(sessionId) {
    await this.cleanupExpiredSessions()

    const existing = await this.getSession(sessionId)
    if (existing) {
      existing.lastSeenAt = nowIso()
      await this.saveIndex()

      return {
        sessionId: existing.id,
        session: existing,
        store: await this.openStore(existing),
      }
    }

    if (Object.keys(this.sessions).length >= this.maxSessions) {
      throw new Error('The public demo is temporarily busy.')
    }

    const id = createSessionId()
    const dataDir = path.join(this.sessionsDir, id)
    const session = {
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

    this.sessions[id] = session
    await this.saveIndex()

    return {
      sessionId: id,
      session,
      store: await this.openStore(session),
    }
  }

  async openStore(session) {
    if (this.stores.has(session.id)) {
      return this.stores.get(session.id)
    }

    const store = new HomelabInventoryStore({
      appVersion: this.appVersion,
      dataDir: session.dataDir,
      legacyProjectPath: path.join(session.dataDir, 'homelab-inventory-project.json'),
      saveDebounceMs: this.saveDebounceMs,
      seedEmptyData: false,
      seedDir: path.join(session.dataDir, 'missing-seed'),
    })

    await store.init()
    this.stores.set(session.id, store)

    return store
  }

  async extendSession(sessionId) {
    const session = await this.getSession(sessionId)

    if (!session) {
      throw new Error('Demo session is expired.')
    }

    session.expiresAt = addMinutes(this.sessionMinutes)
    session.lastSeenAt = nowIso()
    await this.saveIndex()

    return this.sessionStatus(session)
  }

  async expireSession(sessionId) {
    const session = this.sessions[sessionId]

    if (!session) {
      return
    }

    const store = this.stores.get(sessionId)
    if (store) {
      await store.flush().catch(() => {})
      this.stores.delete(sessionId)
    }

    delete this.sessions[sessionId]
    await fs.rm(session.dataDir, { recursive: true, force: true })
    await this.saveIndex()
  }

  async cleanupExpiredSessions() {
    const expiredIds = Object.values(this.sessions)
      .filter((session) => expired(session))
      .map((session) => session.id)

    for (const sessionId of expiredIds) {
      await this.expireSession(sessionId)
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
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.DEMO_COOKIE_SECURE === 'true',
      maxAge: COOKIE_MAX_AGE_SECONDS * 1000,
      path: '/',
    }
  }

  async flushAll() {
    await Promise.all([...this.stores.values()].map((store) => store.flush().catch(() => {})))
  }
}
