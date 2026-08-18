import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationLiveEventBus } from './event-bus.mjs'
import { ApplicationSseHub } from './sse-hub.mjs'

function connection() {
  const request = new EventEmitter()
  const response = new EventEmitter()
  response.chunks = []
  response.status = vi.fn(() => response)
  response.set = vi.fn(() => response)
  response.json = vi.fn(() => response)
  response.write = vi.fn((value) => { response.chunks.push(value); return true })
  response.end = vi.fn()
  response.flushHeaders = vi.fn()
  return { request, response }
}

describe('ApplicationSseHub', () => {
  it('filters events by scope and topic and cleans up disconnected clients', () => {
    const bus = new ApplicationLiveEventBus({ generationId: 'generation' })
    const hub = new ApplicationSseHub({ bus, heartbeatMs: 60_000 })
    const firstScope = {}
    const secondScope = {}
    const { request, response } = connection()
    hub.connect({ scope: firstScope, topics: [{ value: 'agents:fleet' }], request, response })
    bus.publish({ scope: secondScope, topics: 'agents:fleet', kind: 'ignored' })
    bus.publish({ scope: firstScope, topics: 'systems:1', kind: 'ignored' })
    bus.publish({ scope: firstScope, topics: 'agents:fleet', kind: 'agent.changed', payload: { hostId: 7 } })
    const output = response.chunks.join('')
    expect(output).toContain('event: stream-ready')
    expect(output).toContain('"topicSequences":{"agents:fleet":0}')
    expect(output).toContain('event: app-event')
    expect(output).toContain('agent.changed')
    expect(output).not.toContain('"kind":"ignored"')
    request.emit('close')
    expect(hub.clients.size).toBe(0)
  })

  it('rejects excess clients before opening a stream', () => {
    const hub = new ApplicationSseHub({ bus: new ApplicationLiveEventBus(), maxClients: 0 })
    const { request, response } = connection()
    expect(hub.connect({ scope: {}, topics: [{ value: 'agents:fleet' }], request, response })).toBeNull()
    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'event-stream-capacity' }))
  })
})
