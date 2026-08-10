import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBackupManagementStore } from './backup-model.mjs'
import { collectBackupSections, materializeBackupSections, telemetryBackupFromArchive } from './backup-sections.mjs'
import { createRegistryStore } from '../registry/model.mjs'
import { createAuthenticationStore } from '../auth/model.mjs'
import { createNotificationConfig, createNotificationSecrets, createNotificationState } from '../notifications/model.mjs'
import { COMPLETE_BACKUP_SECTIONS } from '../../shared/backup/contract.mjs'

const telemetryRepository = {
  exportBackup: () => ({
    formatVersion: 1,
    schemaVersion: 1,
    tables: {
      telemetry_samples: [],
      latest_host_state: [],
      latest_component_state: [],
      component_events: [],
    },
  }),
}

const notificationStore = {
  readConfig: () => createNotificationConfig(),
  readSecrets: () => createNotificationSecrets(),
  readState: () => createNotificationState(),
}

function stores() {
  return {
    meta: { schemaVersion: 20 }, inventory: { servers: [] }, project: { id: 'default' },
    routingCache: { version: 1 }, agents: { enrollments: {}, devices: {} }, agentStatus: { servers: {} },
    registry: createRegistryStore(), backupManagement: createBackupManagementStore(),
    authentication: createAuthenticationStore(),
  }
}

describe('backup section ownership', () => {
  it('does not include backup history in application metadata', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-sections-'))
    const current = stores()
    current.backupManagement.backups.push({ private: 'history' })
    const store = { dataDir, snapshotStores: async () => current }
    const result = await collectBackupSections({ store, sections: ['applicationMetadata'] })
    const content = JSON.parse(result.files[0].body.toString())
    expect(content).toEqual({ meta: current.meta, schedule: current.backupManagement.schedule })
    expect(JSON.stringify(content)).not.toContain('history')
  })

  it('merges enrollment independently from registry configuration', () => {
    const current = stores()
    current.registry.settings.mode = 'connected'
    const files = new Map([
      ['sections/registry-enrollment.json', Buffer.from(JSON.stringify({ installationIdentity: { state: 'active' } }))],
    ])
    const replacements = materializeBackupSections({ files, sections: ['registryEnrollment'], currentStores: current })
    expect(replacements.registry.settings.mode).toBe('connected')
    expect(replacements.registry.installationIdentity).toEqual({ state: 'active' })
  })

  it('keeps destination enrollment when restoring registry configuration only', () => {
    const current = stores()
    const enrollment = {
      installationKey: '22222222-2222-4222-8222-222222222222',
      publicKeyId: 'a'.repeat(64),
      clientInstanceId: '11111111-2222-4333-8444-555555555555',
      state: 'active',
    }
    current.registry.installationIdentity = enrollment
    const files = new Map([[
      'sections/registry-configuration.json',
      Buffer.from(JSON.stringify({ ...createRegistryStore(), settings: { ...createRegistryStore().settings, mode: 'offline' } })),
    ]])

    const replacements = materializeBackupSections({ files, sections: ['registryConfiguration'], currentStores: current })

    expect(replacements.registry.settings.mode).toBe('offline')
    expect(replacements.registry.installationIdentity).toEqual(enrollment)
  })

  it('restores pre-SQLite agent telemetry archives with an empty history', () => {
    expect(telemetryBackupFromArchive(new Map()).tables).toEqual({
      telemetry_samples: [],
      latest_host_state: [],
      latest_component_state: [],
      component_events: [],
    })
  })

  it('includes the stable installation instance in enrollment backups', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-enrollment-sections-'))
    const directory = path.join(dataDir, 'registry')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'installation-instance.json'), '{"version":1,"clientInstanceId":"11111111-2222-4333-8444-555555555555"}\n')
    await fs.writeFile(path.join(directory, 'installation-ed25519.pem'), 'private-key')
    await fs.writeFile(path.join(directory, 'installation-credentials.json'), '{}')

    const result = await collectBackupSections({
      store: { dataDir, snapshotStores: async () => stores() },
      sections: ['registryEnrollment'],
    })

    expect(result.files.map((file) => file.name)).toEqual([
      'sections/registry-enrollment.json',
      'registry/installation-instance.json',
      'registry/installation-ed25519.pem',
      'registry/installation-credentials.json',
    ])
    const complete = await collectBackupSections({
      store: { dataDir, snapshotStores: async () => stores() },
      sections: COMPLETE_BACKUP_SECTIONS,
      telemetryRepository,
      notificationStore,
    })
    expect(complete.files.map((file) => file.name)).toContain('registry/installation-instance.json')
  })

  it('collects and materializes owner authentication independently', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-auth-sections-'))
    const current = stores()
    current.authentication.bootstrapState.setupRequired = true
    const result = await collectBackupSections({
      store: { dataDir, snapshotStores: async () => current },
      sections: ['authentication'],
    })
    const files = new Map(result.files.map((file) => [file.name, file.body]))
    const replacements = materializeBackupSections({ files, sections: ['authentication'], currentStores: stores() })

    expect(result.files.map((file) => file.name)).toEqual(['sections/authentication.json'])
    expect(replacements.authentication.bootstrapState.setupRequired).toBe(true)
  })

  it('includes immutable catalog indexes while excluding temporary files', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-catalog-sections-'))
    const generation = path.join(dataDir, 'catalog', 'generations', '4-example')
    await fs.mkdir(generation, { recursive: true })
    await fs.writeFile(path.join(generation, 'catalog.sqlite'), 'sqlite-index')
    await fs.writeFile(path.join(generation, 'snapshot.json'), '{}')
    await fs.writeFile(path.join(generation, '.snapshot.tmp'), 'temporary')

    const result = await collectBackupSections({
      store: { dataDir, snapshotStores: async () => stores() },
      sections: ['catalogState'],
    })
    const names = result.files.map((file) => file.name)

    expect(names).toContain('sections/catalog-state.json')
    expect(names).toContain('catalog/generations/4-example/catalog.sqlite')
    expect(names).toContain('catalog/generations/4-example/snapshot.json')
    expect(names).not.toContain('catalog/generations/4-example/.snapshot.tmp')
  })

  it('creates a restorable marker for an empty catalog section', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-empty-catalog-sections-'))
    const result = await collectBackupSections({
      store: { dataDir, snapshotStores: async () => stores() },
      sections: ['catalogState'],
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0].name).toBe('sections/catalog-state.json')
    expect(JSON.parse(result.files[0].body.toString())).toEqual({ files: [] })
  })
})
