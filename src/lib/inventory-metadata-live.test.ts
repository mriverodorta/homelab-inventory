import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  applyInventoryMetadataItemChange,
  commitInventoryMetadataMutation,
  inventoryMetadataItemChangedPayloadSchema,
} from '@/lib/inventory-metadata-live'
import { inventoryMetadataKeys } from '@/lib/inventory-metadata-keys'
import type {
  InventoryItemMetadata,
  InventoryMetadataItemMutationResult,
} from '@/types/inventory-metadata'

const ref = { type: 'server', id: 7 } as const

function metadata(revision: number): InventoryItemMetadata {
  return {
    itemId: 91,
    revision,
    definitions: [],
    values: [],
    tags: [],
  }
}

function mutationResult(revision: number): InventoryMetadataItemMutationResult {
  return {
    metadata: metadata(revision),
    affectedProjectIds: [1, 3],
    affectedMetadataRevisions: { 91: revision },
  }
}

describe('inventory metadata live cache convergence', () => {
  it('commits mutation metadata to every affected project before marking its revision', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(inventoryMetadataKeys.item(1, ref), metadata(1))

    expect(commitInventoryMetadataMutation(queryClient, ref, mutationResult(2))).toEqual([1, 3])
    expect(queryClient.getQueryData(inventoryMetadataKeys.item(1, ref))).toEqual(metadata(2))
    expect(queryClient.getQueryData(inventoryMetadataKeys.item(3, ref))).toEqual(metadata(2))
    expect(queryClient.getQueryData(inventoryMetadataKeys.itemRevision(1, 91))).toBe(2)
    expect(queryClient.getQueryData(inventoryMetadataKeys.itemRevision(3, 91))).toBe(2)
  })

  it('deduplicates the matching SSE event after a mutation response', () => {
    const queryClient = new QueryClient()
    commitInventoryMetadataMutation(queryClient, ref, mutationResult(2))

    expect(applyInventoryMetadataItemChange(queryClient, {
      itemId: 91,
      projectIds: [1, 3],
      metadata: metadata(2),
    })).toEqual([])
  })

  it('lets an SSE event win the race and rejects a later stale mutation response', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(inventoryMetadataKeys.item(1, ref), metadata(1))

    expect(applyInventoryMetadataItemChange(queryClient, {
      itemId: 91,
      projectIds: [1],
      metadata: metadata(3),
    })).toEqual([1])
    expect(commitInventoryMetadataMutation(queryClient, ref, {
      ...mutationResult(2),
      affectedProjectIds: [1],
    })).toEqual([])
    expect(queryClient.getQueryData(inventoryMetadataKeys.item(1, ref))).toEqual(metadata(3))
  })

  it('updates matching cached items once without replacing unrelated item caches', () => {
    const queryClient = new QueryClient()
    const unrelatedRef = { type: 'server', id: 8 } as const
    const unrelated = { ...metadata(1), itemId: 92 }
    queryClient.setQueryData(inventoryMetadataKeys.item(1, ref), metadata(1))
    queryClient.setQueryData(inventoryMetadataKeys.item(1, unrelatedRef), unrelated)

    expect(applyInventoryMetadataItemChange(queryClient, {
      itemId: 91,
      projectIds: [1],
      metadata: metadata(2),
    })).toEqual([1])
    expect(queryClient.getQueryData(inventoryMetadataKeys.item(1, ref))).toEqual(metadata(2))
    expect(queryClient.getQueryData(inventoryMetadataKeys.item(1, unrelatedRef))).toEqual(unrelated)
    expect(applyInventoryMetadataItemChange(queryClient, {
      itemId: 91,
      projectIds: [1],
      metadata: metadata(2),
    })).toEqual([])
  })

  it('strictly parses data-bearing events and rejects mismatched identities', () => {
    expect(inventoryMetadataItemChangedPayloadSchema.parse({
      itemId: 91,
      projectIds: [1],
      metadata: metadata(2),
    })).toEqual({
      itemId: 91,
      projectIds: [1],
      metadata: metadata(2),
    })
    expect(() => inventoryMetadataItemChangedPayloadSchema.parse({
      itemId: 92,
      projectIds: [1],
      metadata: metadata(2),
    })).toThrow(/match/iu)
    expect(() => inventoryMetadataItemChangedPayloadSchema.parse({
      itemId: 91,
      projectIds: [1],
      metadata: metadata(2),
      privateValue: true,
    })).toThrow()
  })
})

