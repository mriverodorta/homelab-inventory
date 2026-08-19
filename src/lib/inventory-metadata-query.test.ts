import { describe, expect, it } from 'vitest'
import {
  customFieldDefinitionSchema,
  inventoryItemMetadataSchema,
  inventoryMetadataCatalogSchema,
} from '@/types/inventory-metadata'
import { inventoryMetadataKeys } from '@/lib/inventory-metadata-keys'

const timestamps = {
  archivedAt: null,
  createdAt: '2026-08-19T12:00:00.000Z',
  updatedAt: '2026-08-19T12:00:00.000Z',
}

const definition = {
  id: 1,
  name: 'Lifecycle',
  description: null,
  fieldType: 'singleSelect',
  unit: null,
  numberMinimum: null,
  numberMaximum: null,
  numberPrecision: null,
  displayOrder: 0,
  revision: 1,
  ...timestamps,
  applicableItemTypes: ['server'],
  options: [{
    id: 1,
    label: 'Production',
    colorToken: 'green',
    displayOrder: 0,
    revision: 1,
    ...timestamps,
  }],
}

describe('inventory metadata client contracts', () => {
  it('parses strict catalogs and item values with numeric relationships', () => {
    expect(inventoryMetadataCatalogSchema.parse({ revision: 1, definitions: [definition], tags: [] }))
      .toMatchObject({ definitions: [{ id: 1, fieldType: 'singleSelect' }] })
    expect(inventoryItemMetadataSchema.parse({
      itemId: 91,
      revision: 1,
      definitions: [definition],
      values: [{ definitionId: 1, optionIds: [1], revision: 1 }],
      tags: [],
    })).toMatchObject({ itemId: 91, values: [{ definitionId: 1, optionIds: [1] }] })
  })

  it('rejects malformed identifiers, colors, and unknown fields', () => {
    expect(() => customFieldDefinitionSchema.parse({ ...definition, id: 0 })).toThrow()
    expect(() => customFieldDefinitionSchema.parse({
      ...definition,
      options: [{ ...definition.options[0], colorToken: 'chartreuse' }],
    })).toThrow()
    expect(() => inventoryMetadataCatalogSchema.parse({
      revision: 1, definitions: [], tags: [], privateValue: 'not allowed',
    })).toThrow()
  })

  it('uses stable project-scoped query keys without polling metadata', () => {
    expect(inventoryMetadataKeys.catalog()).toEqual(['inventory-metadata', 'catalog', { includeArchived: false }])
    expect(inventoryMetadataKeys.item(3, { type: 'server', id: 7 })).toEqual([
      'inventory-metadata', 'project', 3, 'items', 'server', 7,
    ])
    expect(inventoryMetadataKeys.itemRevision(3, 91)).toEqual([
      'inventory-metadata', 'project', 3, 'item-revisions', 91,
    ])
  })
})
