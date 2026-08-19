import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'
import * as api from '@/lib/inventory-metadata-api'
import type {
  CustomFieldDefinitionInput,
  InventoryItemMetadataInput,
  InventoryMetadataItemRef,
  InventoryTagInput,
} from '@/types/inventory-metadata'

export const inventoryMetadataKeys = Object.freeze({
  root: ['inventory-metadata'] as const,
  catalogs: () => [...inventoryMetadataKeys.root, 'catalog'] as const,
  catalog: (includeArchived = false) => [...inventoryMetadataKeys.catalogs(), { includeArchived }] as const,
  project: (projectId: number) => [...inventoryMetadataKeys.root, 'project', projectId] as const,
  projectItems: (projectId: number) => [...inventoryMetadataKeys.root, 'project', projectId, 'items'] as const,
  projectProjections: (projectId: number) => [...inventoryMetadataKeys.root, 'project', projectId, 'projections'] as const,
  projectProjection: (projectId: number, query: api.InventoryMetadataProjectQuery) => (
    [...inventoryMetadataKeys.projectProjections(projectId), query] as const
  ),
  item: (projectId: number, ref: InventoryMetadataItemRef) => (
    [...inventoryMetadataKeys.projectItems(projectId), ref.type, ref.id] as const
  ),
})

export function useInventoryMetadataProjectProjection(
  projectId: number,
  query: api.InventoryMetadataProjectQuery,
  enabled = true,
) {
  const queryClient = useQueryClient()
  const projection = useQuery({
    queryKey: inventoryMetadataKeys.projectProjection(projectId, query),
    queryFn: () => api.loadInventoryMetadataProjectProjection(projectId, query),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
  useLiveEventTopic({
    topic: `inventory-metadata:${projectId}`,
    enabled,
    onEvent: () => void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectProjections(projectId) }),
    onResync: () => void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectProjections(projectId) }),
  })
  return projection
}

export function useInventoryMetadataCatalog({ enabled = true, includeArchived = false } = {}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: inventoryMetadataKeys.catalog(includeArchived),
    queryFn: () => api.loadInventoryMetadataCatalog(includeArchived),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
  useLiveEventTopic({
    topic: 'inventory-metadata:catalog',
    enabled,
    onEvent: () => void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.catalogs() }),
    onResync: () => void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.catalogs() }),
  })
  return query
}

export function useInventoryItemMetadata(
  projectId: number,
  ref: InventoryMetadataItemRef | null,
  enabled = true,
) {
  const queryClient = useQueryClient()
  const projectKey = inventoryMetadataKeys.projectItems(projectId)
  const query = useQuery({
    queryKey: ref ? inventoryMetadataKeys.item(projectId, ref) : [...projectKey, 'none'],
    queryFn: () => {
      if (!ref) throw new Error('Inventory metadata requires an inventory item.')
      return api.loadInventoryItemMetadata(ref)
    },
    enabled: enabled && ref !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  useLiveEventTopic({
    topic: `inventory-metadata:${projectId}`,
    enabled,
    onEvent: () => void queryClient.invalidateQueries({ queryKey: projectKey }),
    onResync: () => void queryClient.invalidateQueries({ queryKey: projectKey }),
  })
  return query
}

export function useInventoryMetadataMutations(projectId?: number) {
  const queryClient = useQueryClient()
  const refreshCatalog = () => queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.catalogs() })
  const refreshProjects = (projectIds: readonly number[]) => Promise.all(projectIds.map((id) => (
    queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectItems(id) })
  )))

  return {
    createField: useMutation({ mutationFn: api.createCustomField, onSuccess: refreshCatalog }),
    updateField: useMutation({
      mutationFn: ({ id, expectedRevision, input }: {
        id: number
        expectedRevision: number
        input: CustomFieldDefinitionInput & { deleteValuesForRemovedTypes?: boolean }
      }) => api.updateCustomField(id, expectedRevision, input),
      onSuccess: refreshCatalog,
    }),
    archiveField: useMutation({
      mutationFn: ({ id, expectedRevision, archived }: { id: number; expectedRevision: number; archived: boolean }) => (
        api.setCustomFieldArchived(id, expectedRevision, archived)
      ),
      onSuccess: refreshCatalog,
    }),
    deleteField: useMutation({
      mutationFn: ({ id, confirmationName }: { id: number; confirmationName: string }) => (
        api.deleteCustomField(id, confirmationName)
      ),
      onSuccess: refreshCatalog,
    }),
    reorderFields: useMutation({ mutationFn: api.reorderCustomFields, onSuccess: refreshCatalog }),
    createTag: useMutation({ mutationFn: api.createInventoryTag, onSuccess: refreshCatalog }),
    updateTag: useMutation({
      mutationFn: ({ id, expectedRevision, input }: { id: number; expectedRevision: number; input: InventoryTagInput }) => (
        api.updateInventoryTag(id, expectedRevision, input)
      ),
      onSuccess: refreshCatalog,
    }),
    archiveTag: useMutation({
      mutationFn: ({ id, expectedRevision, archived }: { id: number; expectedRevision: number; archived: boolean }) => (
        api.setInventoryTagArchived(id, expectedRevision, archived)
      ),
      onSuccess: refreshCatalog,
    }),
    deleteTag: useMutation({
      mutationFn: ({ id, confirmationName }: { id: number; confirmationName: string }) => (
        api.deleteInventoryTag(id, confirmationName)
      ),
      onSuccess: refreshCatalog,
    }),
    reorderTags: useMutation({ mutationFn: api.reorderInventoryTags, onSuccess: refreshCatalog }),
    updateItem: useMutation({
      mutationFn: ({ ref, input, expectedRevision }: {
        ref: InventoryMetadataItemRef
        input: InventoryItemMetadataInput
        expectedRevision: number
      }) => (
        api.updateInventoryItemMetadata(ref, input, expectedRevision)
      ),
      onSuccess: async (result, variables) => {
        await refreshProjects(result.affectedProjectIds)
        if (projectId !== undefined) {
          queryClient.setQueryData(inventoryMetadataKeys.item(projectId, variables.ref), result.metadata)
        }
      },
    }),
  }
}
