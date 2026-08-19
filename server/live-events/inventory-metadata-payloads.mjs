function positiveId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`)
  return value
}

export function inventoryMetadataCatalogPayload({ definitionIds = [], tagIds = [] } = {}) {
  const normalizedDefinitionIds = [...new Set(definitionIds.map((id) => positiveId(id, 'Definition ID')))].sort((left, right) => left - right)
  const normalizedTagIds = [...new Set(tagIds.map((id) => positiveId(id, 'Tag ID')))].sort((left, right) => left - right)
  if (normalizedDefinitionIds.length + normalizedTagIds.length > 256) throw new Error('Inventory metadata catalog event contains too many IDs.')
  return Object.freeze({ definitionIds: Object.freeze(normalizedDefinitionIds), tagIds: Object.freeze(normalizedTagIds) })
}

export function inventoryMetadataItemPayload({ itemId, projectIds }) {
  const normalizedProjectIds = [...new Set(projectIds.map((id) => positiveId(id, 'Project ID')))].sort((left, right) => left - right)
  if (normalizedProjectIds.length > 128) throw new Error('Inventory metadata item event contains too many projects.')
  return Object.freeze({ itemId: positiveId(itemId, 'Inventory item ID'), projectIds: Object.freeze(normalizedProjectIds) })
}
