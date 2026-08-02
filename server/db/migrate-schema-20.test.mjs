import { describe, expect, it } from 'vitest'
import { createBackupManagementStore } from '../backup/backup-model.mjs'
import { migrateSchema19To20 } from './migrate-schema-20.mjs'

describe('schema 20 backup-management migration', () => {
  it('initializes a new backup-management store', () => {
    const result = migrateSchema19To20(null)

    expect(result.backupManagement).toEqual(createBackupManagementStore())
    expect(result.summary).toEqual({ initializedBackupManagement: true })
  })

  it('preserves an existing store for idempotent startup recovery', () => {
    const current = createBackupManagementStore()
    current.schedule.retention = 30

    const result = migrateSchema19To20(current)

    expect(result.backupManagement).toBe(current)
    expect(result.summary).toEqual({ initializedBackupManagement: false })
  })
})
