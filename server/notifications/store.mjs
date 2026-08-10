import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  assertNotificationConfig,
  assertNotificationSecrets,
  assertNotificationState,
  createNotificationConfig,
  createNotificationSecrets,
  createNotificationState,
  normalizeNotificationConfig,
  normalizeNotificationSecrets,
  normalizeNotificationState,
} from './model.mjs'

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJsonAtomic(filePath, value, mode = 0o600) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode })
  await fs.rename(temporaryPath, filePath)
  await fs.chmod(filePath, mode)
}

export class NotificationStore {
  constructor({ dataDir, now = () => Date.now() }) {
    if (!dataDir) throw new Error('NotificationStore requires dataDir.')
    this.dataDir = dataDir
    this.now = now
    this.storesDir = path.join(dataDir, 'stores')
    this.paths = {
      config: path.join(this.storesDir, 'notifications.json'),
      state: path.join(this.storesDir, 'notification-state.json'),
      secrets: path.join(this.storesDir, 'notification-secrets.json'),
    }
    this.data = null
    this.queue = Promise.resolve()
  }

  async init() {
    await fs.mkdir(this.storesDir, { recursive: true })
    const defaults = {
      config: createNotificationConfig(this.now()),
      state: createNotificationState(this.now()),
      secrets: createNotificationSecrets(this.now()),
    }
    for (const [name, filePath] of Object.entries(this.paths)) {
      if (!(await exists(filePath))) await writeJsonAtomic(filePath, defaults[name])
    }
    const [config, state, secrets] = await Promise.all([
      readJson(this.paths.config),
      readJson(this.paths.state),
      readJson(this.paths.secrets),
    ])
    this.data = {
      config: normalizeNotificationConfig(config, this.now()),
      state: normalizeNotificationState(state, this.now()),
      secrets: normalizeNotificationSecrets(secrets, this.now()),
    }
    this.#validateAll()
    await this.flush()
    return this
  }

  #requireInitialized() {
    if (!this.data) throw new Error('NotificationStore is not initialized.')
  }

  #validateAll() {
    assertNotificationConfig(this.data.config)
    assertNotificationState(this.data.state)
    assertNotificationSecrets(this.data.secrets)
  }

  readConfig() {
    this.#requireInitialized()
    return structuredClone(this.data.config)
  }

  readState() {
    this.#requireInitialized()
    return structuredClone(this.data.state)
  }

  readSecrets() {
    this.#requireInitialized()
    return structuredClone(this.data.secrets)
  }

  mutateConfig(mutator) {
    return this.#mutate('config', mutator)
  }

  mutateState(mutator) {
    return this.#mutate('state', mutator)
  }

  mutateSecrets(mutator) {
    return this.#mutate('secrets', mutator)
  }

  async #mutate(name, mutator) {
    this.#requireInitialized()
    const operation = async () => {
      const draft = structuredClone(this.data[name])
      const result = await mutator(draft)
      if (isDeepStrictEqual(draft, this.data[name])) {
        return result === undefined ? structuredClone(this.data[name]) : structuredClone(result)
      }
      draft.updatedAt = new Date(this.now()).toISOString()
      if (name === 'config') {
        draft.revision += 1
        assertNotificationConfig(draft)
      } else if (name === 'state') {
        assertNotificationState(draft)
      } else {
        assertNotificationSecrets(draft)
      }
      await writeJsonAtomic(this.paths[name], draft)
      this.data[name] = draft
      return result === undefined ? structuredClone(draft) : structuredClone(result)
    }
    const next = this.queue.then(operation, operation)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  async flush() {
    this.#requireInitialized()
    await this.queue
    this.#validateAll()
    await Promise.all(Object.entries(this.paths).map(([name, filePath]) => writeJsonAtomic(filePath, this.data[name])))
  }

  async replace({ config, state, secrets }) {
    this.#requireInitialized()
    const operation = async () => {
      const next = {
        config: config ? normalizeNotificationConfig(config, this.now()) : structuredClone(this.data.config),
        state: state ? normalizeNotificationState(state, this.now()) : structuredClone(this.data.state),
        secrets: secrets ? normalizeNotificationSecrets(secrets, this.now()) : structuredClone(this.data.secrets),
      }
      if (config) {
        next.config.revision = Math.max(next.config.revision, this.data.config.revision + 1)
        next.config.updatedAt = new Date(this.now()).toISOString()
      }
      assertNotificationConfig(next.config)
      assertNotificationState(next.state)
      assertNotificationSecrets(next.secrets)
      const previous = structuredClone(this.data)
      try {
        for (const [name, filePath] of Object.entries(this.paths)) {
          if (next[name] !== this.data[name]) await writeJsonAtomic(filePath, next[name])
        }
        this.data = next
      } catch (error) {
        await Promise.all(Object.entries(this.paths).map(([name, filePath]) => writeJsonAtomic(filePath, previous[name])))
        this.data = previous
        throw error
      }
      return { config: this.readConfig(), state: this.readState() }
    }
    const queued = this.queue.then(operation, operation)
    this.queue = queued.then(() => undefined, () => undefined)
    return queued
  }
}
