import { describe, expect, it } from 'vitest'
import {
  assertBackupManagementStoreShape,
  assertBackupSchedule,
  createBackupManagementStore,
  createBackupSchedule,
  normalizeBackupManagementStore,
} from './backup-model.mjs'

describe('backup management model', () => {
  it('creates a disabled daily schedule and positive relational counters', () => {
    const store = createBackupManagementStore()
    expect(store).toMatchObject({ nextBackupId: 1, nextRestoreId: 1, backups: [], restores: [], operation: null })
    expect(store.schedule).toMatchObject({ enabled: false, frequency: 'daily', time: '02:00', retention: 7 })
    expect(() => assertBackupManagementStoreShape(store)).not.toThrow()
  })

  it('validates schedule timezone, time, weekday, and retention', () => {
    const schedule = createBackupSchedule()
    expect(() => assertBackupSchedule({ ...schedule, timezone: 'America/New_York', time: '23:45', weekday: 6, retention: 30 })).not.toThrow()
    expect(() => assertBackupSchedule({ ...schedule, time: '25:00' })).toThrow(/HH:MM/)
    expect(() => assertBackupSchedule({ ...schedule, timezone: 'Moon/Base' })).toThrow(/timezone/)
    expect(() => assertBackupSchedule({ ...schedule, retention: 0 })).toThrow(/retention/)
  })

  it('fills optional defaults and rejects non-relational record identifiers', () => {
    expect(normalizeBackupManagementStore({})).toEqual(createBackupManagementStore())
    const store = createBackupManagementStore()
    store.backups.push({
      id: '1', label: 'bad', fileName: 'bad.hlibackup', kind: 'manual', status: 'verified',
      sections: ['inventory'], encrypted: false, sizeBytes: 1, appVersion: '1.0.0', schemaVersion: 19,
      createdAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), error: null,
    })
    store.nextBackupId = 2
    expect(() => assertBackupManagementStoreShape(store)).toThrow(/positive integer/)
  })
})
