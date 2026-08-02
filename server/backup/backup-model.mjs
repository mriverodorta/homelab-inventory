import {
  BACKUP_SECTION_NAMES,
  normalizeBackupSections,
} from '../../shared/backup/contract.mjs'

export const DEFAULT_BACKUP_RETENTION = 7
export const MAX_BACKUP_RETENTION = 365
export const BACKUP_FREQUENCIES = Object.freeze(['daily', 'weekly'])

export function createBackupSchedule() {
  return {
    enabled: false,
    frequency: 'daily',
    time: '02:00',
    weekday: 0,
    timezone: null,
    retention: DEFAULT_BACKUP_RETENTION,
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
    updatedAt: null,
  }
}

export function createBackupManagementStore() {
  return {
    nextBackupId: 1,
    nextRestoreId: 1,
    schedule: createBackupSchedule(),
    backups: [],
    restores: [],
    operation: null,
  }
}

function assertPositiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer.`)
}

function assertNullableIso(value, path) {
  if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) {
    throw new Error(`${path} must be an ISO timestamp or null.`)
  }
}

function assertString(value, path, { nullable = false, maximum = 500 } = {}) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error(`${path} must be a non-empty bounded string.`)
  }
}

export function assertBackupSchedule(schedule, path = 'backupManagement.schedule') {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) throw new Error(`${path} must be an object.`)
  if (typeof schedule.enabled !== 'boolean') throw new Error(`${path}.enabled must be boolean.`)
  if (!BACKUP_FREQUENCIES.includes(schedule.frequency)) throw new Error(`${path}.frequency is unsupported.`)
  if (typeof schedule.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) {
    throw new Error(`${path}.time must use HH:MM.`)
  }
  if (!Number.isSafeInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6) {
    throw new Error(`${path}.weekday must be between 0 and 6.`)
  }
  if (schedule.timezone !== null) {
    assertString(schedule.timezone, `${path}.timezone`, { maximum: 100 })
    try { new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone }).format() } catch { throw new Error(`${path}.timezone is invalid.`) }
  }
  if (!Number.isSafeInteger(schedule.retention) || schedule.retention < 1 || schedule.retention > MAX_BACKUP_RETENTION) {
    throw new Error(`${path}.retention must be between 1 and ${MAX_BACKUP_RETENTION}.`)
  }
  for (const key of ['nextRunAt', 'lastRunAt', 'updatedAt']) assertNullableIso(schedule[key], `${path}.${key}`)
  if (schedule.lastResult !== null && !['success', 'failed'].includes(schedule.lastResult)) {
    throw new Error(`${path}.lastResult is unsupported.`)
  }
}

function assertBackupRecord(record, index) {
  const path = `backupManagement.backups[${index}]`
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${path} must be an object.`)
  assertPositiveInteger(record.id, `${path}.id`)
  assertString(record.label, `${path}.label`, { maximum: 120 })
  assertString(record.fileName, `${path}.fileName`, { maximum: 200 })
  if (record.fileName.includes('/') || record.fileName.includes('\\')) throw new Error(`${path}.fileName is invalid.`)
  if (!['manual', 'scheduled', 'pre-restore'].includes(record.kind)) throw new Error(`${path}.kind is unsupported.`)
  if (!['verified', 'failed'].includes(record.status)) throw new Error(`${path}.status is unsupported.`)
  normalizeBackupSections(record.sections)
  if (typeof record.encrypted !== 'boolean') throw new Error(`${path}.encrypted must be boolean.`)
  if (!Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 0) throw new Error(`${path}.sizeBytes is invalid.`)
  assertString(record.appVersion, `${path}.appVersion`, { maximum: 50 })
  assertPositiveInteger(record.schemaVersion, `${path}.schemaVersion`)
  assertNullableIso(record.createdAt, `${path}.createdAt`)
  assertNullableIso(record.verifiedAt, `${path}.verifiedAt`)
  if (record.error !== null) assertString(record.error, `${path}.error`, { maximum: 500 })
}

function assertRestoreRecord(record, index) {
  const path = `backupManagement.restores[${index}]`
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${path} must be an object.`)
  assertPositiveInteger(record.id, `${path}.id`)
  if (!['success', 'failed', 'rolled-back'].includes(record.status)) throw new Error(`${path}.status is unsupported.`)
  normalizeBackupSections(record.sections)
  assertNullableIso(record.startedAt, `${path}.startedAt`)
  assertNullableIso(record.completedAt, `${path}.completedAt`)
  if (record.preRestoreBackupId !== null) assertPositiveInteger(record.preRestoreBackupId, `${path}.preRestoreBackupId`)
  if (record.error !== null) assertString(record.error, `${path}.error`, { maximum: 500 })
}

export function assertBackupManagementStoreShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Backup management store must be an object.')
  assertPositiveInteger(value.nextBackupId, 'backupManagement.nextBackupId')
  assertPositiveInteger(value.nextRestoreId, 'backupManagement.nextRestoreId')
  assertBackupSchedule(value.schedule)
  if (!Array.isArray(value.backups) || !Array.isArray(value.restores)) throw new Error('Backup management records must be arrays.')
  value.backups.forEach(assertBackupRecord)
  value.restores.forEach(assertRestoreRecord)
  const backupIds = value.backups.map((record) => record.id)
  const restoreIds = value.restores.map((record) => record.id)
  if (new Set(backupIds).size !== backupIds.length || new Set(restoreIds).size !== restoreIds.length) {
    throw new Error('Backup management IDs must be unique.')
  }
  if (backupIds.some((id) => id >= value.nextBackupId) || restoreIds.some((id) => id >= value.nextRestoreId)) {
    throw new Error('Backup management next IDs must exceed existing IDs.')
  }
  if (value.operation !== null) throw new Error('Persisted backup operation must be null.')
}

export function normalizeBackupManagementStore(value) {
  const fallback = createBackupManagementStore()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const normalized = {
    ...fallback,
    ...structuredClone(value),
    schedule: { ...fallback.schedule, ...(value.schedule ?? {}) },
    backups: Array.isArray(value.backups) ? value.backups : [],
    restores: Array.isArray(value.restores) ? value.restores : [],
    operation: null,
  }
  assertBackupManagementStoreShape(normalized)
  return normalized
}

export function publicBackupSections() {
  return BACKUP_SECTION_NAMES
}
