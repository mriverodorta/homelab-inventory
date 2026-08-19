import { InventoryMetadataError } from './contract.mjs'

const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])
const FILTER_OPERATORS = new Set([
  'contains', 'set', 'unset', 'range', 'date-range', 'yes', 'no', 'options',
  'tags-any', 'has-tags', 'no-tags',
])

function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InventoryMetadataError(`${label} must be a positive safe integer.`)
  }
  return parsed
}

function boundedIds(value, label) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 100) {
    throw new InventoryMetadataError(`${label} must be an array with at most 100 entries.`)
  }
  return [...new Set(value.map((entry) => positiveId(entry, label)))].sort((left, right) => left - right)
}

function normalizeFilters(value) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 25) {
    throw new InventoryMetadataError('Metadata filters must be an array with at most 25 entries.')
  }
  return value.map((filter) => {
    const operator = String(filter?.operator ?? '')
    if (!FILTER_OPERATORS.has(operator)) throw new InventoryMetadataError('Metadata filter operator is not supported.')
    if (operator.startsWith('tags-') || operator === 'has-tags' || operator === 'no-tags') {
      return { operator, tagIds: boundedIds(filter.tagIds, 'Tag ID') }
    }
    const definitionId = positiveId(filter?.definitionId, 'Custom field definition ID')
    if (operator === 'contains') {
      const text = String(filter?.text ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
      if (!text || text.length > 200) throw new InventoryMetadataError('Text filters require 1-200 characters.')
      return { operator, definitionId, text }
    }
    if (operator === 'range') {
      const minimum = filter?.minimum == null || filter.minimum === '' ? null : Number(filter.minimum)
      const maximum = filter?.maximum == null || filter.maximum === '' ? null : Number(filter.maximum)
      if ((minimum != null && !Number.isFinite(minimum)) || (maximum != null && !Number.isFinite(maximum))) {
        throw new InventoryMetadataError('Metadata range bounds must be finite numbers.')
      }
      if (minimum == null && maximum == null) throw new InventoryMetadataError('Metadata ranges require a minimum or maximum.')
      if (minimum != null && maximum != null && minimum > maximum) throw new InventoryMetadataError('Metadata range minimum cannot exceed its maximum.')
      return { operator, definitionId, minimum, maximum }
    }
    if (operator === 'date-range') {
      const after = filter?.after == null || filter.after === '' ? null : String(filter.after)
      const before = filter?.before == null || filter.before === '' ? null : String(filter.before)
      if (after == null && before == null) throw new InventoryMetadataError('Date ranges require an after or before value.')
      if (after != null && before != null && after > before) throw new InventoryMetadataError('Date range start cannot exceed its end.')
      return { operator, definitionId, after, before }
    }
    if (operator === 'options') {
      const optionIds = boundedIds(filter.optionIds, 'Option ID')
      if (optionIds.length === 0) throw new InventoryMetadataError('Option filters require at least one option.')
      return { operator, definitionId, optionIds }
    }
    return { operator, definitionId }
  })
}

function scalar(row) {
  if (row.text_value != null) return row.text_value
  if (row.number_value != null) return row.number_value
  if (row.boolean_value != null) return row.boolean_value === 1
  if (row.date_value != null) return row.date_value
  if (row.date_time_value != null) return row.date_time_value
  return null
}

function displayValue(value, options) {
  if (options.length) return options.map((option) => option.label).join(', ')
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return value == null ? null : String(value)
}

function matchesFilter(row, filter) {
  if (filter.operator === 'tags-any') return filter.tagIds.some((id) => row.tagIds.has(id))
  if (filter.operator === 'has-tags') return row.tagIds.size > 0
  if (filter.operator === 'no-tags') return row.tagIds.size === 0
  const value = row.values.get(filter.definitionId)
  if (filter.operator === 'set') return value !== undefined
  if (filter.operator === 'unset') return value === undefined
  if (value === undefined) return false
  if (filter.operator === 'contains') return value.searchText.includes(filter.text)
  if (filter.operator === 'range') {
    return typeof value.value === 'number'
      && (filter.minimum == null || value.value >= filter.minimum)
      && (filter.maximum == null || value.value <= filter.maximum)
  }
  if (filter.operator === 'date-range') {
    return typeof value.value === 'string'
      && (filter.after == null || value.value >= filter.after)
      && (filter.before == null || value.value <= filter.before)
  }
  if (filter.operator === 'yes') return value.value === true
  if (filter.operator === 'no') return value.value === false
  if (filter.operator === 'options') return filter.optionIds.some((id) => value.optionIds.includes(id))
  return false
}

export class InventoryMetadataFilterService {
  constructor(database) {
    this.database = database
  }

