import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from '../db/store.mjs'
import { createOwnerAccount, ensureProtectedOwnerRole } from '../auth/model.mjs'
import { BackupService } from './backup-service.mjs'
import { installationPublicKeyId } from '../../packages/catalog-protocol/src/index.ts'

const tempDirs = []
const stores = []

async function createContext({ onRestoreApplied = null } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-service-'))
  tempDirs.push(dataDir)
  const store = new HomelabInventoryStore({
    appVersion: '1.0.0',
    dataDir,
    legacyProjectPath: path.join(dataDir, 'legacy.json'),
    saveDebounceMs: 1,
    seedEmptyData: false,
    seedDir: path.join(dataDir, 'missing-seed'),
  })
  await store.init()
  stores.push(store)
  const service = new BackupService({ store, appVersion: '1.0.0', onRestoreApplied })
  await service.init()
  return { dataDir, service, store }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('portable backup service', () => {
  async function writeEnrollment(dataDir, clientInstanceId, tokenCharacter) {
    const directory = path.join(dataDir, 'registry')
    const { privateKey } = generateKeyPairSync('ed25519')
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
    const publicKeyId = await installationPublicKeyId(publicKey)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(directory, 'installation-instance.json'), `${JSON.stringify({ version: 1, clientInstanceId })}\n`, { mode: 0o600 })
    await fs.writeFile(path.join(directory, 'installation-ed25519.pem'), privateKeyPem, { mode: 0o600 })
    await fs.writeFile(path.join(directory, 'installation-credentials.json'), `${JSON.stringify({
      installationKey: '22222222-2222-4222-8222-222222222222',
      publicKeyId,
      token: tokenCharacter.repeat(43),
      tokenScope: 'contributions:write',
      tokenExpiresAt: '2099-01-01T00:00:00.000Z',
      clientInstanceId,
    })}\n`, { mode: 0o600 })
    return { privateKeyPem, publicKeyId }
  }

  it.each(['archive', ['archive'], { length: 128 }, new Uint8Array([1, 2, 3])])(
    'rejects non-Buffer upload input %#',
    async (archive) => {
      const { service } = await createContext()

      await expect(service.inspect(archive))
        .rejects.toMatchObject({ code: 'invalid-backup', status: 400 })
    },
  )

  it('rejects weak encryption passphrases as input errors', async () => {
    const { service } = await createContext()

    await expect(service.create({ sections: ['inventory'], passphrase: 'too-short' }))
      .rejects.toMatchObject({ code: 'backup-passphrase-invalid', status: 400 })
  })

  it('requires encryption when owner authentication contains credentials', async () => {
    const { service, store } = await createContext()
    const timestamp = new Date().toISOString()
    store.updateAuthentication((draft) => {
      draft.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
      draft.localCredentials.push({ id: 1, accountId: 1, passwordHash: '$argon2id$credential-hash-placeholder', createdAt: timestamp, updatedAt: timestamp })
      draft.nextAccountId = 2
      draft.nextLocalCredentialId = 2
      ensureProtectedOwnerRole(draft, 1)
      draft.configuration.enabled = true
      draft.configuration.localEnabled = true
      draft.configuration.updatedAt = timestamp
    })
    await store.flush()

    await expect(service.create({ sections: ['authentication'] }))
      .rejects.toMatchObject({ code: 'backup-passphrase-required', status: 400 })

    const created = await service.create({
      sections: ['authentication'],
      passphrase: 'correct horse battery staple',
    })
    await expect(service.verify(created.record.id, 'correct horse battery staple'))
      .resolves.toMatchObject({ ok: true, encrypted: true })
  })

  it('verifies encryption and restores selected inventory with a safety backup', async () => {
    const { service, store } = await createContext()
    store.createInventoryItems({
      type: 'cpu',
      name: 'Intel Core i5-10500T',
      manufacturer: 'Intel',
      model: 'i5-10500T',
    })
    await store.flush()

    const created = await service.create({
      sections: ['inventory'],
      label: 'CPU baseline',
      passphrase: 'correct horse battery staple',
    })

    await expect(service.verify(created.record.id, 'incorrect passphrase'))
      .rejects.toThrow('Backup passphrase is incorrect')
    await expect(service.verify(created.record.id, 'correct horse battery staple'))
      .resolves.toMatchObject({ ok: true, encrypted: true })
    await expect(service.download(created.record.id, 'incorrect passphrase'))
      .rejects.toMatchObject({ code: 'backup-passphrase-invalid', status: 400 })

    store.createInventoryItems({ type: 'cpu', name: 'Temporary CPU' })
    await store.flush()
    const projectBeforeRestore = structuredClone(store.databases.project.data)

    const inspection = await service.inspect(created.archive, 'correct horse battery staple')
    const preflight = await service.preflight(inspection.token, ['inventory'])
    expect(preflight).toMatchObject({
      ok: true,
      sections: ['inventory'],
      changes: [{ section: 'inventory', action: 'Replace local section' }],
      blockers: [],
    })

    await expect(service.restore(inspection.token, ['inventory']))
      .resolves.toMatchObject({ ok: true, reloadRequired: true })

    expect(store.databases.inventory.data.cpus.map((cpu) => cpu.name))
      .toEqual(['Intel Core i5-10500T'])
    expect(store.databases.project.data).toEqual(projectBeforeRestore)
    expect(service.status().backups.map((backup) => backup.kind)).toEqual([
      'pre-restore',
      'manual',
    ])
    expect(service.status().restores).toMatchObject([{
      id: 1,
      status: 'success',
      sections: ['inventory'],
      preRestoreBackupId: 2,
    }])
  })

  it('notifies runtime services after applying restored authentication state', async () => {
    const notifications = []
    const { service, store } = await createContext({
      onRestoreApplied: async (event) => notifications.push(event),
    })
    const created = await service.create({ sections: ['authentication'] })
    store.updateAuthentication((draft) => {
      draft.configuration.updatedAt = new Date().toISOString()
    })
    await store.flush(['authentication'])

    const inspection = await service.inspect(created.archive)
    await service.restore(inspection.token, ['authentication'])

    expect(notifications).toEqual([{
      sections: ['authentication'],
      phase: 'restore',
    }])
  })

  it('restores the stable enrollment UUID, key, and credentials with private modes', async () => {
    const { dataDir, service } = await createContext()
    const originalId = '11111111-2222-4333-8444-555555555555'
    const replacementId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const original = await writeEnrollment(dataDir, originalId, 'a')
    const created = await service.create({
      sections: ['registryEnrollment'],
      passphrase: 'correct horse battery staple',
    })
    await writeEnrollment(dataDir, replacementId, 'b')

    const inspection = await service.inspect(created.archive, 'correct horse battery staple')
    expect((await service.preflight(inspection.token, ['registryEnrollment'])).ok).toBe(true)
    await service.restore(inspection.token, ['registryEnrollment'])

    const directory = path.join(dataDir, 'registry')
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700)
    expect(JSON.parse(await fs.readFile(path.join(directory, 'installation-instance.json'), 'utf8')).clientInstanceId).toBe(originalId)
    expect(await fs.readFile(path.join(directory, 'installation-ed25519.pem'), 'utf8')).toBe(original.privateKeyPem)
    expect(JSON.parse(await fs.readFile(path.join(directory, 'installation-credentials.json'), 'utf8')).clientInstanceId).toBe(originalId)
    for (const name of ['installation-instance.json', 'installation-ed25519.pem', 'installation-credentials.json']) {
      expect((await fs.stat(path.join(directory, name))).mode & 0o777).toBe(0o600)
    }
  })

  it('rolls back selected stores when a restore fails after replacement', async () => {
    const notifications = []
    const { service, store } = await createContext({
      onRestoreApplied: async (event) => notifications.push(event),
    })
    store.createInventoryItems({ type: 'cpu', name: 'Baseline CPU' })
    await store.flush()
    const created = await service.create({ sections: ['inventory'], label: 'Baseline' })

    store.createInventoryItems({ type: 'cpu', name: 'Keep after rollback' })
    await store.flush()
    const inventoryBeforeRestore = structuredClone(store.databases.inventory.data)
    const inspection = await service.inspect(created.archive)
    const replaceExternalFiles = service.replaceExternalFiles.bind(service)
    let shouldFail = true
    service.replaceExternalFiles = async (...args) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('Simulated external replacement failure.')
      }
      return replaceExternalFiles(...args)
    }

    await expect(service.restore(inspection.token, ['inventory']))
      .rejects.toThrow('Simulated external replacement failure.')

    expect(store.databases.inventory.data).toEqual(inventoryBeforeRestore)
    expect(service.status().restores).toMatchObject([{
      id: 1,
      status: 'rolled-back',
      sections: ['inventory'],
    }])
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({ phase: 'rollback' })
    expect(notifications[0].sections).toContain('authentication')
    await expect(service.journal.read()).resolves.toBeNull()
  })
})
