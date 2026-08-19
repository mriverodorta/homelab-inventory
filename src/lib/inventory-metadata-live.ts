import type { QueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { inventoryMetadataKeys } from '@/lib/inventory-metadata-keys'
import {
  inventoryItemMetadataSchema,
  type InventoryItemMetadata,
  type InventoryMetadataItemMutationResult,
  type InventoryMetadataItemRef,
} from '@/types/inventory-metadata'

const positiveId = z.number().int().safe().positive()

export const inventoryMetadataItemChangedPayloadSchema = z.strictObject({
  itemId: positiveId,
  projectIds: z.array(positiveId).max(128),
  metadata: inventoryItemMetadataSchema,
}).superRefine((value, context) => {
  if (value.itemId !== value.metadata.itemId) {
    context.addIssue({
      code: 'custom',
      message: 'Event and metadata item IDs must match.',
      path: ['metadata', 'itemId'],
    })
  }
})

export type InventoryMetadataItemChangedPayload = z.infer<typeof inventoryMetadataItemChangedPayloadSchema>

function cachedItemRevision(queryClient: QueryClient, projectId: number, itemId: number) {
  const marker = queryClient.getQueryData<number>(inventoryMetadataKeys.itemRevision(projectId, itemId)) ?? 0
  return queryClient.getQueriesData<InventoryItemMetadata>({
    queryKey: inventoryMetadataKeys.projectItems(projectId),
  }).reduce((latest, [, metadata]) => (
    metadata?.itemId === itemId ? Math.max(latest, metadata.revision) : latest
  ), marker)
}

function markItemRevision(queryClient: QueryClient, projectId: number, itemId: number, revision: number) {
  queryClient.setQueryData(inventoryMetadataKeys.itemRevision(projectId, itemId), revision)
}

export function applyInventoryMetadataItemChange(
  queryClient: QueryClient,
  payload: InventoryMetadataItemChangedPayload,
): readonly number[] {
  const changedProjectIds: number[] = []
  for (const projectId of payload.projectIds) {
    if (cachedItemRevision(queryClient, projectId, payload.itemId) >= payload.metadata.revision) continue
    queryClient.setQueriesData<InventoryItemMetadata>(
      { queryKey: inventoryMetadataKeys.projectItems(projectId) },
      (current) => current?.itemId === payload.itemId ? payload.metadata : current,
    )
    markItemRevision(queryClient, projectId, payload.itemId, payload.metadata.revision)
    changedProjectIds.push(projectId)
  }
  return changedProjectIds
}

export function commitInventoryMetadataMutation(
  queryClient: QueryClient,
  ref: InventoryMetadataItemRef,
  result: InventoryMetadataItemMutationResult,
): readonly number[] {
  const changedProjectIds: number[] = []
  for (const projectId of result.affectedProjectIds) {
    const latestRevision = cachedItemRevision(queryClient, projectId, result.metadata.itemId)
    if (latestRevision > result.metadata.revision) continue
    queryClient.setQueryData(inventoryMetadataKeys.item(projectId, ref), result.metadata)
    if (latestRevision >= result.metadata.revision) continue
    markItemRevision(queryClient, projectId, result.metadata.itemId, result.metadata.revision)
    changedProjectIds.push(projectId)
  }
  return changedProjectIds
}

