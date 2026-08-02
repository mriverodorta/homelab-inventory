import { describe, expect, it } from 'vitest'
import { createBackupManagementStore } from './backup-model.mjs'
import { preflightRestore } from './restore-preflight.mjs'
import { createRegistryStore } from '../registry/model.mjs'
import { createAuthenticationStore } from '../auth/model.mjs'

describe('restore preflight', () => {
  it('rejects archives created by a newer schema', () => {
    const result = preflightRestore({ manifest: { schemaVersion: 999, sections: ['inventory'] }, files: new Map(), currentStores: {} })
    expect(result).toMatchObject({ ok: false, blockers: [{ code: 'newer-schema' }] })
  })

  it('accepts an independent enrollment replacement', () => {
    const currentStores = {
      inventory: { servers: [], pcBuilds: [], cpus: [], ram: [], storage: [], networkCards: [], gpus: [], motherboards: [], cpuCoolers: [], cases: [], powerSupplies: [], soundCards: [], wirelessCards: [], powerAdapters: [], nas: [], switches: [], patchPanels: [], monitors: [], upsSystems: [], powerStrips: [] },
      project: { id: 'default', revision: 1, metadata: { name: 'Lab', version: 1, updatedAt: new Date().toISOString() }, placements: [], assignments: [], connections: [], compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] } },
      agents: { enrollments: {}, devices: {} }, agentStatus: { servers: {} }, registry: createRegistryStore(),
      backupManagement: createBackupManagementStore(), routingCache: {}, meta: { schemaVersion: 20 },
      authentication: createAuthenticationStore(),
    }
    const files = new Map([['sections/registry-enrollment.json', Buffer.from('{"installationIdentity":null}')]])
    expect(preflightRestore({ manifest: { schemaVersion: 20, sections: ['registryEnrollment'] }, files, currentStores }).ok).toBe(true)
  })

  it('keeps the running schema when restoring older application metadata', () => {
    const currentStores = {
      inventory: { servers: [], pcBuilds: [], cpus: [], ram: [], storage: [], networkCards: [], gpus: [], motherboards: [], cpuCoolers: [], cases: [], powerSupplies: [], soundCards: [], wirelessCards: [], powerAdapters: [], nas: [], switches: [], patchPanels: [], monitors: [], upsSystems: [], powerStrips: [] },
      project: { id: 'default', revision: 1, metadata: { name: 'Lab', version: 1, updatedAt: new Date().toISOString() }, placements: [], assignments: [], connections: [], compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] } },
      agents: { enrollments: {}, devices: {} }, agentStatus: { servers: {} }, registry: createRegistryStore(),
      backupManagement: createBackupManagementStore(), routingCache: {}, meta: { schemaVersion: 20 },
      authentication: createAuthenticationStore(),
    }
    const files = new Map([['sections/application-metadata.json', Buffer.from(JSON.stringify({
      meta: { schemaVersion: 19 },
      schedule: createBackupManagementStore().schedule,
    }))]])
    const result = preflightRestore({
      manifest: { schemaVersion: 19, sections: ['applicationMetadata'] },
      files,
      currentStores,
    })

    expect(result.ok).toBe(true)
    expect(result.replacements.meta.schemaVersion).toBe(22)
  })
})
