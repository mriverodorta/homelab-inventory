import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NotificationSecretVault } from './secret-vault.mjs'
import { NotificationStore } from './store.mjs'

const directories = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})
describe('NotificationSecretVault', () => {
  it('encrypts secrets with an installation-local 0600 key', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-vault-'))
    directories.push(dataDir)
    const store = await new NotificationStore({ dataDir }).init()
    const vault = await new NotificationSecretVault({ dataDir, store }).init()
    const id = await vault.seal('private-token')

    expect(await vault.open(id)).toBe('private-token')
    expect((await fs.stat(vault.keyPath)).mode & 0o777).toBe(0o600)
    expect(await fs.readFile(store.paths.secrets, 'utf8')).not.toContain('private-token')
  })

  it('updates an existing secret without changing its numeric id', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-vault-'))
    directories.push(dataDir)
    const store = await new NotificationStore({ dataDir }).init()
    const vault = await new NotificationSecretVault({ dataDir, store }).init()
    const id = await vault.seal('first')
    expect(await vault.seal('second', id)).toBe(id)
    expect(await vault.open(id)).toBe('second')
  })
})
