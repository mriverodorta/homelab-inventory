import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from '../db/store.mjs'
import { BackupService } from './backup-service.mjs'

const tempDirs = []
const stores = []

async function createContext() {
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
  const service = new BackupService({ store, appVersion: '1.0.0' })
  await service.init()
  return { dataDir, service, store }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('portable backup service', () => {
  it('rejects weak encryption passphrases as input errors', async () => {
    const { service } = await createContext()

    await expect(service.create({ sections: ['inventory'], passphrase: 'too-short' }))
      .rejects.toMatchObject({ code: 'backup-passphrase-invalid', status: 400 })
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

  it('rolls back selected stores when a restore fails after replacement', async () => {
    const { service, store } = await createContext()
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
    await expect(service.journal.read()).resolves.toBeNull()
  })
})
