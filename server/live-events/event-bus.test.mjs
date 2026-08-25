import { describe, expect, it, vi } from 'vitest'
import { ApplicationLiveEventBus } from './event-bus.mjs'
import { parseApplicationLiveTopics } from './topics.mjs'

describe('ApplicationLiveEventBus', () => {
  it('publishes ordered immutable events and isolates listener failures', () => {
    const bus = new ApplicationLiveEventBus({ generationId: 'generation', now: () => '2026-08-18T00:00:00.000Z' })
    const listener = vi.fn()
    bus.subscribe(() => { throw new Error('listener failed') })
    const unsubscribe = bus.subscribe(listener)
    const first = bus.publish({ topics: ['agents:fleet', 'systems:1'], kind: 'agent.changed', payload: { hostId: 7 } })
    const second = bus.publish({ topics: 'agents:fleet', kind: 'agent.changed', payload: { hostId: 8 } })
    expect(first).toMatchObject({ generationId: 'generation', sequence: 1, topics: ['agents:fleet', 'systems:1'] })
    expect(second.sequence).toBe(2)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(bus.snapshot({ topics: ['agents:fleet', 'systems:1'] }).topicSequences).toEqual({
      'agents:fleet': 2,
      'systems:1': 1,
    })
    expect(() => { first.payload.hostId = 9 }).toThrow()
    unsubscribe()
    bus.publish({ topics: 'agents:fleet', kind: 'agent.changed' })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('tracks topic sequences independently for each application scope', () => {
    const bus = new ApplicationLiveEventBus({ generationId: 'generation' })
    const first = {}
    const second = {}
    bus.publish({ scope: first, topics: 'systems:1', kind: 'changed' })
    bus.publish({ scope: second, topics: 'systems:1', kind: 'changed' })
    bus.publish({ topics: 'updates:status', kind: 'changed' })
    expect(bus.snapshot({ scope: first, topics: ['systems:1', 'updates:status'] }).topicSequences).toEqual({
      'systems:1': 1,
      'updates:status': 3,
    })
    expect(bus.snapshot({ scope: second, topics: ['systems:1'] }).topicSequences).toEqual({ 'systems:1': 2 })
  })

  it('rejects oversized payloads and closes cleanly', () => {
    const bus = new ApplicationLiveEventBus({ maxPayloadBytes: 4 })
    expect(() => bus.publish({ topics: 'agents:fleet', kind: 'changed', payload: { value: 'large' } })).toThrow('size limit')
    bus.close()
    expect(bus.publish({ topics: 'agents:fleet', kind: 'changed' })).toBeNull()
    expect(() => bus.subscribe(() => {})).toThrow('closed')
  })
})

describe('parseApplicationLiveTopics', () => {
  it('normalizes supported topics', () => {
    expect(parseApplicationLiveTopics('systems:1,agents:fleet,systems:1').map((topic) => topic.value)).toEqual(['agents:fleet', 'systems:1'])
    expect(parseApplicationLiveTopics('agent-telemetry:nas:7')[0]).toMatchObject({ hostType: 'nas', hostId: 7, permission: 'agents.view' })
    expect(parseApplicationLiveTopics('systems:2')[0]).toMatchObject({ permissions: ['project.view', 'agents.view'] })
    expect(parseApplicationLiveTopics('systems:2:workspace:7')[0]).toMatchObject({
      projectId: 2,
      workspaceId: 7,
      permissions: ['project.view', 'agents.view'],
    })
    expect(parseApplicationLiveTopics('compatibility:2')[0]).toMatchObject({
      permissions: ['project.view', 'audit.view'], projectId: 2,
    })
  })

  it.each(['', 'systems:0', 'agent-telemetry:router:1', 'unknown'])('rejects invalid topic %s', (topic) => {
    expect(() => parseApplicationLiveTopics(topic)).toThrow()
  })
})