  projectProjection(projectId, input = {}) {
    const project = positiveId(projectId, 'Project ID')
    const scope = input.scope === 'systems' ? 'systems' : 'inventory'
    const definitionIds = boundedIds(input.definitionIds, 'Custom field definition ID')
    const filters = normalizeFilters(input.filters)
    const filterDefinitionIds = filters.flatMap((filter) => filter.definitionId ? [filter.definitionId] : [])
    const requestedDefinitionIds = [...new Set([...definitionIds, ...filterDefinitionIds])].sort((left, right) => left - right)
    const includeSearch = input.includeSearch === true
    const projectRow = this.database.query('SELECT includes_global_inventory FROM projects WHERE id = ? AND archived_at_ms IS NULL').get(project)
    if (!projectRow) throw new InventoryMetadataError(`Active project ${project} was not found.`, { status: 404, code: 'inventory-metadata-not-found' })

    const items = this.database.query(`
      SELECT item.id AS item_id, type.key AS item_type, identity.legacy_id
      FROM inventory_items item
      JOIN inventory_item_types type ON type.id = item.type_id
      JOIN inventory_identity_aliases identity ON identity.item_id = item.id
      LEFT JOIN project_inventory_memberships membership
        ON membership.item_id = item.id AND membership.project_id = ?
      WHERE item.archived_at_ms IS NULL
        AND (item.owner_project_id = ? OR membership.id IS NOT NULL OR (item.scope = 'global' AND ? = 1))
      ORDER BY item.id
    `).all(project, project, projectRow.includes_global_inventory)
      .filter((item) => scope !== 'systems' || HOST_TYPES.has(item.item_type))
    const itemIds = items.map((item) => item.item_id)
    if (itemIds.length === 0) return { projectId: project, rows: [], matchingItemIds: [] }
    const itemPlaceholders = itemIds.map(() => '?').join(',')
    const rows = new Map(items.map((item) => [item.item_id, {
      itemId: item.item_id,
      itemType: item.item_type,
      legacyId: item.legacy_id,
      tags: [],
      tagIds: new Set(),
      values: new Map(),
      searchParts: [],
    }]))

    for (const tag of this.database.query(`
      SELECT relation.item_id, tag.id, tag.name, tag.color_token, tag.display_order
      FROM inventory_item_tags relation
      JOIN inventory_tags tag ON tag.id = relation.tag_id
      WHERE relation.item_id IN (${itemPlaceholders}) AND tag.archived_at_ms IS NULL
      ORDER BY relation.item_id, tag.display_order, tag.id
    `).all(...itemIds)) {
      const row = rows.get(tag.item_id)
      row.tags.push({ id: tag.id, name: tag.name, colorToken: tag.color_token })
      row.tagIds.add(tag.id)
      if (includeSearch) row.searchParts.push(tag.name)
    }

    if (includeSearch || requestedDefinitionIds.length > 0) {
      const definitionClause = includeSearch ? '' : `AND value.definition_id IN (${requestedDefinitionIds.map(() => '?').join(',')})`
      const values = this.database.query(`
        SELECT value.*, definition.field_type
        FROM inventory_custom_field_values value
        JOIN custom_field_definitions definition ON definition.id = value.definition_id
        WHERE value.item_id IN (${itemPlaceholders})
          AND definition.archived_at_ms IS NULL ${definitionClause}
        ORDER BY value.item_id, definition.display_order, definition.id
      `).all(...itemIds, ...(includeSearch ? [] : requestedDefinitionIds))
      const valueIds = values.map((value) => value.id)
      const optionRows = valueIds.length === 0 ? [] : this.database.query(`
        SELECT selection.value_id, option.id, option.label, option.color_token
        FROM inventory_custom_field_option_values selection
        JOIN custom_field_options option ON option.id = selection.option_id
        WHERE selection.value_id IN (${valueIds.map(() => '?').join(',')}) AND option.archived_at_ms IS NULL
        ORDER BY selection.value_id, option.display_order, option.id
      `).all(...valueIds)
      const optionsByValue = Map.groupBy(optionRows, (option) => option.value_id)
      for (const valueRow of values) {
        const value = scalar(valueRow)
        const options = (optionsByValue.get(valueRow.id) ?? []).map((option) => ({
          id: option.id, label: option.label, colorToken: option.color_token,
        }))
        const display = displayValue(value, options)
        const row = rows.get(valueRow.item_id)
        row.values.set(valueRow.definition_id, {
          value,
          optionIds: options.map((option) => option.id),
          display,
          searchText: String(display ?? '').toLocaleLowerCase('en-US'),
        })
        if (includeSearch && display) row.searchParts.push(display)
      }
    }

    const matchingItemIds = [...rows.values()]
      .filter((row) => filters.every((filter) => matchesFilter(row, filter)))
      .map((row) => row.itemId)
    return {
      projectId: project,
      rows: [...rows.values()].map((row) => ({
        itemId: row.itemId,
        itemType: row.itemType,
        legacyId: row.legacyId,
        tags: row.tags,
        values: Object.fromEntries([...row.values].map(([definitionId, value]) => [definitionId, {
          value: value.value,
          optionIds: value.optionIds,
          display: value.display,
        }])),
        ...(includeSearch ? { searchText: row.searchParts.join(' ').toLocaleLowerCase('en-US') } : {}),
      })),
      matchingItemIds,
    }
  }
}
