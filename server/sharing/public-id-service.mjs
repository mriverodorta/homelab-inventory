import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const SHARING_PUBLIC_ID_KEY_FILE = 'public-id-key'

export class SharingPublicIdService {
  constructor({ dataDir, key = null }) {
    if (!dataDir && !key) throw new Error('Sharing public IDs require a data directory or key.')
    this.directory = dataDir ? path.join(dataDir, 'sharing') : null
    this.keyPath = this.directory ? path.join(this.directory, SHARING_PUBLIC_ID_KEY_FILE) : null
    this.key = key ? Buffer.from(key) : null
  }

  async ensureKey() {
    if (this.key) return this.key
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    await fs.chmod(this.directory, 0o700)
    try {
      this.key = await fs.readFile(this.keyPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const temporary = `${this.keyPath}.${process.pid}.${Date.now()}.tmp`
      try {
        await fs.writeFile(temporary, randomBytes(32), { mode: 0o600, flag: 'wx' })
        try {
          await fs.link(temporary, this.keyPath)
        } catch (linkError) {
          if (linkError?.code !== 'EEXIST') throw linkError
        }
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {})
      }
      this.key = await fs.readFile(this.keyPath)
    }
    if (this.key.length !== 32) throw new Error('Sharing public ID key is invalid.')
    await fs.chmod(this.keyPath, 0o600)
    return this.key
  }

  async id(namespace, relationalId) {
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(namespace)) throw new Error('Sharing public ID namespace is invalid.')
    if (!Number.isSafeInteger(relationalId) || relationalId <= 0) throw new Error('Sharing public IDs require positive relational IDs.')
    const key = await this.ensureKey()
    const digest = createHmac('sha256', key).update(`${namespace}:${relationalId}`).digest('base64url').slice(0, 24)
    return `${namespace}_${digest}`
  }
}
