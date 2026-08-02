import fs from 'node:fs/promises'
import path from 'node:path'

async function writePrivateJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, filePath)
}

export class RestoreJournal {
  constructor(dataDir) {
    this.directory = path.join(dataDir, 'backups', 'user', '.restore')
    this.filePath = path.join(this.directory, 'active.json')
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    await fs.chmod(this.directory, 0o700)
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async write(value) {
    await this.init()
    await writePrivateJson(this.filePath, value)
  }

  async clear() {
    await fs.rm(this.filePath, { force: true })
  }
}
