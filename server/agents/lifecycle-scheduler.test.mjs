import { describe, expect, it, vi } from 'vitest'
import { AgentLifecycleScheduler } from './lifecycle-scheduler.mjs'
import { agentStatusTiming, resolveAgentStatusState } from './status-model.mjs'

describe('AgentLifecycleScheduler', () => {
  it('uses one nearest timer and emits stale and offline transitions', () => {
    vi.useFakeTimers()
    try {
      const start = Date.parse('2026-08-18T00:00:00.000Z')
      vi.setSystemTime(start)
      const timing = agentStatusTiming(60)
      const host = { hostType: 'server', hostId: 7 }
      const summary = (now) => {
        const state = resolveAgentStatusState({ connected: true, lastSeenAt: new Date(start).toISOString(), now, timing })
        return { registeredHosts: [host], hosts: { 'server:7': { ...host, ...state, lastSeenAt: new Date(start).toISOString() } } }
      }
      const changed = vi.fn()
      const scheduler = new AgentLifecycleScheduler({ summary, onTransition: changed, timing })
      scheduler.start()
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(timing.onlineMaxAgeMs + 1)
      expect(changed).toHaveBeenLastCalledWith(host, expect.objectContaining({ state: 'stale' }))
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(timing.staleMaxAgeMs - timing.onlineMaxAgeMs)
      expect(changed).toHaveBeenLastCalledWith(host, expect.objectContaining({ state: 'offline' }))
      expect(vi.getTimerCount()).toBe(0)
      scheduler.stop()
    } finally { vi.useRealTimers() }
  })
})

