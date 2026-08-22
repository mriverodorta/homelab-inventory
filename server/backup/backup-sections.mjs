import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { normalizeBackupSections } from '../../shared/backup/contract.mjs'
import { createRegistryStore, normalizeRegistryStore } from '../registry/model.mjs'
import { parseInstallationInstance } from '../registry/installation-instance.mjs'
import { normalizeInstallationCredentials } from '../registry/installation-identity.mjs'
import { parseSharingInstance } from '../sharing/installation-instance.mjs'
import { normalizeSharingCredentials } from '../sharing/installation-identity.mjs'
import { sharingIdentityHash } from '../sharing/installation-auth.mjs'
import { AGENT_TELEMETRY_BACKUP_FILE, emptyTelemetryBackup } from '../telemetry/backup.mjs'
import {
  assertNotificationConfig,
  assertNotificationSecrets,
  assertNotificationState,
  createNotificationSecrets,
  normalizeNotificationConfig,
  normalizeNotificationSecrets,
  normalizeNotificationState,
} from '../notifications/model.mjs'

const JSON_SECTION_FILES = Object.freeze({
  inventory: 'sections/inventory.json',
  project: 'sections/project.json',
  routingCache: 'sections/routing-cache.json',
  registryConfiguration: 'sections/registry-configuration.json',
  registryEnrollment: 'sections/registry-enrollment.json',
  sharingConfiguration: 'sections/sharing-configuration.json',
  sharingIdentity: 'sections/sharing-identity.json',
  authentication: 'sections/authentication.json',
  catalogState: 'sections/catalog-state.json',
  agents: 'sections/agents.json',
  agentTelemetry: 'sections/agent-telemetry.json',
  notifications: 'sections/notifications.json',
  notificationHistory: 'sections/notification-history.json',
  applicationMetadata: 'sections/application-metadata.json',
})
const NOTIFICATION_FILE_NAMES = new Set(['master-key', 'notification-secrets.json'])
const ENROLLMENT_FILE_NAMES = new Set([
  'installation-instance.json',
  'installation-ed25519.pem',
  'installation-credentials.json',
])
const SHARING_IDENTITY_FILE_NAMES = new Set([
  'installation-instance.json',
  'installation-ed25519.pem',
  'installation-credentials.json',
  'installation-recovery-ed25519.pem',
])
const SHARING_CONFIGURATION_TABLES = Object.freeze([
  'shares',
  'share_views',
  'share_field_selections',
  'share_tag_selections',
  'share_resource_snapshots',
  'share_local_blobs',
  'share_local_revisions',
  'share_local_revision_blobs',
  'share_publication_operations',
])

async function pathExists(filePath) {
  try { await fs.access(filePath); return true } catch { return false }
}

async function readProtectedFile(filePath) {
  const metadata = await fs.stat(filePath)
  if ((metadata.mode & 0o777) !== 0o600) throw new Error(`Private sharing identity file ${path.basename(filePath)} must use mode 0600.`)
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`Private sharing identity file ${path.basename(filePath)} has unexpected ownership.`)
  return fs.readFile(filePath)
}

