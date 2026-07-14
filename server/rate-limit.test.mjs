import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { describe, expect, it, vi } from 'vitest'
import {
  createRateLimitOptions,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  readRateLimitConfig,
} from './rate-limit.mjs'

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

describe('rate-limit configuration', () => {
  it('uses safe defaults', () => {
    expect(readRateLimitConfig({})).toEqual({
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
      limit: DEFAULT_RATE_LIMIT_MAX,
      trustProxy: false,
    })
  })

  it('accepts positive integer limits and a proxy hop count', () => {
    expect(readRateLimitConfig({
      RATE_LIMIT_WINDOW_MS: '30000',
      RATE_LIMIT_MAX: '250',
      TRUST_PROXY: '1',
    })).toEqual({
      windowMs: 30_000,
      limit: 250,
      trustProxy: 1,
    })
  })

  it.each(['0', '-1', '1.5', 'many'])('warns and falls back for invalid RATE_LIMIT_MAX=%s', (value) => {
    const warn = vi.fn()

    expect(readRateLimitConfig({ RATE_LIMIT_MAX: value }, warn).limit).toBe(DEFAULT_RATE_LIMIT_MAX)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_MAX'))
  })

  it('falls back for invalid windows and unsafe boolean trust proxy configuration', () => {
    const warn = vi.fn()
    const config = readRateLimitConfig({
      RATE_LIMIT_WINDOW_MS: '-100',
      TRUST_PROXY: 'true',
    }, warn)

    expect(config).toEqual({
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
      limit: DEFAULT_RATE_LIMIT_MAX,
      trustProxy: false,
    })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('accepts an explicit proxy or subnet string', () => {
    expect(readRateLimitConfig({ TRUST_PROXY: 'loopback, linklocal, uniquelocal' }).trustProxy)
      .toBe('loopback, linklocal, uniquelocal')
  })
})

describe('rate-limit middleware options', () => {
  it('returns JSON after an API client exceeds the request limit', async () => {
    const app = express()
    app.use(rateLimit(createRateLimitOptions({ windowMs: 60_000, limit: 2 })))
    app.get('/api/test', (_request, response) => response.json({ ok: true }))

    const { server, url } = await listen(app)

    try {
      const first = await fetch(`${url}/api/test`)
      const second = await fetch(`${url}/api/test`)
      const blocked = await fetch(`${url}/api/test`)

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(blocked.status).toBe(429)
      expect(blocked.headers.get('ratelimit')).toBeTruthy()
      await expect(blocked.json()).resolves.toEqual({
        message: 'Too many requests. Please try again shortly.',
      })
    } finally {
      await close(server)
    }
  })
})
