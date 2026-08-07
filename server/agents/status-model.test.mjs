import { describe, expect, it } from 'vitest'
import { agentStatusTiming, resolveAgentStatusState } from './status-model.mjs'

describe('agent status timing', () => {
  it('derives status thresholds from the active heartbeat contract interval', () => {
    expect(agentStatusTiming(120)).toEqual({
      heartbeatIntervalMs: 120_000,
      onlineMaxAgeMs: 180_000,
      staleMaxAgeMs: 600_000,
    })
  })

  it('uses the derived thresholds for every connected host state', () => {
    const now = Date.parse('2026-08-07T12:10:00.000Z')
    const timing = agentStatusTiming(60)
    const stateAt = (lastSeenAt) => resolveAgentStatusState({ connected: true, lastSeenAt, now, timing })

    expect(stateAt(null)).toEqual({ state: 'unknown', ageMs: null })
    expect(stateAt('2026-08-07T12:08:30.000Z')).toEqual({ state: 'online', ageMs: 90_000 })
    expect(stateAt('2026-08-07T12:05:00.000Z')).toEqual({ state: 'stale', ageMs: 300_000 })
    expect(stateAt('2026-08-07T12:04:59.999Z')).toEqual({ state: 'offline', ageMs: 300_001 })
  })

  it('reports disconnected hosts as unregistered without trusting persisted timestamps', () => {
    expect(resolveAgentStatusState({
      connected: false,
      lastSeenAt: '2026-08-07T12:00:00.000Z',
      now: Date.parse('2026-08-07T12:00:01.000Z'),
      timing: agentStatusTiming(60),
    })).toEqual({ state: 'unregistered', ageMs: 1_000 })
  })
})