function jsonEntry(name, value) {
  return { name, body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`) }
}

async function collectFiles(directory, prefix, { exclude = () => false } = {}) {
  if (!await pathExists(directory)) return []
  const entries = []
  for (const dirent of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (exclude(dirent.name)) continue
    const absolute = path.join(directory, dirent.name)
    const relative = `${prefix}/${dirent.name}`
    if (dirent.isDirectory()) entries.push(...await collectFiles(absolute, relative, { exclude }))
    else if (dirent.isFile()) entries.push({ name: relative, body: await fs.readFile(absolute) })
  }
  return entries
}

function registryConfiguration(registry) {
  return { ...structuredClone(registry), installationIdentity: null }
}

export async function collectBackupSections({
  store,
  sections,
  demo = false,
  telemetryRepository = null,
  notificationStore = null,
  includeNotificationSecrets = false,
}) {
  const selected = normalizeBackupSections(sections, { demo })
  const snapshot = await store.snapshotStores()
  const telemetrySchema = telemetryRepository?.exportBackup?.().schemaVersion ?? null
  const databaseSchemas = {
    core: snapshot.meta?.databaseSchemas?.core ?? null,
    telemetry: snapshot.meta?.databaseSchemas?.telemetry ?? telemetrySchema,
    catalog: snapshot.meta?.databaseSchemas?.catalog ?? null,
  }
  const files = []
  for (const section of selected) {
    if (section === 'inventory') files.push(jsonEntry(JSON_SECTION_FILES.inventory, snapshot.inventory))
    if (section === 'project') files.push(jsonEntry(JSON_SECTION_FILES.project, snapshot.project))
    if (section === 'routingCache') files.push(jsonEntry(JSON_SECTION_FILES.routingCache, snapshot.routingCache))
    if (section === 'registryConfiguration') files.push(jsonEntry(JSON_SECTION_FILES.registryConfiguration, registryConfiguration(snapshot.registry)))
    if (section === 'agents') files.push(jsonEntry(JSON_SECTION_FILES.agents, snapshot.agents))
    if (section === 'agentTelemetry') {
      if (!telemetryRepository) throw new Error('Agent telemetry storage is unavailable for backup.')
      files.push(
        jsonEntry(JSON_SECTION_FILES.agentTelemetry, snapshot.agentStatus),
        jsonEntry(AGENT_TELEMETRY_BACKUP_FILE, telemetryRepository.exportBackup()),
      )
    }
    if (section === 'notifications') {
      if (!notificationStore) throw new Error('Notification storage is unavailable for backup.')
      const notificationConfig = notificationStore.readConfig()
      const notificationSecrets = notificationStore.readSecrets()
      const archivedConfig = includeNotificationSecrets
        ? notificationConfig
        : {
            ...notificationConfig,
            enabled: false,
            contactPoints: notificationConfig.contactPoints.map((point) => ({ ...point, enabled: false, secretId: null })),
          }
      files.push(jsonEntry(JSON_SECTION_FILES.notifications, archivedConfig))
      if (includeNotificationSecrets) {
        files.push(jsonEntry('notifications/notification-secrets.json', notificationSecrets))
        const keyPath = path.join(store.dataDir, 'notifications', 'master-key')
        if (await pathExists(keyPath)) files.push({ name: 'notifications/master-key', body: await fs.readFile(keyPath) })
      } else {
        files.push(jsonEntry('notifications/notification-secrets.json', createNotificationSecrets()))
      }
    }
    if (section === 'notificationHistory') {
      if (!notificationStore) throw new Error('Notification storage is unavailable for backup.')
      files.push(jsonEntry(JSON_SECTION_FILES.notificationHistory, notificationStore.readState()))
    }
    if (section === 'authentication') files.push(jsonEntry(JSON_SECTION_FILES.authentication, snapshot.authentication))
    if (section === 'applicationMetadata') {
      files.push(jsonEntry(JSON_SECTION_FILES.applicationMetadata, {
        meta: snapshot.meta,
        schedule: snapshot.backupManagement.schedule,
      }))
    }
    if (section === 'registryEnrollment') {
      const enrollmentFiles = []
      const registryDir = path.join(store.dataDir, 'registry')
      for (const name of ENROLLMENT_FILE_NAMES) {
        const absolute = path.join(registryDir, name)
        if (await pathExists(absolute)) enrollmentFiles.push({ name: `registry/${name}`, body: await fs.readFile(absolute) })
      }
      files.push(jsonEntry(JSON_SECTION_FILES.registryEnrollment, {
        installationIdentity: snapshot.registry.installationIdentity,
        files: enrollmentFiles.map((entry) => entry.name),
      }), ...enrollmentFiles)
    }
    if (section === 'sharingConfiguration') {
      files.push(jsonEntry(JSON_SECTION_FILES.sharingConfiguration, sharingConfigurationBackup(store.core?.database)))
    }
    if (section === 'sharingIdentity') {
      const identityFiles = []
      const sharingDir = path.join(store.dataDir, 'sharing')
      for (const name of SHARING_IDENTITY_FILE_NAMES) {
        const absolute = path.join(sharingDir, name)
        if (await pathExists(absolute)) identityFiles.push({ name: `sharing/${name}`, body: await readProtectedFile(absolute) })
      }
      files.push(jsonEntry(JSON_SECTION_FILES.sharingIdentity, {
        projection: store.core?.database?.query('SELECT * FROM sharing_installation_projection WHERE id = 1').get() ?? null,
        files: identityFiles.map((entry) => entry.name),
      }), ...identityFiles)
    }
    if (section === 'catalogState') {
      const catalogDir = path.join(store.dataDir, 'catalog')
      const catalogFiles = await collectFiles(catalogDir, 'catalog', {
        exclude: (name) => name.endsWith('.tmp'),
      })
      files.push(jsonEntry(JSON_SECTION_FILES.catalogState, {
        files: catalogFiles.map((entry) => entry.name),
      }), ...catalogFiles)
    }
  }
  return { sections: selected, files, databaseSchemas }
}

function parseJson(files, name) {
  const value = files.get(name)
  if (!value) throw new Error(`Backup section file ${name} is missing.`)
  try { return JSON.parse(value.toString('utf8')) } catch { throw new Error(`Backup section file ${name} is invalid.`) }
}

export function materializeBackupSections({ files, sections, currentStores }) {
  const selected = normalizeBackupSections(sections)
  const replacements = {}
  if (selected.includes('inventory')) replacements.inventory = parseJson(files, JSON_SECTION_FILES.inventory)
  if (selected.includes('project')) replacements.project = parseJson(files, JSON_SECTION_FILES.project)
  if (selected.includes('routingCache')) replacements.routingCache = parseJson(files, JSON_SECTION_FILES.routingCache)
  if (selected.includes('agents')) replacements.agents = parseJson(files, JSON_SECTION_FILES.agents)
  if (selected.includes('agentTelemetry')) replacements.agentStatus = parseJson(files, JSON_SECTION_FILES.agentTelemetry)
  if (selected.includes('authentication')) replacements.authentication = parseJson(files, JSON_SECTION_FILES.authentication)

  let registry = structuredClone(currentStores.registry)
  if (selected.includes('registryConfiguration')) {
    const configuration = parseJson(files, JSON_SECTION_FILES.registryConfiguration)
    registry = { ...configuration, installationIdentity: registry.installationIdentity }
  }
  if (selected.includes('registryEnrollment')) {
    const enrollment = parseJson(files, JSON_SECTION_FILES.registryEnrollment)
    registry.installationIdentity = enrollment.installationIdentity ?? null
  }
  if (selected.includes('registryConfiguration') || selected.includes('registryEnrollment')) {
    replacements.registry = normalizeRegistryStore({ ...createRegistryStore(), ...registry })
  }
  if (selected.includes('applicationMetadata')) {
    const metadata = parseJson(files, JSON_SECTION_FILES.applicationMetadata)
    replacements.meta = metadata.meta
    replacements.backupManagement = {
      ...structuredClone(currentStores.backupManagement),
      schedule: metadata.schedule,
      operation: null,
    }
  }
  return replacements
}

export function catalogFilesFromArchive(files) {
  return [...files.entries()]
    .filter(([name]) => name.startsWith('catalog/'))
    .map(([name, body]) => ({ relativePath: name.slice('catalog/'.length), body }))
}

export function enrollmentFilesFromArchive(files) {
  return [...files.entries()]
    .filter(([name]) => name.startsWith('registry/') && ENROLLMENT_FILE_NAMES.has(name.slice('registry/'.length)))
    .map(([name, body]) => ({ relativePath: name.slice('registry/'.length), body }))
}

export function sharingIdentityFilesFromArchive(files) {
  return [...files.entries()]
    .filter(([name]) => name.startsWith('sharing/') && SHARING_IDENTITY_FILE_NAMES.has(name.slice('sharing/'.length)))
    .map(([name, body]) => ({ relativePath: name.slice('sharing/'.length), body }))
}

export function sharingConfigurationFromArchive(files) {
  const value = parseJson(files, JSON_SECTION_FILES.sharingConfiguration)
  if (value?.version !== 1 || typeof value.connectionEnabled !== 'boolean' || !value.tables || typeof value.tables !== 'object') {
    throw new Error('Sharing configuration backup is invalid.')
  }
  for (const table of SHARING_CONFIGURATION_TABLES) {
    if (!Array.isArray(value.tables[table])) throw new Error(`Sharing configuration table ${table} is invalid.`)
  }
  return value
}

export function replaceSharingConfiguration(database, backup, { preserveRemoteState = false } = {}) {
  const value = typeof backup?.version === 'number' ? backup : sharingConfigurationFromArchive(backup)
  if (!database) {
    const containsSharingState = SHARING_CONFIGURATION_TABLES.some((table) => value.tables[table].length > 0)
    if (!containsSharingState) return
    throw new Error('Sharing configuration storage is unavailable for restore.')
  }
  database.transaction(() => {
    for (const table of [...SHARING_CONFIGURATION_TABLES].reverse()) database.query(`DELETE FROM ${table}`).run()
    for (const table of SHARING_CONFIGURATION_TABLES) {
      const allowed = new Set(database.query(`PRAGMA table_info(${table})`).all().map(({ name }) => name))
      for (const source of value.tables[table]) {
        const row = { ...source }
        if (table === 'shares' && !preserveRemoteState) {
          row.remote_public_id = null
          row.remote_revision = null
          row.active_manifest_hash = null
          row.approved_preview_hash = null
          row.account_claimed = 0
          row.state = 'unpublished'
        }
        if (table === 'share_publication_operations' && !preserveRemoteState) continue
        const columns = Object.keys(row)
        if (!columns.length || columns.some((column) => !allowed.has(column))) throw new Error(`Sharing configuration table ${table} contains unsupported columns.`)
        database.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map((column) => row[column]))
      }
    }
    database.query(`
      UPDATE sharing_settings SET connection_enabled = ?, enrollment_state = ?,
        attempt_count = 0, next_attempt_at_ms = NULL, last_error_code = NULL,
        recovery_state = NULL, revision = revision + 1,
        updated_at_ms = CAST(unixepoch('subsec') * 1000 AS integer)
      WHERE id = 1
    `).run(value.connectionEnabled ? 1 : 0, value.connectionEnabled ? 'pending' : 'disabled')
  }).immediate()
}

export function telemetryBackupFromArchive(files) {
  return files.has(AGENT_TELEMETRY_BACKUP_FILE)
    ? parseJson(files, AGENT_TELEMETRY_BACKUP_FILE)
    : emptyTelemetryBackup()
}

export function notificationBackupFromArchive(files, sections) {
  const result = {}
  if (sections.includes('notifications')) {
    result.config = normalizeNotificationConfig(parseJson(files, JSON_SECTION_FILES.notifications))
    result.secrets = files.has('notifications/notification-secrets.json')
      ? normalizeNotificationSecrets(parseJson(files, 'notifications/notification-secrets.json'))
      : createNotificationSecrets()
    assertNotificationConfig(result.config)
    assertNotificationSecrets(result.secrets)
    const unexpected = [...files.keys()].filter((name) => name.startsWith('notifications/') && !NOTIFICATION_FILE_NAMES.has(name.slice('notifications/'.length)))
    if (unexpected.length > 0) throw new Error('Notification backup contains unsupported files.')
    result.masterKey = files.get('notifications/master-key') ?? null
    if (result.masterKey && result.masterKey.length !== 32) throw new Error('Notification backup master key is invalid.')
    if (result.secrets.secrets.length > 0 && !result.masterKey) throw new Error('Notification credentials require the notification master key.')
  }
  if (sections.includes('notificationHistory')) {
    result.state = normalizeNotificationState(parseJson(files, JSON_SECTION_FILES.notificationHistory))
    assertNotificationState(result.state)
  }
  return result
}

export function validateEnrollmentFiles(files) {
  const marker = parseJson(files, JSON_SECTION_FILES.registryEnrollment)
  const unexpected = [...files.keys()].filter((name) => name.startsWith('registry/') && !ENROLLMENT_FILE_NAMES.has(name.slice('registry/'.length)))
  if (unexpected.length > 0) throw new Error('Registry enrollment backup contains unsupported files.')
  const archived = new Map(enrollmentFilesFromArchive(files).map((file) => [file.relativePath, file.body]))
  if (!Array.isArray(marker.files) || marker.files.some((name) => typeof name !== 'string')) {
    throw new Error('Registry enrollment backup file list is invalid.')
  }
  const expected = [...new Set(marker.files)].sort()
  const actual = [...archived.keys()].map((name) => `registry/${name}`).sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Registry enrollment backup files do not match the manifest.')
  }
  const instanceBody = archived.get('installation-instance.json')
  const instance = instanceBody ? parseInstallationInstance(instanceBody) : null
  const keyBody = archived.get('installation-ed25519.pem')
  const credentialsBody = archived.get('installation-credentials.json')
  if (credentialsBody && !keyBody) throw new Error('Registry enrollment credentials require an installation signing key.')
  let publicKeyId = null
  if (keyBody) {
    try {
      const privateKey = createPrivateKey(keyBody)
      if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('unsupported key')
      const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
      publicKeyId = createHash('sha256').update(`hli-contribution-v1:installation-key:${publicKey}`).digest('hex')
    } catch {
      throw new Error('Registry enrollment signing key is invalid.')
    }
  }
  if (credentialsBody) {
    let parsed
    try { parsed = JSON.parse(credentialsBody.toString('utf8')) } catch { throw new Error('Registry enrollment credentials are invalid JSON.') }
    const credentials = normalizeInstallationCredentials(parsed, {
      clientInstanceId: instance?.clientInstanceId ?? null,
      allowLegacy: !instance,
    })
    if (!credentials) throw new Error('Registry enrollment credentials are invalid.')
    if (publicKeyId !== credentials.publicKeyId) throw new Error('Registry enrollment credentials do not match the signing key.')
  }
  if (marker.installationIdentity?.clientInstanceId && instance && marker.installationIdentity.clientInstanceId !== instance.clientInstanceId) {
    throw new Error('Registry enrollment projection does not match the installation instance.')
  }
  return { instance, publicKeyId }
}

export function validateSharingIdentityFiles(files) {
  const marker = parseJson(files, JSON_SECTION_FILES.sharingIdentity)
  const unexpected = [...files.keys()].filter((name) => name.startsWith('sharing/') && !SHARING_IDENTITY_FILE_NAMES.has(name.slice('sharing/'.length)))
  if (unexpected.length) throw new Error('Sharing identity backup contains unsupported files.')
  const archived = new Map(sharingIdentityFilesFromArchive(files).map((file) => [file.relativePath, file.body]))
  const expected = Array.isArray(marker.files) ? [...new Set(marker.files)].sort() : null
  const actual = [...archived.keys()].map((name) => `sharing/${name}`).sort()
  if (!expected || JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Sharing identity backup files do not match the manifest.')
  const instanceBody = archived.get('installation-instance.json')
  const keyBody = archived.get('installation-ed25519.pem')
  const credentialsBody = archived.get('installation-credentials.json')
  if (!instanceBody && (keyBody || credentialsBody)) throw new Error('Sharing identity key and credentials require an installation instance.')
  if (credentialsBody && !keyBody) throw new Error('Sharing identity credentials require an installation signing key.')
  const instance = instanceBody ? parseSharingInstance(instanceBody) : null
  let identityHash = null
  if (keyBody) {
    try {
      const privateKey = createPrivateKey(keyBody)
      if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('unsupported key')
      const publicKeySpki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
      identityHash = sharingIdentityHash(instance.clientInstanceId, publicKeySpki)
    } catch { throw new Error('Sharing installation signing key is invalid.') }
  }
  if (credentialsBody) {
    let parsed
    try { parsed = JSON.parse(credentialsBody.toString('utf8')) } catch { throw new Error('Sharing installation credentials are invalid JSON.') }
    if (!normalizeSharingCredentials(parsed, instance.clientInstanceId)) throw new Error('Sharing installation credentials are invalid.')
  }
  if (marker.projection?.identity_hash && identityHash !== marker.projection.identity_hash) throw new Error('Sharing identity projection does not match the signing key.')
  return { instance, identityHash }
}

function sharingConfigurationBackup(database) {
  if (!database) return { version: 1, connectionEnabled: true, tables: Object.fromEntries(SHARING_CONFIGURATION_TABLES.map((table) => [table, []])) }
  const settings = database.query('SELECT connection_enabled AS connectionEnabled FROM sharing_settings WHERE id = 1').get()
  return {
    version: 1,
    connectionEnabled: Boolean(settings?.connectionEnabled),
    tables: Object.fromEntries(SHARING_CONFIGURATION_TABLES.map((table) => [table, database.query(`SELECT * FROM ${table} ORDER BY 1`).all()])),
  }
}

export { JSON_SECTION_FILES }
