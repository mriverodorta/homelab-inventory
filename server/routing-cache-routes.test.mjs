import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HomelabInventoryStore } from './db/store.mjs'
import { registerRoutingCacheRoutes } from './routing-cache-routes.mjs'
import {
  ROUTING_CACHE_FORMAT_VERSION,
  ROUTING_PLANNER_VERSION,
} from '../shared/engine/routing-cache-contract.mjs'

const tempDirs = []
const stores = []
const servers = []

async function createContext() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'routing-cache-api-'))
  tempDirs.push(dataDir)
  const store = new HomelabInventoryStore({
    appVersion: '1.0.0', dataDir,
    legacyProjectPath: path.join(dataDir, 'legacy.json'), saveDebounceMs: 1,
    seedEmptyData: false, seedDir: path.join(dataDir, 'missing-seed'),
  })
  await store.init()
  stores.push(store)
  const app = express()
  app.use(express.json())
  const withStore = async (_request, response, handler, options = {}) => {
    try {
      await handler(store)
    } catch (error) {
      response.status(options.status ?? 500).json({
        message: error instanceof Error ? error.message : options.message,
      })
    }
  }
  registerRoutingCacheRoutes(app, { withStore })
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })
  servers.push(server)
  return { store, url: `http://127.0.0.1:${server.address().port}` }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

function cachePayload() {
  return {
    version: ROUTING_CACHE_FORMAT_VERSION,
    plannerVersion: ROUTING_PLANNER_VERSION,
    geometryFingerprint: 'geometry-1',
    obstacles: [],
    entries: [{
      input: {
        avoid_cable_overlap: false,
        request: {
          definition: {
            connection_id: 1,
            source: { x: 0, y: 0 }, target: { x: 100, y: 0 },
            source_side: 'right', target_side: 'left', lane_offset: 24, manual_bends: [],
          },
          source_candidates: [
            { point: { x: 0, y: 0 }, side: 'right' },
            { point: { x: 0, y: -12 }, side: 'right' },
            { point: { x: 0, y: 12 }, side: 'right' },
          ],
          target_candidates: [
            { point: { x: 100, y: 0 }, side: 'left' },
            { point: { x: 100, y: -12 }, side: 'left' },
            { point: { x: 100, y: 12 }, side: 'left' },
          ],
          source_side_constraint: 'right',
          target_side_constraint: 'left',
          previous_source_side: null,
          previous_target_side: null,
          source_item_id: 'server:1', target_item_id: 'switch:1', obstacles: [],
          reserved_segments: [], snap_to_grid: false, grid_size: 12,
          previous_valid_route: null,
        },
      },
      result: {
        route: {
          connection_id: 1,
          points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
          manual_anchor_point_indexes: [],
        },
        source_side: 'right',
        target_side: 'left',
        used_fallback: false,
        warning: null,
      },
    }],
    failures: [],
    updatedAt: null,
  }
}

describe('routing cache routes', () => {
  it('persists derived routes without changing project or inventory stores', async () => {
    const { store, url } = await createContext()
    const projectBefore = JSON.stringify(store.getProject())
    const response = await fetch(`${url}/api/routing-cache`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cachePayload()),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).geometryFingerprint).toBe('geometry-1')
    expect(JSON.stringify(store.getProject())).toBe(projectBefore)
  })

  it('rejects malformed route points', async () => {
    const { url } = await createContext()
    const payload = cachePayload()
    payload.entries[0].result.route.points[0].x = Number.NaN
    const response = await fetch(`${url}/api/routing-cache`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.status).toBe(400)
  })

  it('rejects a stale planner version without replacing the last valid cache', async () => {
    const { store, url } = await createContext()
    const valid = cachePayload()
    expect((await fetch(`${url}/api/routing-cache`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })).status).toBe(200)
    const stale = cachePayload()
    stale.plannerVersion -= 1

    const response = await fetch(`${url}/api/routing-cache`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stale),
    })

    expect(response.status).toBe(400)
    expect(store.getRoutingCache()).toMatchObject({
      plannerVersion: ROUTING_PLANNER_VERSION,
      geometryFingerprint: 'geometry-1',
    })
  })

  it('persists known failures without retrying them as incomplete cache entries', async () => {
    const { store, url } = await createContext()
    const payload = cachePayload()
    payload.entries = []
    payload.failures = [{
      connection_id: 1,
      message: 'No bounded orthogonal route was found.',
    }]

    const response = await fetch(`${url}/api/routing-cache`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.status).toBe(200)
    expect(store.getRoutingCache().failures).toEqual(payload.failures)
  })

  it.each([
    ['diagonal segments', (payload) => {
      payload.entries[0].result.route.points[1] = { x: 100, y: 20 }
    }],
    ['zero-length segments', (payload) => {
      payload.entries[0].result.route.points[1] = { x: 0, y: 0 }
    }],
    ['invalid endpoint sides', (payload) => {
      payload.entries[0].result.source_side = 'center'
    }],
    ['route endpoints outside current attachment candidates', (payload) => {
      payload.entries[0].result.route.points = [
        { x: 0, y: 24 },
        { x: 100, y: 24 },
        { x: 100, y: 0 },
      ]
    }],
    ['invalid manual anchor indexes', (payload) => {
      payload.entries[0].result.route.manual_anchor_point_indexes = [1]
    }],
  ])('rejects %s without replacing the last valid cache', async (_name, mutate) => {
    const { store, url } = await createContext()
    const valid = cachePayload()
    expect((await fetch(`${url}/api/routing-cache`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })).status).toBe(200)
    const invalid = cachePayload()
    mutate(invalid)

    const response = await fetch(`${url}/api/routing-cache`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalid),
    })

    expect(response.status).toBe(400)
    expect(store.getRoutingCache()).toMatchObject({
      geometryFingerprint: 'geometry-1',
      entries: [{ result: { route: { connection_id: 1 } } }],
    })
  })
})
