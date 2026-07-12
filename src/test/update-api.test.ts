import { describe, expect, it } from 'vitest'
import {
  getUpdateStatusRefetchInterval,
  shouldHighlightUpdate,
  UPDATE_STATUS_FRESH_MS,
  UPDATE_STATUS_REFRESH_FOLLOW_UP_MS,
  type UpdateStatus,
} from '@/lib/update-api'

const currentStatus: UpdateStatus = {
  enabled: true,
  channel: 'stable',
  runningVersion: '0.1.16',
  runningRevision: 'running',
  availableVersion: '0.1.16',
  availableRevision: 'published',
  updateAvailable: false,
  skipped: false,
  checkedAt: '2026-07-12T12:00:00.000Z',
  state: 'current',
  errorCode: null,
  entries: [],
}

describe('update API polling', () => {
  it('uses the normal six-hour interval for a fresh result', () => {
    expect(getUpdateStatusRefetchInterval(
      currentStatus,
      Date.parse('2026-07-12T12:30:00.000Z'),
    )).toBe(UPDATE_STATUS_FRESH_MS)
  })

  it('follows up quickly after receiving a stale persisted result', () => {
    expect(getUpdateStatusRefetchInterval(
      currentStatus,
      Date.parse('2026-07-12T18:00:00.000Z'),
    )).toBe(UPDATE_STATUS_REFRESH_FOLLOW_UP_MS)
  })

  it('stops polling when update checks are disabled', () => {
    expect(getUpdateStatusRefetchInterval({
      ...currentStatus,
      enabled: false,
      checkedAt: null,
      state: 'disabled',
    })).toBe(false)
  })

  it('highlights only an available version that has not been skipped', () => {
    expect(shouldHighlightUpdate({ ...currentStatus, state: 'available', updateAvailable: true })).toBe(true)
    expect(shouldHighlightUpdate({ ...currentStatus, state: 'available', updateAvailable: true, skipped: true })).toBe(false)
    expect(shouldHighlightUpdate(currentStatus)).toBe(false)
    expect(shouldHighlightUpdate({ ...currentStatus, state: 'unknown', updateAvailable: true })).toBe(false)
    expect(shouldHighlightUpdate({ ...currentStatus, state: 'disabled', enabled: false })).toBe(false)
    expect(shouldHighlightUpdate(undefined)).toBe(false)
  })
})
