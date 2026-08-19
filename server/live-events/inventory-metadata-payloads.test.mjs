import { describe, expect, it } from 'vitest'
import {
  inventoryMetadataCatalogPayload,
  inventoryMetadataHistoryPayload,
  inventoryMetadataItemPayload,
} from './inventory-metadata-payloads.mjs'

describe('inventory metadata live payloads', () => {
  it('deduplicates and bounds identifiers without carrying private values', () => {
    const metadata = {
      itemId: 9,
      revision: 2,
      definitions: [],
      values: [],
      tags: [],
    }
    expect(inventoryMetadataCatalogPayload({ definitionIds: [3, 1, 3], tagIds: [2] })).toEqual({
      definitionIds: [1, 3],
      tagIds: [2],
    })
    expect(inventoryMetadataItemPayload({ itemId: 9, projectIds: [3, 1, 3], metadata })).toEqual({
      itemId: 9,
      projectIds: [1, 3],
      metadata,
    })
    expect(inventoryMetadataHistoryPayload({ itemIds: [9, 4, 9], projectIds: [3, 1] })).toEqual({
      itemIds: [4, 9],
      projectIds: [1, 3],
    })
    expect(() => inventoryMetadataCatalogPayload({ definitionIds: Array.from({ length: 257 }, (_, index) => index + 1) })).toThrow(/too many/iu)
    expect(() => inventoryMetadataItemPayload({ itemId: 1, projectIds: [0], metadata: { ...metadata, itemId: 1 } })).toThrow(/positive/iu)
    expect(() => inventoryMetadataItemPayload({ itemId: 9, projectIds: [1], metadata: { ...metadata, itemId: 10 } })).toThrow(/match/iu)
    expect(() => inventoryMetadataItemPayload({ itemId: 9, projectIds: [1], metadata: { ...metadata, revision: 0 } })).toThrow(/revision/iu)
  })
})
