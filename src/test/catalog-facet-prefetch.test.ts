import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registryApi = vi.hoisted(() => ({
  loadCatalogFacets: vi.fn(),
}))

vi.mock('@/lib/registry-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/registry-api')>(),
  loadCatalogFacets: registryApi.loadCatalogFacets,
}))

import {
  catalogFacetPrefetchEnabled,
  catalogFacetQueryKey,
  prefetchCatalogFacets,
} from '@/hooks/use-registry'

describe('catalog facet prefetch', () => {
  beforeEach(() => {
    registryApi.loadCatalogFacets.mockReset()
    registryApi.loadCatalogFacets.mockResolvedValue({ available: true, categories: [] })
  })

  it('keys cached facets by signed catalog revision and digest', () => {
    const firstDigest = '1'.repeat(64)
    const secondDigest = '2'.repeat(64)
    expect(catalogFacetQueryKey({ revision: 4, digest: firstDigest })).toEqual([
      'registry', 'catalog-facets', 4, firstDigest,
    ])
    expect(catalogFacetQueryKey({ revision: 4, digest: secondDigest })).not.toEqual(
      catalogFacetQueryKey({ revision: 4, digest: firstDigest }),
    )
  })

  it('reuses prefetched facets until the catalog identity changes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const first = { revision: 4, digest: '1'.repeat(64) }

    await prefetchCatalogFacets(queryClient, first)
    await prefetchCatalogFacets(queryClient, first)
    await prefetchCatalogFacets(queryClient, { revision: 5, digest: '2'.repeat(64) })

    expect(registryApi.loadCatalogFacets).toHaveBeenCalledTimes(2)
    expect(registryApi.loadCatalogFacets).toHaveBeenNthCalledWith(1, first)
    expect(registryApi.loadCatalogFacets).toHaveBeenNthCalledWith(2, {
      revision: 5,
      digest: '2'.repeat(64),
    })
  })

  it('does not request facets before a verified snapshot exists', async () => {
    const queryClient = new QueryClient()

    await prefetchCatalogFacets(queryClient, null)

    expect(registryApi.loadCatalogFacets).not.toHaveBeenCalled()
  })

  it('allows idle prefetch only on a loaded Canvas with Registry access', () => {
    expect(catalogFacetPrefetchEnabled({
      canViewRegistry: true,
      canvasWorkspaceActive: true,
      projectLoaded: true,
    })).toBe(true)
    expect(catalogFacetPrefetchEnabled({
      canViewRegistry: true,
      canvasWorkspaceActive: false,
      projectLoaded: true,
    })).toBe(false)
    expect(catalogFacetPrefetchEnabled({
      canViewRegistry: true,
      canvasWorkspaceActive: true,
      projectLoaded: false,
    })).toBe(false)
  })
})
