import { describe, expect, it, vi } from 'vitest'
import { gracefullyStopServer } from './server-lifecycle.mjs'

describe('gracefullyStopServer', () => {
  it('closes event streams, stops background work, and flushes before completing', async () => {
    const order = []
    const server = {
      close(callback) {
        order.push('server-close')
        queueMicrotask(() => callback())
      },
    }

    await gracefullyStopServer({
      server,
      sseHub: { closeAll: () => order.push('sse-close') },
      stoppers: [async () => order.push('stop-background')],
      flush: async () => order.push('flush'),
    })

    expect(order).toEqual(['server-close', 'sse-close', 'stop-background', 'flush'])
  })

  it('forces lingering connections closed after the deadline', async () => {
    let closeCallback
    const server = {
      close: vi.fn((callback) => { closeCallback = callback }),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(() => closeCallback()),
    }

    await gracefullyStopServer({ server, timeoutMs: 1 })

    expect(server.closeIdleConnections).toHaveBeenCalledOnce()
    expect(server.closeAllConnections).toHaveBeenCalledOnce()
  })

  it('finishes persistence and socket cleanup before reporting background stop failures', async () => {
    const order = []
    const server = {
      close(callback) {
        order.push('server-close')
        queueMicrotask(() => callback())
      },
    }

    await expect(gracefullyStopServer({
      server,
      stoppers: [async () => {
        order.push('stop-background')
        throw new Error('stop failed')
      }],
      flush: async () => order.push('flush'),
    })).rejects.toThrow('One or more shutdown operations failed.')

    expect(order).toEqual(['server-close', 'stop-background', 'flush'])
  })

  it('closes databases only after active requests and persistence complete', async () => {
    const order = []
    let finishRequest
    const server = {
      close(callback) {
        order.push('server-close')
        finishRequest = () => {
          order.push('request-finished')
          callback()
        }
      },
    }

    const stopping = gracefullyStopServer({
      server,
      stoppers: [async () => order.push('scheduler-stopped')],
      flush: async () => order.push('stores-flushed'),
      closers: [async () => order.push('database-closed')],
    })
    await Promise.resolve()
    expect(order).toEqual(['server-close', 'scheduler-stopped'])
    finishRequest()
    await stopping
    expect(order).toEqual([
      'server-close',
      'scheduler-stopped',
      'request-finished',
      'stores-flushed',
      'database-closed',
    ])
  })
})
