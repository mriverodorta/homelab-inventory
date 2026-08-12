import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  createPrivateTemplate,
  deletePrivateTemplate,
  duplicatePrivateTemplate,
  importPrivateTemplates,
  importOfficialCatalog,
  loadRegistryState,
  loadCatalogFacets,
  refreshOfficialCatalog,
  deliverRegistryContributions,
  revokeRegistryContributions,
  rotateRegistryContributionKey,
  resumeRegistryContributionRecovery,
  resetRegistryContributionRecovery,
  searchOfficialCatalog,
  updateRegistrySettings,
} from '@/lib/registry-api'
import type { RegistrySnapshot } from '@/types/registry'

export const REGISTRY_QUERY_KEY = ['registry'] as const

export function useRegistryQuery(enabled = true) {
  return useQuery({ queryKey: REGISTRY_QUERY_KEY, queryFn: loadRegistryState, enabled })
}

export function useRegistryMutations() {
  const queryClient = useQueryClient()
  const updateCache = (data: Awaited<ReturnType<typeof loadRegistryState>>) => {
    queryClient.setQueryData(REGISTRY_QUERY_KEY, data)
    return data
  }

  return {
    updateSettings: useMutation({
      mutationFn: (input: Parameters<typeof updateRegistrySettings>) => updateRegistrySettings(...input),
      onSuccess: updateCache,
      onError: () => queryClient.invalidateQueries({ queryKey: REGISTRY_QUERY_KEY }),
    }),
    createTemplate: useMutation({ mutationFn: createPrivateTemplate, onSuccess: updateCache }),
    duplicateTemplate: useMutation({ mutationFn: duplicatePrivateTemplate, onSuccess: updateCache }),
    deleteTemplate: useMutation({ mutationFn: deletePrivateTemplate, onSuccess: updateCache }),
    importTemplates: useMutation({
      mutationFn: importPrivateTemplates,
      onSuccess: (data) => updateCache(data.registry),
    }),
    importCatalog: useMutation({
      mutationFn: importOfficialCatalog,
      onSuccess: (data) => updateCache(data.registry),
    }),
    refreshCatalog: useMutation({
      mutationFn: refreshOfficialCatalog,
      onSuccess: (data) => updateCache(data.registry),
    }),
    deliverContributions: useMutation({
      mutationFn: deliverRegistryContributions,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: REGISTRY_QUERY_KEY }),
    }),
    revokeContributions: useMutation({
      mutationFn: revokeRegistryContributions,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: REGISTRY_QUERY_KEY }),
    }),
    rotateContributionKey: useMutation({
      mutationFn: rotateRegistryContributionKey,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: REGISTRY_QUERY_KEY }),
    }),
    resumeContributionRecovery: useMutation({
      mutationFn: resumeRegistryContributionRecovery,
      onSettled: () => queryClient.invalidateQueries({ queryKey: REGISTRY_QUERY_KEY }),
    }),
    resetContributionRecovery: useMutation({
      mutationFn: resetRegistryContributionRecovery,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: REGISTRY_QUERY_KEY }),
    }),
  }
}

export function useCatalogSearch(parameters: Parameters<typeof searchOfficialCatalog>[0], enabled = true) {
  return useQuery({
    queryKey: ['registry', 'catalog-search', parameters],
    queryFn: () => searchOfficialCatalog(parameters),
    enabled,
    staleTime: 30_000,
  })
}

export type CatalogSnapshotIdentity = Pick<RegistrySnapshot, 'revision' | 'digest'>

export function catalogFacetQueryKey(snapshot: CatalogSnapshotIdentity | null | undefined) {
  return ['registry', 'catalog-facets', snapshot?.revision ?? null, snapshot?.digest ?? null] as const
}

function catalogFacetQueryOptions(snapshot: CatalogSnapshotIdentity | null | undefined) {
  return {
    queryKey: catalogFacetQueryKey(snapshot),
    queryFn: loadCatalogFacets,
    staleTime: Number.POSITIVE_INFINITY,
  }
}

export function prefetchCatalogFacets(
  queryClient: QueryClient,
  snapshot: CatalogSnapshotIdentity | null | undefined,
) {
  if (!snapshot) return Promise.resolve()
  return queryClient.prefetchQuery(catalogFacetQueryOptions(snapshot))
}

export function useCatalogFacetPrefetch(
  snapshot: CatalogSnapshotIdentity | null | undefined,
  enabled = true,
) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || !snapshot) return
    const prefetch = () => { void prefetchCatalogFacets(queryClient, snapshot) }
    if (typeof globalThis.requestIdleCallback === 'function') {
      const handle = globalThis.requestIdleCallback(prefetch, { timeout: 2_000 })
      return () => globalThis.cancelIdleCallback(handle)
    }
    const handle = globalThis.setTimeout(prefetch, 0)
    return () => globalThis.clearTimeout(handle)
  }, [enabled, queryClient, snapshot])
}

export function useCatalogFacets(
  snapshot: CatalogSnapshotIdentity | null | undefined,
  enabled = true,
) {
  return useQuery({
    ...catalogFacetQueryOptions(snapshot),
    enabled: enabled && Boolean(snapshot),
  })
}

export function useInfiniteCatalogSearch(
  parameters: Omit<Parameters<typeof searchOfficialCatalog>[0], 'limit' | 'offset'>,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ['registry', 'catalog-search', parameters],
    queryFn: ({ pageParam }) => searchOfficialCatalog({ ...parameters, limit: 40, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled,
    staleTime: 30_000,
  })
}
