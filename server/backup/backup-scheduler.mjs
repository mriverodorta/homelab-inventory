import { COMPLETE_BACKUP_SECTIONS } from '../../shared/backup/contract.mjs'
import { assertBackupSchedule } from './backup-model.mjs'

const WEEKDAY_INDEX = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })
const MAX_TIMER_MS = 2_147_000_000
const SCHEDULE_INPUT_KEYS = Object.freeze(['enabled', 'frequency', 'time', 'weekday', 'timezone', 'retention'])

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { weekday: WEEKDAY_INDEX[values.weekday], time: `${values.hour}:${values.minute}` }
}

export function nextBackupRun(schedule, from = new Date()) {
  if (!schedule.enabled) return null
  assertBackupSchedule(schedule)
  const timezone = schedule.timezone ?? 'UTC'
  const cursor = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000)
  const limit = schedule.frequency === 'weekly' ? 8 * 24 * 60 : 2 * 24 * 60
  for (let offset = 0; offset < limit; offset += 1) {
    const candidate = new Date(cursor.getTime() + offset * 60_000)
    const parts = localParts(candidate, timezone)
    if (parts.time === schedule.time && (schedule.frequency === 'daily' || parts.weekday === schedule.weekday)) return candidate
  }
  throw new Error('Unable to calculate the next backup run in the configured timezone.')
}

export class BackupScheduler {
  constructor({ store, service, environmentTimezone = null }) {
    this.store = store
    this.service = service
    this.environmentTimezone = environmentTimezone
    this.timer = null
    this.stopped = true
  }

  effectiveSchedule(schedule = this.store.getBackupManagementState().schedule) {
    return { ...schedule, timezone: this.environmentTimezone ?? schedule.timezone ?? 'UTC' }
  }

  async update(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Backup schedule update must be an object.')
    const current = this.store.getBackupManagementState().schedule
    const changes = Object.fromEntries(SCHEDULE_INPUT_KEYS
      .filter((key) => Object.hasOwn(input, key))
      .map((key) => [key, input[key]]))
    const schedule = this.effectiveSchedule({ ...current, ...changes, updatedAt: new Date().toISOString() })
    const nextRun = nextBackupRun(schedule)
    schedule.nextRunAt = nextRun?.toISOString() ?? null
    assertBackupSchedule(schedule)
    this.store.updateBackupManagement((draft) => { draft.schedule = schedule })
    await this.store.flush(['backupManagement'])
    this.arm()
    return this.service.status()
  }

  start() {
    this.stopped = false
    this.arm()
    return { stop: () => this.stop() }
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  arm() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.stopped) return
    const schedule = this.effectiveSchedule()
    if (!schedule.enabled) return
    const next = nextBackupRun(schedule)
    const delay = Math.max(0, next.getTime() - Date.now())
    if (delay > MAX_TIMER_MS) {
      this.timer = setTimeout(() => this.arm(), MAX_TIMER_MS)
    } else {
      this.timer = setTimeout(() => void this.run(next), delay)
    }
    this.timer.unref?.()
  }

  async run(intendedRun) {
    try {
      const schedule = this.effectiveSchedule()
      if (schedule.lastRunAt && Date.parse(schedule.lastRunAt) >= intendedRun.getTime()) return
      await this.service.create({
        sections: COMPLETE_BACKUP_SECTIONS,
        label: `Scheduled backup ${intendedRun.toISOString()}`,
        kind: 'scheduled',
        passphrase: this.service.environmentPassphrase,
      })
      await this.service.pruneScheduled(schedule.retention)
      this.store.updateBackupManagement((draft) => {
        draft.schedule.lastRunAt = new Date().toISOString()
        draft.schedule.lastResult = 'success'
        draft.schedule.nextRunAt = nextBackupRun(this.effectiveSchedule(draft.schedule))?.toISOString() ?? null
      })
    } catch (error) {
      console.error('[backup] Scheduled backup failed.', error instanceof Error ? error.message : error)
      this.store.updateBackupManagement((draft) => {
        draft.schedule.lastRunAt = new Date().toISOString()
        draft.schedule.lastResult = 'failed'
        draft.schedule.nextRunAt = nextBackupRun(this.effectiveSchedule(draft.schedule))?.toISOString() ?? null
      })
    } finally {
      await this.store.flush(['backupManagement']).catch(() => {})
      this.arm()
    }
  }
}
