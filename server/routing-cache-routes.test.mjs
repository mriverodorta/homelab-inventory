import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { registerRoutingCacheRoutes } from './routing-cache-routes.mjs'
import {
  ROUTING_CACHE_FORMAT_VERSION,
  ROUTING_PLANNER_VERSION,
} from '../shared/engine/routing-cache-contract.mjs'
import { validateRoutingCache } from './routing-cache-model.mjs'

const servers = []

async function createContext() {
  const workspaces = [
    { id: 1, type: 'systems', name: 'Systems' },
    { id: 2, type: 'canvas', name: 'Canvas' },
  ]
  const caches = new Map()
  const emptyCache = () => ({
    version: ROUTING_CACHE_FORMAT_VERSION,
    plannerVersion: ROUTING_PLANNER_VERSION,
    geometryFingerprint: null,
    entries: [],
    failures: [],
    updatedAt: null,
  })
  const scopedStore = (workspaceId) => ({
    getProject: () => ({ id: 'default', metadata: { projectId: 1, workspaceId } }),
    getRoutingCache: () => structuredClone(caches.get(workspaceId) ?? emptyCache()),
    setRoutingCache: (cache) => {
      caches.set(workspaceId, structuredClone(cache))
      return structuredClone(cache)
    },
  })
  const store = {
    getProject: () => scopedStore(2).getProject(),
    getRoutingCache: () => scopedStore(2).getRoutingCache(),
    getProjectWorkbook: (projectId) => {
      if (projectId !== 1) throw new Error('Project not found.')
      return { project: { id: 1 }, workspaces: [...workspaces] }
    },
    forWorkspace: (projectId, workspaceId) => {
      if (projectId !== 1 || !workspaces.some((workspace) => workspace.id === workspaceId && workspace.type === 'canvas')) {
        throw new Error('Canvas workspace not found.')
      }
      return scopedStore(workspaceId)
    },
    createWorkspace: (_projectId, input) => {
      const workspace = { id: Math.max(...workspaces.map(({ id }) => id)) + 1, ...input }
      workspaces.push(workspace)
      return { project: { id: 1 }, workspaces: [...workspaces] }
    },
  }
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
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  servers.push(server)
  return { store, url: `http://127.0.0.1:${server.address().port}` }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

function cachePayload() {
  return {
    version: ROUTING_CACHE_FORMAT_VERSION,
    plannerVersion: ROUTING_PLANNER_VERSION,
    geometryFingerprint: '1111111111111111',
    entries: [{
      connectionId: 1,
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

function scopedUrl(url, workspaceId = 2, projectId = 1) {
  return `${url}/api/routing-cache?projectId=${projectId}&workspaceId=${workspaceId}`
}

describe('routing cache routes', () => {
  it('persists derived routes without changing project or inventory stores', async () => {
    const { store, url } = await createContext()
    const projectBefore = JSON.stringify(store.getProject())
    const response = await fetch(scopedUrl(url), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cachePayload()),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).geometryFingerprint).toBe('1111111111111111')
    expect(JSON.stringify(store.getProject())).toBe(projectBefore)
  })

  it('rejects malformed route points', async () => {
    const { url } = await createContext()
    const payload = cachePayload()
    payload.entries[0].result.route.points[0].x = 'not-a-number'
    const response = await fetch(scopedUrl(url), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.status).toBe(400)
  })

  it('rejects a stale planner version without replacing the last valid cache', async () => {
    const { store, url } = await createContext()
    const valid = cachePayload()
    expect((await fetch(scopedUrl(url), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })).status).toBe(200)
    const stale = cachePayload()
    stale.plannerVersion -= 1

    const response = await fetch(scopedUrl(url), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stale),
    })

    expect(response.status).toBe(400)
    expect(store.getRoutingCache()).toMatchObject({
      plannerVersion: ROUTING_PLANNER_VERSION,
      geometryFingerprint: '1111111111111111',
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

    const response = await fetch(scopedUrl(url), {
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
    ['invalid manual anchor indexes', (payload) => {
      payload.entries[0].result.route.manual_anchor_point_indexes = [1]
    }],
  ])('rejects %s without replacing the last valid cache', async (_name, mutate) => {
    const { store, url } = await createContext()
    const valid = cachePayload()
    expect((await fetch(scopedUrl(url), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })).status).toBe(200)
    const invalid = cachePayload()
    mutate(invalid)

    const response = await fetch(scopedUrl(url), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalid),
    })

    expect(response.status).toBe(400)
    expect(store.getRoutingCache()).toMatchObject({
      geometryFingerprint: '1111111111111111',
      entries: [{ result: { route: { connection_id: 1 } } }],
    })
  })

  it.each([
    ['/api/routing-cache', 400],
    ['/api/routing-cache?projectId=1', 400],
    ['/api/routing-cache?projectId=no&workspaceId=2', 400],
    ['/api/routing-cache?projectId=1&workspaceId=9999', 404],
    ['/api/routing-cache?projectId=1&workspaceId=1', 400],
  ])('rejects invalid or unavailable workspace scope %s', async (path, status) => {
    const { url } = await createContext()
    const response = await fetch(`${url}${path}`)

    expect(response.status).toBe(status)
  })

  it('keeps routing-cache replacement isolated between Canvas workspaces', async () => {
    const { store, url } = await createContext()
    const workbook = store.createWorkspace(1, {
      type: 'canvas',
      name: 'Secondary',
      iconKey: 'network',
      colorKey: 'green',
    })
    const secondary = workbook.workspaces.find((workspace) => workspace.name === 'Secondary')
    expect(secondary).toBeDefined()
    const primary = cachePayload()
    const alternate = { ...cachePayload(), geometryFingerprint: '2222222222222222' }

    expect((await fetch(scopedUrl(url), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(primary),
    })).status).toBe(200)
    expect((await fetch(scopedUrl(url, secondary.id), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alternate),
    })).status).toBe(200)

    expect(store.forWorkspace(1, 2).getRoutingCache().geometryFingerprint).toBe('1111111111111111')
    expect(store.forWorkspace(1, secondary.id).getRoutingCache().geometryFingerprint).toBe('2222222222222222')
  })

  it('rejects duplicate, mismatched, and legacy route entries', async () => {
    const { url } = await createContext()
    const cases = [
      (() => {
        const payload = cachePayload()
        payload.entries.push(structuredClone(payload.entries[0]))
        return payload
      })(),
      (() => {
        const payload = cachePayload()
        payload.entries[0].connectionId = 2
        return payload
      })(),
      (() => {
        const payload = cachePayload()
        payload.entries[0].input = { request: {} }
        return payload
      })(),
      { ...cachePayload(), obstacles: [] },
    ]

    for (const payload of cases) {
      const response = await fetch(scopedUrl(url), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      expect(response.status).toBe(400)
    }
  })

  it('normalizes compact entries and failures deterministically', async () => {
    const { url } = await createContext()
    const payload = cachePayload()
    const second = structuredClone(payload.entries[0])
    second.connectionId = 2
    second.result.route.connection_id = 2
    payload.entries = [second, payload.entries[0]]
    payload.failures = [{ connection_id: 4, message: 'four' }, { connection_id: 3, message: 'three' }]

    const response = await fetch(scopedUrl(url), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.entries.map((entry) => entry.connectionId)).toEqual([1, 2])
    expect(result.failures.map((failure) => failure.connection_id)).toEqual([3, 4])
    expect(JSON.stringify(result)).not.toContain('obstacles')
    expect(JSON.stringify(result)).not.toContain('"input"')
  })

  it('keeps a representative 72-route cache below the payload budget', () => {
    const payload = cachePayload()
    payload.entries = Array.from({ length: 72 }, (_, index) => {
      const connectionId = index + 1
      const y = index * 12
      const entry = structuredClone(payload.entries[0])
      entry.connectionId = connectionId
      entry.result.route.connection_id = connectionId
      entry.result.route.points = [{ x: 0, y }, { x: 240, y }]
      return entry
    })

    const normalized = validateRoutingCache(payload)
    const serialized = JSON.stringify(normalized)

    expect(Buffer.byteLength(serialized)).toBeLessThan(25_000)
    expect(serialized).not.toContain('"obstacles"')
    expect(serialized).not.toContain('"input"')
    expect(validateRoutingCache(JSON.parse(serialized))).toEqual(normalized)
  })
})
