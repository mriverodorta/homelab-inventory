import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  BACKUP_ARCHIVE_EXTENSION,
  BACKUP_ARCHIVE_FORMAT_VERSION,
  BACKUP_SECTIONS,
  COMPLETE_BACKUP_SECTIONS,
  assertBackupManifest,
  containsSensitiveSections,
  normalizeBackupSections,
} from '../../shared/backup/contract.mjs'
import { LEGACY_SCHEMA_VERSION as CURRENT_SCHEMA_VERSION } from '../persistence/legacy/schema-version.mjs'
import { createArchiveBuffer, inspectArchiveBuffer } from './archive-envelope.mjs'
import { sha256 } from './archive-security.mjs'
import {
  catalogFilesFromArchive,
  collectBackupSections,
  enrollmentFilesFromArchive,
  replaceSharingConfiguration,
  sharingConfigurationFromArchive,
  sharingIdentityFilesFromArchive,
  telemetryBackupFromArchive,
  notificationBackupFromArchive,
} from './backup-sections.mjs'
import { preflightRestore } from './restore-preflight.mjs'
import { RestoreJournal } from './restore-journal.mjs'

const INSPECTION_TTL_MS = 15 * 60 * 1000
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024
const MINIMUM_PASSPHRASE_LENGTH = 12
const MAXIMUM_PASSPHRASE_LENGTH = 1024

export class BackupServiceError extends Error {
  constructor(message, { code = 'backup-error', status = 400, details } = {}) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

function nowIso() {
  return new Date().toISOString()
}

function safeError(error) {
  if (!(error instanceof Error)) return 'Backup operation failed.'
  return error.message.slice(0, 500)
}

function validatePassphrase(value, { required = false } = {}) {
  if (value === null || value === '') {
    if (!required) return
    throw new BackupServiceError('Backup passphrase is required.', { code: 'backup-passphrase-required' })
  }
  if (
    typeof value !== 'string'
    || value.length < MINIMUM_PASSPHRASE_LENGTH
    || value.length > MAXIMUM_PASSPHRASE_LENGTH
  ) {
    throw new BackupServiceError(
      `Backup passphrase must contain between ${MINIMUM_PASSPHRASE_LENGTH} and ${MAXIMUM_PASSPHRASE_LENGTH} characters.`,
      { code: 'backup-passphrase-invalid' },
    )
  }
}

function authenticationHasSensitiveMaterial(authentication) {
  return authentication.configuration?.enabled === true
    || authentication.accounts?.length > 0
    || authentication.localCredentials?.length > 0
    || authentication.oidcIdentities?.length > 0
    || authentication.sessions?.length > 0
    || authentication.recoveryTokens?.length > 0
    || authentication.oidcTransactions?.length > 0
}

async function writePrivate(filePath, body) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, body, { mode: 0o600 })
  await fs.rename(temporary, filePath)
  await fs.chmod(filePath, 0o600)
}

async function directorySize(directory) {
  let size = 0
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(BACKUP_ARCHIVE_EXTENSION)) continue
    size += (await fs.stat(path.join(directory, entry.name))).size
  }
  return size
}

export class BackupService {
  constructor({
    store,
    appVersion,
    mode = 'production',
    environmentPassphrase = null,
    environmentTimezone = null,
    onRestoreApplied = null,
    telemetryRepository = null,
    notificationStore = null,
    notificationVault = null,
  }) {
    this.store = store
    this.appVersion = appVersion
    this.mode = mode
    this.environmentPassphrase = environmentPassphrase || null
    this.environmentTimezone = environmentTimezone || null
    this.onRestoreApplied = onRestoreApplied
    this.telemetryRepository = telemetryRepository
    this.notificationStore = notificationStore
    this.notificationVault = notificationVault
    this.directory = path.join(store.dataDir, 'backups', 'user')
    this.stagingDirectory = path.join(this.directory, '.staging')
    this.journal = new RestoreJournal(store.dataDir)
    this.operation = null
    this.inspections = new Map()
    this.maintenance = false
  }

