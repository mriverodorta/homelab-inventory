import type {
  InventoryItemMetadata,
  InventoryItemMetadataInput,
  InventoryMetadataValue,
} from '@/types/inventory-metadata'

export type InventoryMetadataDraftValue = string | number | boolean | readonly number[] | null

export type InventoryMetadataDraft = Readonly<{
  values: Readonly<Record<number, InventoryMetadataDraftValue>>
  tagIds: readonly number[]
}>

export const EMPTY_INVENTORY_METADATA_DRAFT: InventoryMetadataDraft = Object.freeze({
  values: Object.freeze({}),
  tagIds: Object.freeze([]),
})

function metadataValue(metadata: InventoryItemMetadata, value: InventoryMetadataValue): InventoryMetadataDraftValue {
  const definition = metadata.definitions.find((entry) => entry.id === value.definitionId)
  if (definition?.fieldType === 'singleSelect') return value.optionIds[0] ?? null
  if (definition?.fieldType === 'multiSelect') return value.optionIds
  return value.value ?? null
}

export function inventoryMetadataDraft(metadata: InventoryItemMetadata): InventoryMetadataDraft {
  return {
    values: Object.fromEntries(metadata.values.map((value) => [value.definitionId, metadataValue(metadata, value)])),
    tagIds: metadata.tags.map((tag) => tag.id),
  }
}

export function inventoryMetadataInput(draft: InventoryMetadataDraft): InventoryItemMetadataInput {
  return {
    values: Object.entries(draft.values).flatMap(([definitionId, value]) => {
      if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return []
      return [{ definitionId: Number(definitionId), value }]
    }),
    tagIds: [...draft.tagIds],
  }
}

export function inventoryMetadataDraftEqual(left: InventoryMetadataDraft, right: InventoryMetadataDraft) {
  return JSON.stringify(inventoryMetadataInput(left)) === JSON.stringify(inventoryMetadataInput(right))
}
