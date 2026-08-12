import { describe, expect, it } from 'bun:test'
import { CatalogRuntime } from './catalog-runtime.mjs'

describe('catalog runtime', () => {
  it('warms a valid generation before exposing catalog reads', async () => {
    const store = {}
    const runtime = new CatalogRuntime({
      serviceFactory: () => ({
        warm: async () => ({ available: true, categories: [] }),
        recover: async () => ({ available: true, categories: [] }),
        search: async () => ({ total: 1 }),
        facets: async () => ({ available: true }),
        template: async () => null,
        activate: async () => {},
        refreshConnected: async () => {},
      }),
    })
    await runtime.start(store)
    expect(runtime.state(store)).toMatchObject({ state: 'ready', available: true })
    await expect(runtime.forRequest(store).search()).resolves.toEqual({ total: 1 })
  })

  it('starts one background recovery and blocks only catalog reads while it runs', async () => {
    const store = {}
    let finishRecovery
    let recoveries = 0
    const recovery = new Promise((resolve) => { finishRecovery = resolve })
    const runtime = new CatalogRuntime({
      serviceFactory: () => ({
        warm: async () => { throw new Error('receipt mismatch') },
        recover: async () => {
          recoveries += 1
          return recovery
        },
        search: async () => ({ total: 1 }),
        facets: async () => ({ available: true }),
        template: async () => null,
        activate: async () => {},
        refreshConnected: async () => {},
      }),
    })

    await runtime.start(store)
    expect(runtime.state(store)).toMatchObject({ state: 'recovering', recovering: true })
    expect(() => runtime.forRequest(store).search()).toThrow(/being verified/)
    expect(recoveries).toBe(0)
    runtime.resumeRecovery(store)
    expect(runtime.recover(store)).toBe(runtime.recover(store))
    await Promise.resolve()
    expect(recoveries).toBe(1)
    finishRecovery({ available: true, categories: [] })
    await runtime.recover(store)
    expect(runtime.state(store)).toMatchObject({ state: 'ready' })
  })

  it('serializes catalog activation behind an in-flight recovery', async () => {
    const store = {}
    let finishRecovery
    let recovered = false
    let refreshes = 0
    const recovery = new Promise((resolve) => { finishRecovery = resolve })
    const runtime = new CatalogRuntime({
      serviceFactory: () => ({
        warm: async () => {
          if (!recovered) throw new Error('receipt mismatch')
          return { available: true, categories: [] }
        },
        recover: async () => {
          await recovery
          recovered = true
          return { available: true, categories: [] }
        },
        search: async () => ({ total: 0 }),
        facets: async () => ({ available: true }),
        template: async () => null,
        activate: async () => {},
        refreshConnected: async () => { refreshes += 1 },
      }),
    })

    await runtime.start(store)
    const refresh = runtime.forRequest(store).refreshConnected()
    await Promise.resolve()
    expect(refreshes).toBe(0)
    finishRecovery()
    await refresh
    expect(refreshes).toBe(1)
    expect(runtime.state(store)).toMatchObject({ state: 'ready' })
  })

  it('keeps an empty installation readable and sanitizes failed recovery state', async () => {
    const store = {}
    const runtime = new CatalogRuntime({
      serviceFactory: () => ({
        warm: async () => ({ available: false, categories: [] }),
        recover: async () => { throw new Error('/private/catalog.sqlite is corrupt') },
        search: async () => ({ total: 0 }),
        facets: async () => ({ available: false, categories: [] }),
        template: async () => null,
        activate: async () => {},
        refreshConnected: async () => {},
      }),
    })
    await runtime.start(store)
    expect(runtime.state(store)).toMatchObject({ state: 'unavailable', error: null })
    await expect(runtime.forRequest(store).facets()).resolves.toMatchObject({ available: false })
    await runtime.recover(store)
    expect(runtime.state(store)).toMatchObject({ state: 'unavailable', error: 'Catalog verification failed.' })
    expect(() => runtime.forRequest(store).search()).toThrow('Catalog is temporarily unavailable.')
  })
})
