import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { EngineSseHub } from './sse-hub.mjs'

function createStore() {
  let listener = null
  return {
    emit(event) {
      listener?.(event)
    },
    subscribeToProjectCommits(next) {
      listener = next
      return () => { listener = null }
    },
  }
}

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
  }
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
})
