function positiveId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`)
  return value
}

function boundedPositiveIds(values, label, maximum = 128) {
  const normalized = [...new Set(values.map((id) => positiveId(id, label)))].sort((left, right) => left - right)
  if (normalized.length > maximum) throw new Error(`${label} contains too many IDs.`)
  return Object.freeze(normalized)
}

export function inventoryMetadataCatalogPayload({ definitionIds = [], tagIds = [] } = {}) {
  const normalizedDefinitionIds = [...new Set(definitionIds.map((id) => positiveId(id, 'Definition ID')))].sort((left, right) => left - right)
  const normalizedTagIds = [...new Set(tagIds.map((id) => positiveId(id, 'Tag ID')))].sort((left, right) => left - right)
  if (normalizedDefinitionIds.length + normalizedTagIds.length > 256) throw new Error('Inventory metadata catalog event contains too many IDs.')
  return Object.freeze({ definitionIds: Object.freeze(normalizedDefinitionIds), tagIds: Object.freeze(normalizedTagIds) })
}

function itemMetadata(metadata, itemId) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Inventory metadata must be an object.')
  }
  if (positiveId(metadata.itemId, 'Inventory metadata item ID') !== itemId) {
    throw new Error('Inventory metadata item ID must match the event item ID.')
  }
  positiveId(metadata.revision, 'Inventory metadata revision')
  for (const [key, maximum] of [['definitions', 512], ['values', 512], ['tags', 512]]) {
    if (!Array.isArray(metadata[key])) throw new Error(`Inventory metadata ${key} must be an array.`)
    if (metadata[key].length > maximum) throw new Error(`Inventory metadata ${key} contains too many records.`)
  }
  return Object.freeze(metadata)
}

export function inventoryMetadataItemPayload({ itemId, projectIds, metadata }) {
  const normalizedItemId = positiveId(itemId, 'Inventory item ID')
  const normalizedProjectIds = [...new Set(projectIds.map((id) => positiveId(id, 'Project ID')))].sort((left, right) => left - right)
  if (normalizedProjectIds.length > 128) throw new Error('Inventory metadata item event contains too many projects.')
  return Object.freeze({
    itemId: normalizedItemId,
    projectIds: Object.freeze(normalizedProjectIds),
    metadata: itemMetadata(metadata, normalizedItemId),
  })
}

export function inventoryMetadataHistoryPayload({ itemIds, projectIds }) {
  return Object.freeze({
    itemIds: boundedPositiveIds(itemIds, 'Inventory item IDs'),
    projectIds: boundedPositiveIds(projectIds, 'Project IDs'),
  })
}
