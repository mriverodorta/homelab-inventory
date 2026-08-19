import { describe, expect, it } from 'vitest'
import {
  inventoryMetadataDraft,
  inventoryMetadataInput,
} from '@/components/inventory-metadata/inventory-metadata-draft'
import type { InventoryItemMetadata } from '@/types/inventory-metadata'

const timestamp = '2026-08-19T12:00:00.000Z'

function metadata(): InventoryItemMetadata {
  return {
    itemId: 1,
    revision: 1,
    definitions: [
      {
        id: 1, name: 'Lifecycle', description: null, fieldType: 'singleSelect', unit: null,
        numberMinimum: null, numberMaximum: null, numberPrecision: null, displayOrder: 0,
        revision: 1, archivedAt: null, createdAt: timestamp, updatedAt: timestamp,
        applicableItemTypes: ['server'],
        options: [{ id: 10, label: 'Production', colorToken: 'green', displayOrder: 0, revision: 1, archivedAt: null, createdAt: timestamp, updatedAt: timestamp }],
      },
      {
        id: 2, name: 'Services', description: null, fieldType: 'multiSelect', unit: null,
        numberMinimum: null, numberMaximum: null, numberPrecision: null, displayOrder: 1,
        revision: 1, archivedAt: null, createdAt: timestamp, updatedAt: timestamp,
        applicableItemTypes: ['server'],
        options: [{ id: 20, label: 'Storage', colorToken: 'blue', displayOrder: 0, revision: 1, archivedAt: null, createdAt: timestamp, updatedAt: timestamp }],
      },
    ],
    values: [
      { definitionId: 1, optionIds: [10], revision: 1 },
      { definitionId: 2, optionIds: [20], revision: 1 },
    ],
    tags: [],
  }
}

describe('inventory metadata draft', () => {
  it('keeps single-select IDs scalar and multi-select IDs plural across round trips', () => {
    const draft = inventoryMetadataDraft(metadata())

    expect(draft.values).toEqual({ 1: 10, 2: [20] })
    expect(inventoryMetadataInput(draft)).toEqual({
      values: [
        { definitionId: 1, value: 10 },
        { definitionId: 2, value: [20] },
      ],
      tagIds: [],
    })
  })
})
