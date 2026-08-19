import { describe, expect, it } from 'vitest'
import {
  inventoryMetadataCatalogPayload,
  inventoryMetadataItemPayload,
} from './inventory-metadata-payloads.mjs'

describe('inventory metadata live payloads', () => {
  it('deduplicates and bounds identifiers without carrying private values', () => {
    expect(inventoryMetadataCatalogPayload({ definitionIds: [3, 1, 3], tagIds: [2] })).toEqual({
      definitionIds: [1, 3],
      tagIds: [2],
    })
    expect(inventoryMetadataItemPayload({ itemId: 9, projectIds: [3, 1, 3] })).toEqual({
      itemId: 9,
      projectIds: [1, 3],
    })
    expect(() => inventoryMetadataCatalogPayload({ definitionIds: Array.from({ length: 257 }, (_, index) => index + 1) })).toThrow(/too many/iu)
    expect(() => inventoryMetadataItemPayload({ itemId: 1, projectIds: [0] })).toThrow(/positive/iu)
  })
})
