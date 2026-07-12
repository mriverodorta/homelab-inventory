import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import { registerUpdateRoutes } from './update-routes.mjs'

const RELEASE_NOTES = [
  {
    version: '0.1.16',
    date: '2026-07-12',
    channel: 'latest',
    title: 'Docker update notifications',
    highlights: ['A newer image is visible.'],
    fixes: [],
  },
]

const AVAILABLE_RESULT = {
  state: 'available',
  channel: 'stable',
  runningVersion: '0.1.15',
  runningRevision: 'running-sha',
  availableVersion: '0.1.16',
  availableRevision: 'published-sha',
  updateAvailable: true,
  checkedAt: '2026-07-12T12:00:00.000Z',
  errorCode: null,
}

function createStore(metadata = {}) {
  let skippedUpdateVersion = metadata.skippedUpdateVersion ?? null
  let lastUpdateCheck = metadata.lastUpdateCheck ?? null

  return {
    getUpdateMetadata: vi.fn(() => ({ skippedUpdateVersion, lastUpdateCheck })),
    isUpdateVersionSkipped: vi.fn((version) => skippedUpdateVersion === version),
    saveUpdateCheck: vi.fn(async (result) => { lastUpdateCheck = result }),
    skipUpdateVersion: vi.fn(async (version) => { skippedUpdateVersion = version }),
    clearSkippedUpdateVersion: vi.fn(async () => { skippedUpdateVersion = null }),
  }
}

