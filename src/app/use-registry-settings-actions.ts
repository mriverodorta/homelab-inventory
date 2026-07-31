import type { QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { useRegistryMutations } from '@/hooks/use-registry'
import { exportPrivateTemplates } from '@/lib/registry-api'

interface RegistrySettingsActionsOptions {
  queryClient: QueryClient
  mutations: ReturnType<typeof useRegistryMutations>
  applyCatalogUpdate(linkId: number): Promise<void>
}

export function useRegistrySettingsActions({
  queryClient,
  mutations,
  applyCatalogUpdate,
}: RegistrySettingsActionsOptions) {
  return useMemo(() => ({
    updateSettings: (
      settings: Parameters<typeof mutations.updateSettings.mutateAsync>[0][0],
      expectedUpdatedAt: Parameters<typeof mutations.updateSettings.mutateAsync>[0][1],
    ) =>
      mutations.updateSettings.mutateAsync([settings, expectedUpdatedAt]).then(() => undefined),
    deletePrivateTemplate: (id: number) =>
      mutations.deleteTemplate.mutateAsync(id).then(() => undefined),
    exportPrivateTemplates,
    importPrivateTemplates: async (pack: Parameters<typeof mutations.importTemplates.mutateAsync>[0]) => {
      const result = await mutations.importTemplates.mutateAsync(pack)
      return { imported: result.imported, skipped: result.skipped }
    },
    importOfficialCatalog: async (artifact: Parameters<typeof mutations.importCatalog.mutateAsync>[0]) => {
      await mutations.importCatalog.mutateAsync(artifact)
    },
    refreshOfficialCatalog: async () => {
      await mutations.refreshCatalog.mutateAsync()
    },
    applyCatalogUpdate: async (linkId: number) => {
      await applyCatalogUpdate(linkId)
      await queryClient.invalidateQueries({ queryKey: ['registry'] })
    },
    deliverContributions: async () => {
      await mutations.deliverContributions.mutateAsync()
    },
    revokeContributions: async () => {
      await mutations.revokeContributions.mutateAsync()
    },
    rotateContributionKey: async () => {
      await mutations.rotateContributionKey.mutateAsync()
    },
  }), [applyCatalogUpdate, mutations, queryClient])
}
