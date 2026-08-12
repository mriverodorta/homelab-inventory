import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registryApi = vi.hoisted(() => ({
  loadCatalogFacets: vi.fn(),
}))

vi.mock('@/lib/registry-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/registry-api')>(),
  loadCatalogFacets: registryApi.loadCatalogFacets,
}))

import { catalogFacetQueryKey, prefetchCatalogFacets } from '@/hooks/use-registry'

describe('catalog facet prefetch', () => {
  beforeEach(() => {
    registryApi.loadCatalogFacets.mockReset()
    registryApi.loadCatalogFacets.mockResolvedValue({ available: true, categories: [] })
  })

  it('keys cached facets by signed catalog revision and digest', () => {
    expect(catalogFacetQueryKey({ revision: 4, digest: 'first' })).toEqual([
      'registry', 'catalog-facets', 4, 'first',
    ])
    expect(catalogFacetQueryKey({ revision: 4, digest: 'second' })).not.toEqual(
      catalogFacetQueryKey({ revision: 4, digest: 'first' }),
    )
  })

  it('reuses prefetched facets until the catalog identity changes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const first = { revision: 4, digest: 'first' }

    await prefetchCatalogFacets(queryClient, first)
    await prefetchCatalogFacets(queryClient, first)
    await prefetchCatalogFacets(queryClient, { revision: 5, digest: 'second' })

    expect(registryApi.loadCatalogFacets).toHaveBeenCalledTimes(2)
  })

  it('does not request facets before a verified snapshot exists', async () => {
    const queryClient = new QueryClient()

    await prefetchCatalogFacets(queryClient, null)

    expect(registryApi.loadCatalogFacets).not.toHaveBeenCalled()
  })
})
