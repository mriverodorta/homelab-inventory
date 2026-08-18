import { describe, expect, it } from 'vitest'
import { shouldHighlightUpdate, type UpdateStatus } from '@/lib/update-api'

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

describe('update API state', () => {
  it('highlights only an available version that has not been skipped', () => {
    expect(shouldHighlightUpdate({ ...currentStatus, state: 'available', updateAvailable: true })).toBe(true)
    expect(shouldHighlightUpdate({ ...currentStatus, state: 'available', updateAvailable: true, skipped: true })).toBe(false)
    expect(shouldHighlightUpdate(currentStatus)).toBe(false)
    expect(shouldHighlightUpdate({ ...currentStatus, state: 'unknown', updateAvailable: true })).toBe(false)
    expect(shouldHighlightUpdate({ ...currentStatus, state: 'disabled', enabled: false })).toBe(false)
    expect(shouldHighlightUpdate(undefined)).toBe(false)
  })
})
