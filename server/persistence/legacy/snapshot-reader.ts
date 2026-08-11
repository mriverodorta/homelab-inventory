import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthenticationStore, normalizeAuthenticationStore } from '../../auth/model.mjs'
import { createBackupManagementStore, normalizeBackupManagementStore } from '../../backup/backup-model.mjs'
import { createNotificationConfig, createNotificationSecrets, createNotificationState, normalizeNotificationConfig, normalizeNotificationSecrets, normalizeNotificationState } from '../../notifications/model.mjs'
import { createRegistryStore, normalizeRegistryStore } from '../../registry/model.mjs'
import { createRoutingCache, normalizeRoutingCache } from '../../routing-cache-model.mjs'
import { HomelabInventoryStore } from '../../db/store.mjs'
import { buildCanonicalIdentityPlan } from './identity-plan.ts'

export const LEGACY_SCHEMA_VERSION = 29

const OPTIONAL_FILES = {
  agents: ['agents.json', { enrollments: {}, devices: {}, hardwareSnapshots: {}, hardwareEvents: {} }],
  agentStatus: ['agent-status.json', { hosts: {} }],
  registry: ['registry.json', createRegistryStore()],
  routingCache: ['routing-cache.json', createRoutingCache()],
  backupManagement: ['backup-management.json', createBackupManagementStore()],
  authentication: ['authentication.json', createAuthenticationStore()],
  notifications: ['notifications.json', createNotificationConfig()],
  notificationState: ['notification-state.json', createNotificationState()],
  notificationSecrets: ['notification-secrets.json', createNotificationSecrets()],
} as const

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function optionalJson(path: string, fallback: unknown): Promise<any> {
  try {
    return await readJson(path)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return structuredClone(fallback)
    throw error
  }
}

export async function readLatestLegacySnapshot(dataDir: string) {
  const storesDir = join(dataDir, 'stores')
  const [meta, inventory, project] = await Promise.all([
    readJson(join(dataDir, 'meta.json')),
    readJson(join(storesDir, 'inventory.json')),
    readJson(join(storesDir, 'project.json')),
  ])
  const version = meta?.schemaVersion ?? 0
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Legacy schema version is invalid.')
  if (version > LEGACY_SCHEMA_VERSION) throw new Error(`Legacy data is newer than schema ${LEGACY_SCHEMA_VERSION}.`)
  if (version < LEGACY_SCHEMA_VERSION) {
    return readUpgradedLegacySnapshot(dataDir)
  }

  const optional = Object.fromEntries(await Promise.all(Object.entries(OPTIONAL_FILES).map(async ([key, [file, fallback]]) => [
    key,
    await optionalJson(join(storesDir, file), fallback),
  ])))
  const snapshot = {
    meta: structuredClone(meta),
    inventory: structuredClone(inventory),
    project: structuredClone(project),
    agents: structuredClone(optional.agents),
    agentStatus: structuredClone(optional.agentStatus),
    registry: normalizeRegistryStore(optional.registry),
    routingCache: normalizeRoutingCache(optional.routingCache),
    backupManagement: normalizeBackupManagementStore(optional.backupManagement),
    authentication: normalizeAuthenticationStore(optional.authentication),
    notifications: normalizeNotificationConfig(optional.notifications),
    notificationState: normalizeNotificationState(optional.notificationState),
    notificationSecrets: normalizeNotificationSecrets(optional.notificationSecrets),
  }
  buildCanonicalIdentityPlan(snapshot)
  return snapshot
}

async function readUpgradedLegacySnapshot(dataDir: string) {
  const stagingParent = await mkdtemp(join(tmpdir(), 'homelab-inventory-legacy-upgrade-'))
  const stagingDataDir = join(stagingParent, 'data')
  try {
    await cp(dataDir, stagingDataDir, { recursive: true, force: false, errorOnExist: true })
    const store = new HomelabInventoryStore({
      appVersion: 'sqlite-import',
      dataDir: stagingDataDir,
      legacyProjectPath: null,
      seedEmptyData: false,
      seedDir: stagingParent,
    })
    await store.init()
    await store.flush()
    return await readLatestLegacySnapshot(stagingDataDir)
  } finally {
    await rm(stagingParent, { recursive: true, force: true })
  }
}
