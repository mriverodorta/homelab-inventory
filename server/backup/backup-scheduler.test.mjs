import { describe, expect, it } from 'vitest'
import { createBackupSchedule } from './backup-model.mjs'
import { BackupScheduler, nextBackupRun } from './backup-scheduler.mjs'

describe('backup scheduler', () => {
  it('finds the next local daily wall-clock time', () => {
    const schedule = { ...createBackupSchedule(), enabled: true, time: '02:00', timezone: 'America/New_York' }
    expect(nextBackupRun(schedule, new Date('2026-08-02T05:00:00Z')).toISOString()).toBe('2026-08-02T06:00:00.000Z')
  })

  it('respects weekly weekdays', () => {
    const schedule = { ...createBackupSchedule(), enabled: true, frequency: 'weekly', weekday: 1, time: '08:30', timezone: 'UTC' }
    expect(nextBackupRun(schedule, new Date('2026-08-02T12:00:00Z')).toISOString()).toBe('2026-08-03T08:30:00.000Z')
  })

  it('persists only allowlisted schedule fields', async () => {
    let schedule = createBackupSchedule()
    const store = {
      getBackupManagementState: () => ({ schedule }),
      updateBackupManagement: (mutator) => {
        const draft = { schedule: structuredClone(schedule) }
        mutator(draft)
        schedule = draft.schedule
      },
      flush: async () => {},
    }
    const service = { status: () => ({ schedule }) }
    const scheduler = new BackupScheduler({ store, service })

    await scheduler.update({ time: '03:30', operation: 'injected', lastRunAt: 'not-allowed' })

    expect(schedule.time).toBe('03:30')
    expect(schedule).not.toHaveProperty('operation')
    expect(schedule.lastRunAt).toBeNull()
  })

  it('blocks scheduled backups with authentication data until environment encryption is configured', async () => {
    const schedule = createBackupSchedule()
    const store = {
      getBackupManagementState: () => ({ schedule }),
      updateBackupManagement: () => { throw new Error('unsafe schedule should not be persisted') },
    }
    const service = {
      environmentPassphrase: null,
      requiresAuthenticationEncryption: () => true,
    }
    const scheduler = new BackupScheduler({ store, service })

    await expect(scheduler.update({ enabled: true })).rejects.toThrow(/BACKUP_ENCRYPTION_PASSPHRASE/)
  })

  it('allows encrypted scheduled backups with authentication data', async () => {
    let schedule = createBackupSchedule()
    const store = {
      getBackupManagementState: () => ({ schedule }),
      updateBackupManagement: (mutator) => {
        const draft = { schedule: structuredClone(schedule) }
        mutator(draft)
        schedule = draft.schedule
      },
      flush: async () => {},
    }
    const service = {
      environmentPassphrase: 'a sufficiently long backup passphrase',
      requiresAuthenticationEncryption: () => true,
      status: () => ({ schedule }),
    }
    const scheduler = new BackupScheduler({ store, service })

    await scheduler.update({ enabled: true })

    expect(schedule.enabled).toBe(true)
  })
})
