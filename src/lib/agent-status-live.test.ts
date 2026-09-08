import { describe, expect, it } from 'vitest'
import { mergeAgentStatusEvent } from './agent-status-live'
import type { ApplicationLiveEvent } from '@/live-events/model'
import type { AgentStatusSummary } from '@/types/agent'

const status = { hostType: 'server' as const, hostId: 1, state: 'online' as const, connected: true, ageMs: 0, agentVersion: '0.3.4' }
const current: AgentStatusSummary = { hosts: { 'server:1': status }, registeredHosts: [{ hostType: 'server', hostId: 1 }] }
const event = (patch: Record<string, unknown> = {}, kind = 'agent.heartbeat'): ApplicationLiveEvent => ({
  version: 1, generationId: 'test', sequence: 1, topic: 'agents:fleet', topics: ['agents:fleet'],
  occurredAt: '2026-09-08T12:00:00.000Z', kind,
  payload: { host: { hostType: 'server', hostId: 1 }, status: { ...status, ...patch } },
})

describe('fleet status deltas', () => {
  it.each(['agent.heartbeat', 'agent.status-online', 'agent.status-stale', 'agent.status-offline', 'agent.status-unknown'])('merges %s without changing membership or input', (kind) => {
    const next = mergeAgentStatusEvent(current, event({ state: 'offline', ageMs: 90000 }, kind))!
    expect(next.hosts?.['server:1']).toMatchObject({ state: 'offline', ageMs: 90000 })
    expect(next.registeredHosts).toBe(current.registeredHosts)
    expect(current.hosts?.['server:1']).toEqual(status)
  })

  it('updates detail availability and platform without accepting full telemetry', () => {
    const details = { metrics: true, services: true, containers: true, storage: false, network: false, hardware: false }
    const next = mergeAgentStatusEvent(current, event({ details, commandPlatform: 'alpine', services: [{ name: 'not-summary-data' }] }))!
    expect(next.hosts?.['server:1'].details).toEqual(details)
    expect(next.hosts?.['server:1'].commandPlatform).toBe('alpine')
    expect(next.hosts?.['server:1'].services).toBeUndefined()
  })

  it.each([
    { hostId: 2 }, { hostType: 'nas' }, { state: 'invalid' }, { connected: false },
    { agentVersion: '0.3.5' }, { ageMs: -1 }, { ageMs: NaN }, { ageMs: Infinity },
    { droppedSamples: 0.5 }, { monitoringRevision: -1 }, { hostname: 1 },
    { details: null }, { details: { services: true } }, { commandPlatform: 'invalid' },
  ])('requires a snapshot for invalid or unreconstructable status %j', (patch) => {
    expect(mergeAgentStatusEvent(current, event(patch))).toBeNull()
  })

  it('requires a snapshot for missing host, missing payload and unknown hosts', () => {
    expect(mergeAgentStatusEvent(undefined, event())).toBeNull()
    expect(mergeAgentStatusEvent({ hosts: {} }, event())).toBeNull()
    expect(mergeAgentStatusEvent(current, { ...event(), payload: {} })).toBeNull()
    expect(mergeAgentStatusEvent(current, { ...event(), payload: { ...event().payload, status: null } })).toBeNull()
  })

  it('maintains the legacy server alias without altering unrelated hosts', () => {
    const summary = { servers: { '1': status, '2': { ...status, hostId: 2 } } }
    const next = mergeAgentStatusEvent(summary, event({ ageMs: null, hostname: null }))!
    expect(next.hosts?.['server:1']).toBe(next.servers?.['1'])
    expect(next.servers?.['1'].ageMs).toBeNull()
    expect(next.servers?.['2']).toBe(summary.servers['2'])
  })
})
