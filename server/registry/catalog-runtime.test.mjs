import { describe, expect, it, vi } from 'vitest'
import { CatalogRuntime } from './catalog-runtime.mjs'

describe('CatalogRuntime', () => {
  it('shares one snapshot service per persistence store', () => {
    const services = []
    const runtime = new CatalogRuntime({
      serviceFactory: (store) => {
        const service = { store, warm: vi.fn() }
        services.push(service)
        return service
      },
    })
    const firstStore = {}
    const secondStore = {}

    expect(runtime.forStore(firstStore)).toBe(runtime.forStore(firstStore))
    expect(runtime.forStore(secondStore)).not.toBe(runtime.forStore(firstStore))
    expect(services).toHaveLength(2)
  })

  it('warms the shared service for a store', async () => {
    const warm = vi.fn().mockResolvedValue({ available: true, categories: [] })
    const runtime = new CatalogRuntime({ serviceFactory: () => ({ warm }) })
    const store = {}

    await expect(runtime.warm(store)).resolves.toEqual({ available: true, categories: [] })
    expect(warm).toHaveBeenCalledOnce()
    expect(runtime.forStore(store).warm).toBe(warm)
  })
})
