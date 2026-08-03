import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  searchOfficialCatalog,
  updateRegistrySettings,
} from '@/lib/registry-api'

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

export function useCatalogFacets(enabled = true) {
  return useQuery({
    queryKey: ['registry', 'catalog-facets'],
    queryFn: loadCatalogFacets,
    enabled,
    staleTime: 5 * 60_000,
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
