import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveEventTopic } from '@/live-events/use-live-event-topic'
import * as api from '@/lib/inventory-metadata-api'
import { inventoryMetadataKeys } from '@/lib/inventory-metadata-keys'
import {
  applyInventoryMetadataItemChange,
  commitInventoryMetadataMutation,
  inventoryMetadataItemChangedPayloadSchema,
} from '@/lib/inventory-metadata-live'
import type {
  CustomFieldDefinitionInput,
  InventoryItemMetadataInput,
  InventoryMetadataItemRef,
  InventoryTagInput,
} from '@/types/inventory-metadata'

export { inventoryMetadataKeys } from '@/lib/inventory-metadata-keys'

function applyProjectMetadataEvent(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: number,
  event: Parameters<Parameters<typeof useLiveEventTopic>[0]['onEvent']>[0],
) {
  if (event.kind === 'inventory-metadata.item-changed') {
    const parsed = inventoryMetadataItemChangedPayloadSchema.safeParse(event.payload)
    if (!parsed.success || !parsed.data.projectIds.includes(projectId)) return
    const changedProjectIds = applyInventoryMetadataItemChange(queryClient, parsed.data)
    for (const changedProjectId of changedProjectIds) {
      void queryClient.invalidateQueries({
        queryKey: inventoryMetadataKeys.projectProjections(changedProjectId),
      })
    }
    return
  }
  void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectItems(projectId) })
  void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectProjections(projectId) })
}

function resyncProjectMetadata(queryClient: ReturnType<typeof useQueryClient>, projectId: number) {
  void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectItems(projectId) })
  void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectProjections(projectId) })
}

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
    onEvent: (event) => applyProjectMetadataEvent(queryClient, projectId, event),
    onResync: () => resyncProjectMetadata(queryClient, projectId),
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
    onEvent: (event) => applyProjectMetadataEvent(queryClient, projectId, event),
    onResync: () => resyncProjectMetadata(queryClient, projectId),
  })
  return query
}

export function useInventoryMetadataMutations(_projectId?: number) {
  const queryClient = useQueryClient()
  const refreshCatalog = () => queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.catalogs() })
  const refreshProjectProjections = (projectIds: readonly number[]) => Promise.all(projectIds.map((id) => (
    queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectProjections(id) })
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
        const affectedProjectIds = commitInventoryMetadataMutation(queryClient, variables.ref, result)
        await refreshProjectProjections(affectedProjectIds)
      },
    }),
  }
}
