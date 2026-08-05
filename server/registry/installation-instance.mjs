import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const INSTALLATION_INSTANCE_FILE = 'installation-instance.json'
export const INSTALLATION_INSTANCE_VERSION = 1

const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function normalizeInstallationInstance(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.version !== INSTALLATION_INSTANCE_VERSION
    || typeof value.clientInstanceId !== 'string'
    || !CANONICAL_UUID_V4.test(value.clientInstanceId)
  ) {
    throw new Error('Registry installation instance is invalid. Restore installation-instance.json from backup instead of replacing it.')
  }
  return {
    version: INSTALLATION_INSTANCE_VERSION,
    clientInstanceId: value.clientInstanceId,
  }
}

export function parseInstallationInstance(body) {
  try {
    return normalizeInstallationInstance(JSON.parse(Buffer.from(body).toString('utf8')))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Registry installation instance is invalid JSON. Restore installation-instance.json from backup instead of replacing it.')
    }
    throw error
  }
}

async function writeAtomicallyIfMissing(filePath, body) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fs.writeFile(temporary, body, { mode: 0o600, flag: 'wx' })
    await fs.chmod(temporary, 0o600)
    try {
      await fs.link(temporary, filePath)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

export async function ensureInstallationInstance(dataDir) {
  const directory = path.join(dataDir, 'registry')
  const filePath = path.join(directory, INSTALLATION_INSTANCE_FILE)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.chmod(directory, 0o700)
  try {
    const instance = parseInstallationInstance(await fs.readFile(filePath))
    await fs.chmod(filePath, 0o600)
    return instance
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const instance = {
    version: INSTALLATION_INSTANCE_VERSION,
    clientInstanceId: randomUUID(),
  }
  await writeAtomicallyIfMissing(filePath, `${JSON.stringify(instance, null, 2)}\n`)
  const persisted = parseInstallationInstance(await fs.readFile(filePath))
  await fs.chmod(filePath, 0o600)
  return persisted
}
