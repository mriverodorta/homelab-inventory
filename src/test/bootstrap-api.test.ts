import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activateInitialBootstrap,
  consumeInitialBootstrap,
  resetInitialBootstrap,
} from '@/lib/bootstrap-api'
import {
  INITIAL_APPLICATION_REQUEST_BUDGET,
  INITIAL_APPLICATION_REQUEST_COUNT,
} from '@/lib/bootstrap-contract'

afterEach(() => {
  resetInitialBootstrap()
  vi.unstubAllGlobals()
})

describe('initial application bootstrap', () => {
  it('shares one request across concurrent initial consumers', async () => {
    const payload = {
      project: { id: 1, revision: 7 },
      registry: { settings: { mode: 'connected' } },
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    activateInitialBootstrap()

    const [project, registry] = await Promise.all([
      consumeInitialBootstrap('project', vi.fn()),
      consumeInitialBootstrap('registry', vi.fn()),
    ])

    expect(project).toEqual(payload.project)
    expect(registry).toEqual(payload.registry)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/bootstrap', expect.any(Object))
    expect(INITIAL_APPLICATION_REQUEST_COUNT).toBe(2)
    expect(INITIAL_APPLICATION_REQUEST_COUNT).toBeLessThanOrEqual(INITIAL_APPLICATION_REQUEST_BUDGET)
  })

  it('uses dedicated endpoints after a bootstrap section has been consumed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      project: { id: 1, revision: 7 },
    }), { status: 200 })))
    activateInitialBootstrap()
    await consumeInitialBootstrap('project', vi.fn())
    const fallback = vi.fn().mockResolvedValue({ id: 1, revision: 8 })

    await expect(consumeInitialBootstrap('project', fallback)).resolves.toEqual({ id: 1, revision: 8 })
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('falls back cleanly when the aggregate request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Bootstrap unavailable.' }),
      { status: 503 },
    )))
    activateInitialBootstrap()
    const project = { id: 1, revision: 9 }
    const fallback = vi.fn().mockResolvedValue(project)

    await expect(consumeInitialBootstrap('project', fallback)).resolves.toBe(project)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('keeps ordinary API loads independent outside startup', async () => {
    const fallback = vi.fn().mockResolvedValue({ id: 1, revision: 10 })

    await consumeInitialBootstrap('project', fallback)

    expect(fallback).toHaveBeenCalledOnce()
  })
})
