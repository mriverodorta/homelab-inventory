import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRoutingCache, saveRoutingCache } from '@/lib/routing-cache-api'
import type { CableRoutingCacheSnapshot } from '@/engine/routing'

const scope = { projectId: 4, workspaceId: 9 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('routing cache API', () => {
  it('loads the cache through an explicit project and workspace scope', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: 3, entries: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await loadRoutingCache(scope)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/routing-cache?projectId=4&workspaceId=9',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('saves the cache through the same immutable scope', async () => {
    const cache = { version: 3, entries: [] } as unknown as CableRoutingCacheSnapshot
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(cache), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await saveRoutingCache(scope, cache)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/routing-cache?projectId=4&workspaceId=9',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(cache) }),
    )
  })
})