  async init() {
    if (
      this.environmentPassphrase
      && (
        this.environmentPassphrase.length < MINIMUM_PASSPHRASE_LENGTH
        || this.environmentPassphrase.length > MAXIMUM_PASSPHRASE_LENGTH
      )
    ) {
      throw new Error(`BACKUP_ENCRYPTION_PASSPHRASE must contain between ${MINIMUM_PASSPHRASE_LENGTH} and ${MAXIMUM_PASSPHRASE_LENGTH} characters.`)
    }
    if (this.environmentTimezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: this.environmentTimezone }).format()
      } catch {
        throw new Error('TZ must be a valid IANA timezone for scheduled backups.')
      }
    }
    await fs.mkdir(this.stagingDirectory, { recursive: true, mode: 0o700 })
    await fs.chmod(this.directory, 0o700)
    await fs.chmod(this.stagingDirectory, 0o700)
    await this.journal.init()
    const pending = await this.journal.read()
    if (pending) await this.recoverPendingRestore(pending)
  }

  isMaintenanceMode() {
    return this.maintenance
  }

  requiresAuthenticationEncryption() {
    return authenticationHasSensitiveMaterial(this.store.getAuthenticationState())
  }

  status() {
    const management = this.store.getBackupManagementState()
    return {
      mode: this.mode,
      sections: BACKUP_SECTIONS,
      schedule: management.schedule,
      backups: [...management.backups].sort((a, b) => b.id - a.id),
      restores: [...management.restores].sort((a, b) => b.id - a.id),
      operation: this.operation,
      maintenance: this.maintenance,
      environment: {
        timezone: this.environmentTimezone,
        timezoneLocked: Boolean(this.environmentTimezone),
        encryptionConfigured: Boolean(this.environmentPassphrase),
      },
    }
  }

  async storageSummary() {
    return { ...this.status(), storageBytes: await directorySize(this.directory) }
  }

  assertAvailable(kind) {
    if (this.operation) throw new BackupServiceError('Another backup operation is already running.', { code: 'backup-locked', status: 409 })
    this.operation = { kind, startedAt: nowIso() }
  }

  finishOperation() {
    this.operation = null
  }

  async create({ sections = COMPLETE_BACKUP_SECTIONS, label = 'Complete backup', kind = 'manual', passphrase = null, persist = true, demo = false } = {}) {
    this.assertAvailable('create')
    try {
      validatePassphrase(passphrase)
      const selected = normalizeBackupSections(sections, { demo })
      if (
        selected.includes('authentication')
        && authenticationHasSensitiveMaterial(this.store.getAuthenticationState())
      ) {
        validatePassphrase(passphrase, { required: true })
      }
      if (selected.includes('notifications') && this.notificationStore?.readSecrets().secrets.length > 0) {
        validatePassphrase(passphrase, { required: true })
      }
      const management = this.store.getBackupManagementState()
      const id = management.nextBackupId
      const createdAt = nowIso()
      const collected = await collectBackupSections({
        store: this.store,
        sections: selected,
        demo,
        telemetryRepository: this.telemetryRepository,
        notificationStore: this.notificationStore,
        includeNotificationSecrets: passphrase !== null,
      })
      const manifest = {
        formatVersion: BACKUP_ARCHIVE_FORMAT_VERSION,
        backupId: randomUUID(),
        createdAt,
        appVersion: this.appVersion,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        databaseSchemas: collected.databaseSchemas,
        mode: demo ? 'demo' : 'production',
        sections: selected,
        files: collected.files.map((entry) => ({ path: entry.name, sizeBytes: entry.body.length, sha256: sha256(entry.body) })),
      }
      assertBackupManifest(manifest)
      const archive = await createArchiveBuffer({ manifest, files: collected.files, passphrase })
      await inspectArchiveBuffer(archive, { passphrase })
      const fileName = `backup-${id}${BACKUP_ARCHIVE_EXTENSION}`
      if (persist) await writePrivate(path.join(this.directory, fileName), archive)
      if (persist) {
        this.store.updateBackupManagement((draft) => {
          draft.nextBackupId += 1
          draft.backups.push({
            id,
            label: String(label || 'Backup').trim().slice(0, 120),
            fileName,
            kind,
            status: 'verified',
            sections: selected,
            encrypted: passphrase !== null,
            sizeBytes: archive.length,
            appVersion: this.appVersion,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            createdAt,
            verifiedAt: nowIso(),
            error: null,
          })
        })
        await this.store.flush(['backupManagement'])
      }
      return { record: persist ? this.store.getBackupManagementState().backups.find((record) => record.id === id) : null, archive, manifest }
    } finally {
      this.finishOperation()
    }
  }

  record(id) {
    const record = this.store.getBackupManagementState().backups.find((entry) => entry.id === id)
    if (!record) throw new BackupServiceError('Backup was not found.', { code: 'backup-not-found', status: 404 })
    return record
  }

  async readRecordArchive(record) {
    return fs.readFile(path.join(this.directory, record.fileName))
  }

  async verify(id, passphrase = null) {
    this.assertAvailable('verify')
    try {
      const record = this.record(id)
      const parsed = await inspectArchiveBuffer(await this.readRecordArchive(record), { passphrase })
      assertBackupManifest(parsed.manifest)
      return { ok: true, manifest: parsed.manifest, encrypted: parsed.encrypted }
    } catch (error) {
      if (error instanceof BackupServiceError) throw error
      throw new BackupServiceError(safeError(error), { code: 'invalid-backup' })
    } finally {
      this.finishOperation()
    }
  }

  async download(id, passphrase = null) {
    this.assertAvailable('download')
    try {
      const record = this.record(id)
      const archive = await this.readRecordArchive(record)
      const sensitive = containsSensitiveSections(record.sections)
      if (record.encrypted) {
        validatePassphrase(passphrase, { required: true })
        try {
          await inspectArchiveBuffer(archive, { passphrase })
        } catch (error) {
          throw new BackupServiceError(safeError(error), { code: 'backup-passphrase-invalid' })
        }
        return { archive, fileName: record.fileName }
      }
      if (!sensitive) return { archive, fileName: record.fileName }
      validatePassphrase(passphrase, { required: true })
      const parsed = await inspectArchiveBuffer(archive)
      return {
        archive: await createArchiveBuffer({
          manifest: parsed.manifest,
          files: [...parsed.files.entries()].filter(([name]) => name !== 'manifest.json').map(([name, body]) => ({ name, body })),
          passphrase,
        }),
        fileName: record.fileName,
      }
    } finally {
      this.finishOperation()
    }
  }

  async remove(id) {
    this.assertAvailable('delete')
    try {
      const record = this.record(id)
      await fs.rm(path.join(this.directory, record.fileName), { force: true })
      this.store.updateBackupManagement((draft) => {
        draft.backups = draft.backups.filter((entry) => entry.id !== id)
      })
      await this.store.flush(['backupManagement'])
      return this.status()
    } finally {
      this.finishOperation()
    }
  }

  async inspect(archive, passphrase = null) {
    if (!Buffer.isBuffer(archive)) throw new BackupServiceError('Backup upload is invalid.', { code: 'invalid-backup', status: 400 })
    if (archive.byteLength > MAX_UPLOAD_BYTES) throw new BackupServiceError('Backup upload is too large.', { code: 'invalid-backup', status: 413 })
    this.assertAvailable('inspect')
    try {
      let parsed
      try { parsed = await inspectArchiveBuffer(archive, { passphrase }) } catch (error) {
        const message = safeError(error)
        const code = message.includes('passphrase') ? 'backup-passphrase-invalid' : 'invalid-backup'
        throw new BackupServiceError(message, { code })
      }
      assertBackupManifest(parsed.manifest)
      const currentStores = await this.store.snapshotStores()
      const preflight = preflightRestore({ manifest: parsed.manifest, files: parsed.files, currentStores })
      const token = randomUUID()
      const expiresAt = Date.now() + INSPECTION_TTL_MS
      for (const [existingToken, inspection] of this.inspections) {
        if (inspection.expiresAt <= Date.now()) this.inspections.delete(existingToken)
      }
      this.inspections.set(token, { parsed, expiresAt, passphrase: passphrase || null })
      return {
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        manifest: parsed.manifest,
        encrypted: parsed.encrypted,
        blockers: preflight.blockers,
        warnings: preflight.warnings,
      }
    } finally {
      this.finishOperation()
    }
  }

  inspection(token) {
    const inspection = this.inspections.get(token)
    if (!inspection || inspection.expiresAt <= Date.now()) {
      if (inspection) this.inspections.delete(token)
      throw new BackupServiceError('Backup inspection expired. Upload the archive again.', { code: 'inspection-expired', status: 410 })
    }
    return inspection
  }

  async preflight(token, sections) {
    const inspection = this.inspection(token)
    const selected = normalizeBackupSections(sections)
    if (selected.some((section) => !inspection.parsed.manifest.sections.includes(section))) {
      throw new BackupServiceError('Selected restore sections are not present in this backup.', { code: 'invalid-section-selection' })
    }
    return preflightRestore({
      manifest: { ...inspection.parsed.manifest, sections: selected },
      files: inspection.parsed.files,
      currentStores: await this.store.snapshotStores(),
    })
  }

  async replaceExternalFiles(parsed, sections) {
    if (sections.includes('agentTelemetry')) {
      if (!this.telemetryRepository) throw new Error('Agent telemetry storage is unavailable for restore.')
      this.telemetryRepository.replaceBackup(telemetryBackupFromArchive(parsed.files), await this.store.snapshotStores())
    }
    if (sections.includes('registryEnrollment')) {
      const directory = path.join(this.store.dataDir, 'registry')
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await fs.chmod(directory, 0o700)
      for (const name of ['installation-instance.json', 'installation-ed25519.pem', 'installation-credentials.json']) await fs.rm(path.join(directory, name), { force: true })
      for (const file of enrollmentFilesFromArchive(parsed.files)) await writePrivate(path.join(directory, file.relativePath), file.body)
    }
    if (sections.includes('sharingConfiguration')) {
      replaceSharingConfiguration(
        this.store.core?.database,
        sharingConfigurationFromArchive(parsed.files),
        { preserveRemoteState: sections.includes('sharingIdentity') },
      )
    }
    if (sections.includes('sharingIdentity')) {
      const directory = path.join(this.store.dataDir, 'sharing')
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await fs.chmod(directory, 0o700)
      for (const name of ['installation-instance.json', 'installation-ed25519.pem', 'installation-credentials.json', 'installation-recovery-ed25519.pem']) {
        await fs.rm(path.join(directory, name), { force: true })
      }
      for (const file of sharingIdentityFilesFromArchive(parsed.files)) await writePrivate(path.join(directory, file.relativePath), file.body)
      this.store.core?.database.query('DELETE FROM sharing_installation_projection WHERE id = 1').run()
    }
    if (sections.includes('catalogState')) {
      const directory = path.join(this.store.dataDir, 'catalog')
      const temporary = `${directory}.restore-${Date.now()}`
      await fs.rm(temporary, { recursive: true, force: true })
      await fs.mkdir(temporary, { recursive: true, mode: 0o700 })
      for (const file of catalogFilesFromArchive(parsed.files)) {
        const destination = path.join(temporary, file.relativePath)
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
        await writePrivate(destination, file.body)
      }
      await fs.rm(directory, { recursive: true, force: true })
      await fs.rename(temporary, directory)
    }
    if (sections.includes('notifications') || sections.includes('notificationHistory')) {
      if (!this.notificationStore) throw new Error('Notification storage is unavailable for restore.')
      const notification = notificationBackupFromArchive(parsed.files, sections)
      if (notification.masterKey) {
        const directory = path.join(this.store.dataDir, 'notifications')
        await fs.mkdir(directory, { recursive: true, mode: 0o700 })
        await writePrivate(path.join(directory, 'master-key'), notification.masterKey)
      }
      await this.notificationStore.replace({
        config: notification.config,
        state: notification.state,
        secrets: notification.secrets,
      })
      if (notification.masterKey) await this.notificationVault?.reload()
    }
  }

  async applyParsed(parsed, sections, { phase = 'restore' } = {}) {
    const result = preflightRestore({
      manifest: { ...parsed.manifest, sections },
      files: parsed.files,
      currentStores: await this.store.snapshotStores(),
    })
    if (!result.ok) throw new BackupServiceError(`Restore dependencies are not satisfied: ${result.blockers.map((blocker) => blocker.message).join(' ')}`, { code: 'restore-blocked', details: result.blockers })
    await this.store.replaceStoresAtomically(result.replacements)
    await this.replaceExternalFiles(parsed, sections)
    await this.onRestoreApplied?.({ sections, phase })
    return result
  }

  async restore(token, sections) {
    this.assertAvailable('restore')
    this.maintenance = true
    const management = this.store.getBackupManagementState()
    const restoreId = management.nextRestoreId
    let preRestore = null
    let selected = null
    try {
      const inspection = this.inspection(token)
      selected = normalizeBackupSections(sections)
      const preflight = await this.preflight(token, selected)
      if (!preflight.ok) throw new BackupServiceError(`Restore dependencies are not satisfied: ${preflight.blockers.map((blocker) => blocker.message).join(' ')}`, { code: 'restore-blocked', details: preflight.blockers })
      this.finishOperation()
      preRestore = await this.create({
        sections: COMPLETE_BACKUP_SECTIONS,
        label: `Before restore ${restoreId}`,
        kind: 'pre-restore',
        persist: true,
        passphrase: this.environmentPassphrase ?? inspection.passphrase,
      })
      this.operation = { kind: 'restore', startedAt: nowIso() }
      await this.journal.write({ restoreId, preRestoreBackupId: preRestore.record.id, fileName: preRestore.record.fileName, createdAt: nowIso() })
      await this.applyParsed(inspection.parsed, selected)
      await this.journal.clear()
      this.inspections.delete(token)
      const completedAt = nowIso()
      this.store.updateBackupManagement((draft) => {
        draft.nextRestoreId = Math.max(draft.nextRestoreId, restoreId + 1)
        draft.restores.push({ id: restoreId, status: 'success', sections: selected, startedAt: this.operation.startedAt, completedAt, preRestoreBackupId: preRestore.record.id, error: null })
      })
      await this.store.flush(['backupManagement'])
      return { ok: true, restoreId, reloadRequired: true }
    } catch (error) {
      let status = 'failed'
      if (preRestore) {
        try {
          const rollback = await inspectArchiveBuffer(await this.readRecordArchive(preRestore.record))
          await this.applyParsed(rollback, COMPLETE_BACKUP_SECTIONS, { phase: 'rollback' })
          await this.journal.clear()
          status = 'rolled-back'
        } catch (rollbackError) {
          console.error('[backup] Automatic restore rollback failed.', safeError(rollbackError))
        }
      }
      const startedAt = this.operation?.startedAt ?? nowIso()
      if (selected) {
        this.store.updateBackupManagement((draft) => {
          draft.nextRestoreId = Math.max(draft.nextRestoreId, restoreId + 1)
          draft.restores.push({ id: restoreId, status, sections: selected, startedAt, completedAt: nowIso(), preRestoreBackupId: preRestore?.record.id ?? null, error: safeError(error) })
        })
        await this.store.flush(['backupManagement']).catch(() => {})
      }
      throw error
    } finally {
      this.maintenance = false
      this.finishOperation()
    }
  }

  async recoverPendingRestore(pending) {
    this.maintenance = true
    try {
      const record = this.record(pending.preRestoreBackupId)
      const parsed = await inspectArchiveBuffer(await this.readRecordArchive(record))
      await this.applyParsed(parsed, COMPLETE_BACKUP_SECTIONS, { phase: 'recovery' })
      await this.journal.clear()
      const completedAt = nowIso()
      this.store.updateBackupManagement((draft) => {
        draft.nextRestoreId = Math.max(draft.nextRestoreId, pending.restoreId + 1)
        if (!draft.restores.some((restore) => restore.id === pending.restoreId)) {
          draft.restores.push({
            id: pending.restoreId,
            status: 'rolled-back',
            sections: COMPLETE_BACKUP_SECTIONS,
            startedAt: pending.createdAt,
            completedAt,
            preRestoreBackupId: pending.preRestoreBackupId,
            error: 'Interrupted restore was rolled back during startup.',
          })
        }
      })
      await this.store.flush(['backupManagement'])
    } finally {
      this.maintenance = false
    }
  }

  async pruneScheduled(retention) {
    const scheduled = this.store.getBackupManagementState().backups
      .filter((record) => record.kind === 'scheduled' && record.status === 'verified')
      .sort((a, b) => b.id - a.id)
    for (const record of scheduled.slice(retention)) await this.remove(record.id)
  }
}
