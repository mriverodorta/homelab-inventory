import { describe, expect, it } from 'vitest'
import {
  assertNotificationConfig,
  assertNotificationState,
  createNotificationConfig,
  createNotificationState,
} from './model.mjs'

describe('notification model', () => {
  it('creates disabled defaults with numeric rule ids', () => {
    const config = createNotificationConfig(0)
    expect(config.enabled).toBe(false)
    expect(config.rules).toHaveLength(6)
    expect(config.rules.every((rule) => Number.isSafeInteger(rule.id) && rule.id > 0)).toBe(true)
    expect(assertNotificationConfig(config)).toBe(true)
  })

  it('rejects dangling contact point relationships', () => {
    const config = createNotificationConfig(0)
    config.rules[0].contactPointIds = [99]
    expect(() => assertNotificationConfig(config)).toThrow('missing contact point 99')
  })

  it('rejects non-numeric persisted resource relationships', () => {
    const config = createNotificationConfig(0)
    config.monitoredResources.push({
      id: 'docker', hostType: 'server', hostId: 1, family: 'service', key: 'docker', name: 'Docker', enabled: true,
    })
    expect(() => assertNotificationConfig(config)).toThrow('positive safe integer')
  })

  it('rejects quiet-hours schedules with an invalid IANA time zone', () => {
    const config = createNotificationConfig(0)
    config.quietHours.push({ id: 1, enabled: true, timezone: 'Not/A_Timezone', start: '22:00', end: '06:00', weekdays: [0] })
    expect(() => assertNotificationConfig(config)).toThrow('valid IANA time zone')
  })

  it('rejects delivery attempts whose job is missing', () => {
    const state = createNotificationState(0)
    state.deliveryAttempts.push({ id: 1, deliveryJobId: 1 })
    expect(() => assertNotificationState(state)).toThrow('missing job 1')
  })
})
