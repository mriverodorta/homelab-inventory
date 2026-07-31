import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { EngineSseHub } from './sse-hub.mjs'

function createStore() {
  let listener = null
  const unsubscribe = vi.fn(() => { listener = null })
  return {
    unsubscribe,
    emit(event) {
      listener?.(event)
    },
    subscribeToProjectCommits(next) {
      listener = next
      return unsubscribe
    },
  }
}

function createResponse() {
  return Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  })
}

describe('EngineSseHub', () => {
  it('publishes committed patches only to clients for the matching store', () => {
    const first = createStore()
    const second = createStore()
    const firstResponse = createResponse()
    const secondResponse = createResponse()
    const firstRequest = new EventEmitter()
    const secondRequest = new EventEmitter()
    const hub = new EngineSseHub({ heartbeatMs: 60_000 })

    hub.connect(first, firstRequest, firstResponse)
    hub.connect(second, secondRequest, secondResponse)
    firstResponse.write.mockClear()
    secondResponse.write.mockClear()

    first.emit({
      type: 'project-commit',
      baseRevision: 4,
      revision: 5,
      responseBytes: Uint8Array.from([1, 2, 3]),
    })

    expect(firstResponse.write.mock.calls.flat().join('')).toContain('event: project-patch')
    expect(firstResponse.write.mock.calls.flat().join('')).toContain('AQID')
    expect(secondResponse.write).not.toHaveBeenCalled()

    firstRequest.emit('close')
    secondRequest.emit('close')
  })

  it('publishes canonical invalidations without a binary payload', () => {
    const store = createStore()
    const response = createResponse()
    const request = new EventEmitter()
    const hub = new EngineSseHub({ heartbeatMs: 60_000 })

    hub.connect(store, request, response)
    response.write.mockClear()
    store.emit({ type: 'canonical-invalidated', baseRevision: 8, revision: 9 })

    const output = response.write.mock.calls.flat().join('')
    expect(output).toContain('event: project-invalidated')
    expect(output).toContain('"revision":9')
    expect(output).not.toContain('payload')
    request.emit('close')
  })

  it('closes every active stream and releases its store subscription', () => {
    const first = createStore()
    const second = createStore()
    const firstResponse = createResponse()
    const secondResponse = createResponse()
    const hub = new EngineSseHub({ heartbeatMs: 60_000 })

    hub.connect(first, new EventEmitter(), firstResponse)
    hub.connect(second, new EventEmitter(), secondResponse)

    expect(hub.closeAll()).toBe(2)
    expect(firstResponse.end).toHaveBeenCalledOnce()
    expect(secondResponse.end).toHaveBeenCalledOnce()
    expect(hub.closeAll()).toBe(0)

    firstResponse.write.mockClear()
    first.emit({ type: 'canonical-invalidated', baseRevision: 1, revision: 2 })
    expect(firstResponse.write).not.toHaveBeenCalled()
  })

  it('rejects excess streams before opening an SSE response', () => {
    const store = createStore()
    const firstResponse = createResponse()
    const rejectedResponse = createResponse()
    rejectedResponse.json = vi.fn()
    const hub = new EngineSseHub({ heartbeatMs: 60_000, maxClients: 1 })

    hub.connect(store, new EventEmitter(), firstResponse)
    expect(hub.connect(store, new EventEmitter(), rejectedResponse)).toBeNull()

    expect(rejectedResponse.status).toHaveBeenCalledWith(503)
    expect(rejectedResponse.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'event-stream-capacity' }))
    expect(rejectedResponse.set).not.toHaveBeenCalled()
    hub.closeAll()
  })

  it('cleans up a stream when a heartbeat write fails', () => {
    vi.useFakeTimers()
    const store = createStore()
    const response = createResponse()
    const hub = new EngineSseHub({ heartbeatMs: 10 })

    hub.connect(store, new EventEmitter(), response)
    response.write.mockImplementation(() => { throw new Error('closed') })
    vi.advanceTimersByTime(10)

    expect(hub.clientCount).toBe(0)
    expect(hub.closeAll()).toBe(0)
    vi.useRealTimers()
  })

  it('cleans up a subscription when the initial stream write fails', () => {
    const store = createStore()
    const response = createResponse()
    response.write.mockImplementationOnce(() => { throw new Error('closed') })
    const hub = new EngineSseHub()

    expect(hub.connect(store, new EventEmitter(), response)).toBeNull()
    expect(hub.clientCount).toBe(0)
    expect(store.unsubscribe).toHaveBeenCalledOnce()
  })
})
