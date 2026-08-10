import { describe, expect, it } from 'vitest'
import { createNotificationConfig } from './model.mjs'
import { quietHoursActive, resolveHostNotificationPolicy } from './policy-resolver.mjs'

describe('notification policy resolver', () => {
  it('inherits global rules and selected host resources', () => {
    const config = createNotificationConfig(0)
    config.enabled = true
    config.monitoredResources.push({ id: 1, hostType: 'server', hostId: 2, family: 'service', key: 'docker', name: 'Docker', enabled: true })
    const policy = resolveHostNotificationPolicy(config, 'server', 2, 0)
    expect(policy.enabled).toBe(true)
    expect(policy.resources.map((resource) => resource.id)).toEqual([1])
  })

  it('supports disabled and temporarily muted host overrides', () => {
    const config = createNotificationConfig(0)
    config.enabled = true
    config.hostOverrides.push({ id: 1, hostType: 'server', hostId: 2, mode: 'disabled', mutedUntil: null, monitoredResourceIds: [] })
    expect(resolveHostNotificationPolicy(config, 'server', 2, 0).enabled).toBe(false)
    config.hostOverrides[0].mode = 'inherit'
    config.hostOverrides[0].mutedUntil = new Date(60_000).toISOString()
    expect(resolveHostNotificationPolicy(config, 'server', 2, 0).muted).toBe(true)
  })

  it('evaluates overnight quiet hours in the configured timezone', () => {
    const schedule = [{ id: 1, enabled: true, timezone: 'UTC', start: '22:00', end: '06:00', weekdays: [1] }]
    expect(quietHoursActive(schedule, Date.parse('2026-08-10T23:00:00Z'))).toBe(true)
    expect(quietHoursActive(schedule, Date.parse('2026-08-11T05:00:00Z'))).toBe(true)
    expect(quietHoursActive(schedule, Date.parse('2026-08-11T07:00:00Z'))).toBe(false)
  })
})
