import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { nextRelationalId } from './model.mjs'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export class NotificationSecretVault {
  constructor({ dataDir, store, now = () => Date.now() }) {
    if (!dataDir || !store) throw new Error('NotificationSecretVault requires dataDir and store.')
    this.keyDir = path.join(dataDir, 'notifications')
    this.keyPath = path.join(this.keyDir, 'master-key')
    this.store = store
    this.now = now
    this.key = null
  }

  async init() {
    await fs.mkdir(this.keyDir, { recursive: true, mode: 0o700 })
    if (!(await pathExists(this.keyPath))) {
      await fs.writeFile(this.keyPath, crypto.randomBytes(KEY_BYTES), { mode: 0o600, flag: 'wx' })
    }
    await fs.chmod(this.keyPath, 0o600)
    const key = await fs.readFile(this.keyPath)
    if (key.length !== KEY_BYTES) throw new Error('Notification master key is invalid.')
    this.key = key
    return this
  }

  async reload() {
    this.key = null
    return this.init()
  }

  #requireKey() {
    if (!this.key) throw new Error('NotificationSecretVault is not initialized.')
  }

  async seal(value, existingId = null) {
    this.#requireKey()
    if (typeof value !== 'string' || value.length === 0 || value.length > 32_768) {
      throw new Error('Notification secret must be a non-empty string under 32 KiB.')
    }
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const envelope = {
      algorithm: ALGORITHM,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      updatedAt: new Date(this.now()).toISOString(),
    }
    return this.store.mutateSecrets((draft) => {
      if (existingId !== null) {
        const existing = draft.secrets.find((candidate) => candidate.id === existingId)
        if (!existing) throw new Error(`Notification secret ${existingId} does not exist.`)
        Object.assign(existing, envelope)
        return existing.id
      }
      const id = nextRelationalId(draft, 'secret')
      draft.secrets.push({ id, ...envelope, createdAt: envelope.updatedAt })
      return id
    })
  }

  async open(secretId) {
    this.#requireKey()
    const envelope = this.store.readSecrets().secrets.find((candidate) => candidate.id === secretId)
    if (!envelope) throw new Error(`Notification secret ${secretId} does not exist.`)
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }

  async remove(secretId) {
    return this.store.mutateSecrets((draft) => {
      const index = draft.secrets.findIndex((candidate) => candidate.id === secretId)
      if (index === -1) return false
      draft.secrets.splice(index, 1)
      return true
    })
  }
}