function createApp({ checker, store }) {
  const app = express()
  app.use(express.json())

  const withStore = (request, response, handler, options = {}) => {
    void Promise.resolve(handler(store)).catch((error) => {
      response.status(options.status ?? 500).json({
        message: error instanceof Error ? error.message : (options.message ?? 'Update request failed.'),
      })
    })
  }

  registerUpdateRoutes(app, { checker, withStore, releaseNotes: RELEASE_NOTES })
  return app
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
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

async function requestJson(url, init) {
  const response = await fetch(url, init)
  return { response, body: await response.json() }
}

describe('update status routes', () => {
  it('returns disabled status without contacting Docker Hub', async () => {
    const checker = {
      enabled: false,
      channel: 'stable',
      runningVersion: '0.1.15',
      runningRevision: 'running-sha',
      now: Date.now,
      check: vi.fn(),
    }
    const store = createStore()
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const { response, body } = await requestJson(`${url}/api/update-status`)
      expect(response.status).toBe(200)
      expect(body).toMatchObject({ enabled: false, state: 'disabled', updateAvailable: false })
      expect(checker.check).not.toHaveBeenCalled()
    } finally {
      await close(server)
    }
  })

  it('returns a fresh available result with local release notes', async () => {
    const checker = {
      enabled: true,
      channel: 'stable',
      runningVersion: '0.1.15',
      runningRevision: 'running-sha',
      now: () => Date.parse('2026-07-12T12:30:00.000Z'),
      check: vi.fn(async () => AVAILABLE_RESULT),
    }
    const store = createStore()
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const { response, body } = await requestJson(`${url}/api/update-status`)
      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        enabled: true,
        state: 'available',
        availableVersion: '0.1.16',
        updateAvailable: true,
        skipped: false,
      })
      expect(body.entries.map((entry) => entry.version)).toEqual(['0.1.16'])
      expect(store.saveUpdateCheck).toHaveBeenCalledWith(AVAILABLE_RESULT)
    } finally {
      await close(server)
    }
  })

  it('forces a registry refresh from the check endpoint', async () => {
    const checker = {
      enabled: true,
      channel: 'latest',
      runningVersion: '0.1.15',
      runningRevision: 'running-sha',
      now: Date.now,
      check: vi.fn(async () => ({ ...AVAILABLE_RESULT, channel: 'latest' })),
    }
    const latestResult = { ...AVAILABLE_RESULT, channel: 'latest' }
    const store = createStore({ lastUpdateCheck: latestResult })
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const { response } = await requestJson(`${url}/api/update-status/check`, { method: 'POST' })
      expect(response.status).toBe(200)
      expect(checker.check).toHaveBeenCalledWith({ force: true, persistedResult: latestResult })
    } finally {
      await close(server)
    }
  })

  it('returns stale persisted status immediately and refreshes it in the background', async () => {
    const refreshedResult = {
      ...AVAILABLE_RESULT,
      availableVersion: '0.1.17',
      availableRevision: 'newer-sha',
      checkedAt: '2026-07-12T20:00:00.000Z',
    }
    const checker = {
      enabled: true,
      channel: 'stable',
      runningVersion: '0.1.15',
      runningRevision: 'running-sha',
      now: () => Date.parse('2026-07-12T20:00:00.000Z'),
      check: vi.fn(async () => refreshedResult),
    }
    const store = createStore({ lastUpdateCheck: AVAILABLE_RESULT })
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const { body } = await requestJson(`${url}/api/update-status`)
      expect(body.availableVersion).toBe('0.1.16')
      expect(checker.check).toHaveBeenCalledWith({ force: true, persistedResult: AVAILABLE_RESULT })
      await vi.waitFor(() => expect(store.saveUpdateCheck).toHaveBeenCalledWith(refreshedResult))
    } finally {
      await close(server)
    }
  })

  it('skips and clears only the currently available version', async () => {
    const checker = {
      enabled: true,
      channel: 'stable',
      runningVersion: '0.1.15',
      runningRevision: 'running-sha',
      now: () => Date.parse('2026-07-12T12:30:00.000Z'),
      check: vi.fn(async () => AVAILABLE_RESULT),
    }
    const store = createStore({ lastUpdateCheck: AVAILABLE_RESULT })
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const skipped = await requestJson(`${url}/api/update-status/skip`, { method: 'POST' })
      expect(skipped.response.status).toBe(200)
      expect(skipped.body.skipped).toBe(true)
      expect(store.skipUpdateVersion).toHaveBeenCalledWith('0.1.16')

      const cleared = await requestJson(`${url}/api/update-status/skip`, { method: 'DELETE' })
      expect(cleared.response.status).toBe(200)
      expect(cleared.body.skipped).toBe(false)
      expect(store.clearSkippedUpdateVersion).toHaveBeenCalledTimes(1)
    } finally {
      await close(server)
    }
  })

  it('rejects skipping when no newer image is available', async () => {
    const currentResult = { ...AVAILABLE_RESULT, state: 'current', updateAvailable: false, availableVersion: '0.1.15' }
    const checker = {
      enabled: true,
      channel: 'stable',
      runningVersion: '0.1.15',
      runningRevision: 'running-sha',
      now: Date.now,
      check: vi.fn(async () => currentResult),
    }
    const store = createStore({ lastUpdateCheck: currentResult })
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const { response, body } = await requestJson(`${url}/api/update-status/skip`, { method: 'POST' })
      expect(response.status).toBe(409)
      expect(body.message).toBe('No update is available to skip.')
    } finally {
      await close(server)
    }
  })

  it('returns the persisted result as unknown when a forced registry check fails', async () => {
    const checker = {
      enabled: true,
      channel: 'stable',
      runningVersion: '0.1.15',
      runningRevision: 'running-sha',
      now: Date.now,
      check: vi.fn(async () => ({
        state: 'unknown',
        channel: 'stable',
        runningVersion: '0.1.15',
        runningRevision: 'running-sha',
        availableVersion: null,
        availableRevision: null,
        updateAvailable: false,
        checkedAt: null,
        errorCode: 'registry-timeout',
      })),
    }
    const store = createStore({ lastUpdateCheck: AVAILABLE_RESULT })
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const { response, body } = await requestJson(`${url}/api/update-status/check`, { method: 'POST' })
      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        state: 'unknown',
        availableVersion: '0.1.16',
        updateAvailable: true,
        errorCode: 'registry-timeout',
      })
      expect(body).not.toHaveProperty('message')
    } finally {
      await close(server)
    }
  })

  it('ignores persisted results from another running version or channel', async () => {
    const incompatibleResult = {
      ...AVAILABLE_RESULT,
      channel: 'latest',
      runningVersion: '0.1.14',
      availableVersion: '0.1.15',
      updateAvailable: true,
    }
    const currentResult = {
      ...AVAILABLE_RESULT,
      state: 'current',
      runningVersion: '0.1.16',
      availableVersion: '0.1.16',
      availableRevision: 'current-sha',
      updateAvailable: false,
    }
    const checker = {
      enabled: true,
      channel: 'stable',
      runningVersion: '0.1.16',
      runningRevision: 'running-sha',
      now: Date.now,
      check: vi.fn(async () => currentResult),
    }
    const store = createStore({ lastUpdateCheck: incompatibleResult })
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const { body } = await requestJson(`${url}/api/update-status`)
      expect(checker.check).toHaveBeenCalledWith({ force: false, persistedResult: null })
      expect(body).toMatchObject({ state: 'current', updateAvailable: false, skipped: false })
    } finally {
      await close(server)
    }
  })

  it('rejects malformed persisted metadata before returning it to the UI', async () => {
    const malformedResult = {
      ...AVAILABLE_RESULT,
      checkedAt: 'not-a-date',
      availableRevision: null,
    }
    const currentResult = {
      ...AVAILABLE_RESULT,
      state: 'current',
      runningVersion: '0.1.15',
      availableVersion: '0.1.15',
      updateAvailable: false,
    }
    const checker = {
      enabled: true,
      channel: 'stable',
      runningVersion: '0.1.15',
      runningRevision: 'running-sha',
      now: Date.now,
      check: vi.fn(async () => currentResult),
    }
    const store = createStore({ lastUpdateCheck: malformedResult })
    const { server, url } = await listen(createApp({ checker, store }))

    try {
      const { body } = await requestJson(`${url}/api/update-status`)
      expect(checker.check).toHaveBeenCalledWith({ force: false, persistedResult: null })
      expect(body).toMatchObject({ state: 'current', availableRevision: 'published-sha' })
    } finally {
      await close(server)
    }
  })
})
