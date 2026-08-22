import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const SHARING_INSTANCE_FILE = 'installation-instance.json'
export const SHARING_INSTANCE_VERSION = 1

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export function normalizeSharingInstance(value) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== SHARING_INSTANCE_VERSION
    || typeof value.clientInstanceId !== 'string'
    || !UUID_V4.test(value.clientInstanceId)
  ) {
    throw new Error('Sharing installation instance is invalid. Restore installation-instance.json from backup instead of replacing it.')
  }
  return { version: SHARING_INSTANCE_VERSION, clientInstanceId: value.clientInstanceId }
}

export function parseSharingInstance(body) {
  try {
    return normalizeSharingInstance(JSON.parse(Buffer.from(body).toString('utf8')))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Sharing installation instance is invalid JSON. Restore installation-instance.json from backup instead of replacing it.')
    }
    throw error
  }
}

export async function ensureSharingInstance(dataDir) {
  const directory = path.join(dataDir, 'sharing')
  const filePath = path.join(directory, SHARING_INSTANCE_FILE)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.chmod(directory, 0o700)
  try {
    const instance = parseSharingInstance(await fs.readFile(filePath))
    await fs.chmod(filePath, 0o600)
    return instance
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const instance = { version: SHARING_INSTANCE_VERSION, clientInstanceId: randomUUID() }
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(instance, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await fs.chmod(temporary, 0o600)
    try {
      await fs.link(temporary, filePath)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
  const persisted = parseSharingInstance(await fs.readFile(filePath))
  await fs.chmod(filePath, 0o600)
  return persisted
}
