import { describe, expect, test } from 'bun:test'
import { containerKey, serviceKey } from './entity-keys.mjs'

describe('telemetry entity keys', () => {
  test('ignore changing container metrics', () => {
    expect(containerKey({ runtime: 'docker', runtimeId: 'abc', cpuPercent: 1 }))
      .toBe(containerKey({ runtime: 'docker', runtimeId: 'abc', cpuPercent: 99 }))
  })

  test('reject missing identities', () => {
    expect(() => serviceKey({ activeState: 'active' })).toThrow('service identity')
  })
})
