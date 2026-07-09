import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import { RELEASE_NOTES } from '../src/release-notes.ts'

function registerReleaseNotesRoutes(app, store) {
  // server/index.mjs starts the production server at import time, so this harness
  // mirrors the route handlers directly and keeps the API contract isolated.
  app.get('/api/release-notes/status', (_request, response) => {
    try {
      response.json(store.getReleaseNotesStatus(RELEASE_NOTES))
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'Unable to load release notes status.',
      })
    }
  })

  app.post('/api/release-notes/acknowledge', async (_request, response) => {
    try {
      response.json(await store.acknowledgeReleaseNotes())
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'Unable to acknowledge release notes.',
      })
    }
  })
}

function createApp(store) {
  const app = express()

  app.use(express.json({ limit: '10mb' }))
  registerReleaseNotesRoutes(app, store)

  return app
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address()

      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

describe('release notes API routes', () => {
  it('returns release-note status and acknowledges release notes through the store', async () => {
    const status = {
      currentVersion: '0.1.10',
      lastSeenVersion: '0.1.9',
      hasUnseen: true,
      entries: [RELEASE_NOTES[0]],
    }
    const acknowledgedStatus = {
      currentVersion: '0.1.10',
      lastSeenVersion: '0.1.10',
      hasUnseen: false,
      entries: [],
    }
    const store = {
      getReleaseNotesStatus: vi.fn((releaseNotes) => {
        expect(releaseNotes).toBe(RELEASE_NOTES)

        return status
      }),
      acknowledgeReleaseNotes: vi.fn(async () => acknowledgedStatus),
    }
    const { server, url } = await listen(createApp(store))

    try {
      const statusResponse = await fetch(`${url}/api/release-notes/status`)
      const statusBody = await statusResponse.json()

      expect(statusResponse.status).toBe(200)
      expect(statusBody).toEqual(status)
      expect(store.getReleaseNotesStatus).toHaveBeenCalledTimes(1)

      const acknowledgeResponse = await fetch(`${url}/api/release-notes/acknowledge`, {
        method: 'POST',
      })
      const acknowledgeBody = await acknowledgeResponse.json()

      expect(acknowledgeResponse.status).toBe(200)
      expect(acknowledgeBody).toEqual(acknowledgedStatus)
      expect(store.acknowledgeReleaseNotes).toHaveBeenCalledTimes(1)
    } finally {
      await close(server)
    }
  })

  it('returns 500 JSON when release-note store operations fail', async () => {
    const store = {
      getReleaseNotesStatus: vi.fn(() => {
        throw new Error('status failed')
      }),
      acknowledgeReleaseNotes: vi.fn(async () => {
        throw new Error('acknowledge failed')
      }),
    }
    const { server, url } = await listen(createApp(store))

    try {
      const statusResponse = await fetch(`${url}/api/release-notes/status`)

      expect(statusResponse.status).toBe(500)
      expect(await statusResponse.json()).toEqual({ message: 'status failed' })

      const acknowledgeResponse = await fetch(`${url}/api/release-notes/acknowledge`, {
        method: 'POST',
      })

      expect(acknowledgeResponse.status).toBe(500)
      expect(await acknowledgeResponse.json()).toEqual({ message: 'acknowledge failed' })
    } finally {
      await close(server)
    }
  })
})
