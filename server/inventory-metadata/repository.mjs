import { assertPositiveId } from '../persistence/core/repositories/repository-context.ts'
import {
  InventoryMetadataError,
  normalizeFieldDefinitionInput,
  normalizeMetadataValueInput,
  normalizeTagInput,
} from './contract.mjs'

function notFound(subject, id) {
  throw new InventoryMetadataError(`${subject} ${id} was not found.`, {
    code: 'inventory-metadata-not-found',
    status: 404,
  })
}

function conflict(message, details) {
  throw new InventoryMetadataError(message, {
    code: 'inventory-metadata-conflict',
    status: 409,
    details,
  })
}

function confirmationFailure(subject) {
  throw new InventoryMetadataError(`${subject} confirmation does not match.`, {
    code: 'inventory-metadata-confirmation-mismatch',
    status: 400,
  })
}

function iso(value) {
  return value == null ? null : new Date(value).toISOString()
}

function affectedProjectIds(sqlite, itemId) {
  return sqlite.query(`
    SELECT DISTINCT project.id
    FROM projects project
    JOIN inventory_items item ON item.id = ?
    LEFT JOIN project_inventory_memberships membership
      ON membership.project_id = project.id AND membership.item_id = item.id
    WHERE project.archived_at_ms IS NULL
      AND (
        item.owner_project_id = project.id
        OR membership.id IS NOT NULL
        OR (item.scope = 'global' AND project.includes_global_inventory = 1)
      )
    ORDER BY project.id
  `).all(itemId).map((row) => row.id)
}

function scalarValue(row) {
  switch (row.field_type) {
    case 'shortText':
    case 'longText':
    case 'url':
      return row.text_value
    case 'number':
      return row.number_value
    case 'boolean':
      return Boolean(row.boolean_value)
    case 'date':
      return row.date_value
    case 'dateTime':
      return row.date_time_value
    default:
      return undefined
  }
}

function databaseError(error, fallback) {
  if (error instanceof InventoryMetadataError) throw error
  const message = error instanceof Error ? error.message : String(error)
  if (/unique constraint failed/iu.test(message)) conflict(fallback)
  throw error
}

export function createInventoryMetadataRepository(context) {
  const { sqlite, now } = context

  function optionRows(definitionId, { includeArchived = false } = {}) {
    return sqlite.query(`
      SELECT id, label, normalized_label, color_token, display_order, revision,
        archived_at_ms, created_at_ms, updated_at_ms
      FROM custom_field_options
      WHERE definition_id = ? ${includeArchived ? '' : 'AND archived_at_ms IS NULL'}
      ORDER BY display_order, id
    `).all(definitionId).map((row) => ({
      id: row.id,
      label: row.label,
      normalizedLabel: row.normalized_label,
      colorToken: row.color_token,
      displayOrder: row.display_order,
      revision: row.revision,
      archivedAt: iso(row.archived_at_ms),
      createdAt: iso(row.created_at_ms),
      updatedAt: iso(row.updated_at_ms),
    }))
  }

  function mapDefinition(row, options = {}) {
    const applicableItemTypes = sqlite.query(`
      SELECT item_type.key
      FROM custom_field_applicability applicability
      JOIN inventory_item_types item_type ON item_type.id = applicability.item_type_id
      WHERE applicability.definition_id = ?
      ORDER BY item_type.sort_order, item_type.id
    `).all(row.id).map((entry) => entry.key)
    return {
      id: row.id,
      name: row.name,
      normalizedName: row.normalized_name,
      description: row.description,
      fieldType: row.field_type,
      unit: row.unit,
      numberMinimum: row.number_minimum,
      numberMaximum: row.number_maximum,
      numberPrecision: row.number_precision,
      displayOrder: row.display_order,
      revision: row.revision,
      archivedAt: iso(row.archived_at_ms),
      createdAt: iso(row.created_at_ms),
      updatedAt: iso(row.updated_at_ms),
      applicableItemTypes,
      options: optionRows(row.id, options),
    }
  }

  function getDefinition(definitionId, options = {}) {
    assertPositiveId(definitionId, 'Custom field definition ID')
    const row = sqlite.query(`
      SELECT * FROM custom_field_definitions WHERE id = ?
    `).get(definitionId)
    if (!row || (!options.includeArchived && row.archived_at_ms != null)) return null
    return mapDefinition(row, options)
  }

  function mapTag(row) {
    return {
      id: row.id,
      name: row.name,
      normalizedName: row.normalized_name,
      colorToken: row.color_token,
      displayOrder: row.display_order,
      revision: row.revision,
      archivedAt: iso(row.archived_at_ms),
      createdAt: iso(row.created_at_ms),
      updatedAt: iso(row.updated_at_ms),
    }
  }

  function getTag(tagId, options = {}) {
    assertPositiveId(tagId, 'Inventory tag ID')
    const row = sqlite.query('SELECT * FROM inventory_tags WHERE id = ?').get(tagId)
    if (!row || (!options.includeArchived && row.archived_at_ms != null)) return null
    return mapTag(row)
  }

  function listCatalog({ includeArchived = false } = {}) {
    const definitions = sqlite.query(`
      SELECT * FROM custom_field_definitions
      ${includeArchived ? '' : 'WHERE archived_at_ms IS NULL'}
      ORDER BY display_order, id
    `).all().map((row) => mapDefinition(row, { includeArchived }))
    const tags = sqlite.query(`
      SELECT * FROM inventory_tags
      ${includeArchived ? '' : 'WHERE archived_at_ms IS NULL'}
      ORDER BY display_order, id
    `).all().map(mapTag)
    const revision = Math.max(
      0,
      ...definitions.map((definition) => definition.revision),
      ...tags.map((tag) => tag.revision),
    )
    return { revision, definitions, tags }
  }

  function insertApplicability(definitionId, applicableItemTypes, at) {
    const findType = sqlite.query('SELECT id FROM inventory_item_types WHERE key = ?')
    const insert = sqlite.query(`
      INSERT INTO custom_field_applicability (definition_id, item_type_id, created_at_ms)
      VALUES (?, ?, ?)
    `)
    for (const type of applicableItemTypes) {
      const row = findType.get(type)
      if (!row) conflict(`Inventory type ${type} is not configured.`)
      insert.run(definitionId, row.id, at)
    }
  }

  function insertOption(definitionId, option, displayOrder, at) {
    return sqlite.query(`
      INSERT INTO custom_field_options (
        definition_id, label, normalized_label, color_token, display_order,
        revision, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?) RETURNING id
    `).get(
      definitionId,
      option.label,
      option.normalizedLabel,
      option.colorToken,
      displayOrder,
      at,
      at,
    ).id
  }

  function createDefinition(input) {
    const definition = normalizeFieldDefinitionInput(input)
    const at = now()
    try {
      return sqlite.transaction(() => {
        if (sqlite.query('SELECT 1 FROM custom_field_definitions WHERE normalized_name = ?').get(definition.normalizedName)) {
          conflict(`A custom field named ${definition.name} already exists.`)
        }
        const displayOrder = sqlite.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS value FROM custom_field_definitions').get().value
        const row = sqlite.query(`
          INSERT INTO custom_field_definitions (
            name, normalized_name, description, field_type, unit,
            number_minimum, number_maximum, number_precision,
            display_order, revision, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id
        `).get(
          definition.name,
          definition.normalizedName,
          definition.description,
          definition.fieldType,
          definition.unit,
          definition.numberMinimum,
          definition.numberMaximum,
          definition.numberPrecision,
          displayOrder,
          at,
          at,
        )
        insertApplicability(row.id, definition.applicableItemTypes, at)
        definition.options.forEach((option, index) => insertOption(row.id, option, index, at))
        return getDefinition(row.id)
      }).immediate()
    } catch (error) {
      databaseError(error, `A custom field named ${definition.name} already exists.`)
    }
  }

  function updateDefinition(definitionId, expectedRevision, input, options = {}) {
    assertPositiveId(definitionId, 'Custom field definition ID')
    assertPositiveId(expectedRevision, 'Custom field definition revision')
    const definition = normalizeFieldDefinitionInput(input)
    const at = now()
    try {
      return sqlite.transaction(() => {
        const current = getDefinition(definitionId, { includeArchived: true })
        if (!current) notFound('Custom field definition', definitionId)
        if (current.revision !== expectedRevision) conflict(`Custom field definition ${definitionId} has changed.`)
        if (current.archivedAt) conflict('Archived custom fields must be restored before editing.')
        const valueCount = sqlite.query('SELECT COUNT(*) AS count FROM inventory_custom_field_values WHERE definition_id = ?').get(definitionId).count
        if (current.fieldType !== definition.fieldType && valueCount > 0) {
          conflict('A custom field type cannot change after the field has been used.')
        }

        const removedTypes = current.applicableItemTypes.filter((type) => !definition.applicableItemTypes.includes(type))
        if (removedTypes.length > 0) {
          const impacted = sqlite.query(`
            SELECT COUNT(*) AS count
            FROM inventory_custom_field_values value
            JOIN inventory_items item ON item.id = value.item_id
            JOIN inventory_item_types item_type ON item_type.id = item.type_id
            WHERE value.definition_id = ?
              AND item_type.key IN (${removedTypes.map(() => '?').join(',')})
          `).get(definitionId, ...removedTypes).count
          if (impacted > 0 && !options.deleteValuesForRemovedTypes) {
            conflict('Removing applicable item types would delete existing values.', { itemCount: impacted, itemTypes: removedTypes })
          }
          if (impacted > 0) {
            sqlite.query(`
              DELETE FROM inventory_custom_field_values
              WHERE definition_id = ? AND item_id IN (
                SELECT item.id FROM inventory_items item
                JOIN inventory_item_types item_type ON item_type.id = item.type_id
                WHERE item_type.key IN (${removedTypes.map(() => '?').join(',')})
              )
            `).run(definitionId, ...removedTypes)
          }
        }

        const duplicate = sqlite.query('SELECT id FROM custom_field_definitions WHERE normalized_name = ? AND id <> ?').get(definition.normalizedName, definitionId)
        if (duplicate) conflict(`A custom field named ${definition.name} already exists.`)
        sqlite.query(`
          UPDATE custom_field_definitions
          SET name = ?, normalized_name = ?, description = ?, field_type = ?, unit = ?,
            number_minimum = ?, number_maximum = ?, number_precision = ?,
            revision = revision + 1, updated_at_ms = ?
          WHERE id = ? AND revision = ?
        `).run(
          definition.name,
          definition.normalizedName,
          definition.description,
          definition.fieldType,
          definition.unit,
          definition.numberMinimum,
          definition.numberMaximum,
          definition.numberPrecision,
          at,
          definitionId,
          expectedRevision,
        )
        sqlite.query('DELETE FROM custom_field_applicability WHERE definition_id = ?').run(definitionId)
        insertApplicability(definitionId, definition.applicableItemTypes, at)

        const existingOptions = optionRows(definitionId, { includeArchived: true })
        const retainedIds = new Set()
        definition.options.forEach((option, index) => {
          if (option.id == null) {
            insertOption(definitionId, option, index, at)
            return
          }
          const existing = existingOptions.find((candidate) => candidate.id === option.id)
          if (!existing) conflict(`Option ${option.id} does not belong to custom field ${definitionId}.`)
          retainedIds.add(option.id)
          sqlite.query(`
            UPDATE custom_field_options
            SET label = ?, normalized_label = ?, color_token = ?, display_order = ?,
              revision = revision + 1, archived_at_ms = NULL, updated_at_ms = ?
            WHERE id = ? AND definition_id = ?
          `).run(option.label, option.normalizedLabel, option.colorToken, index, at, option.id, definitionId)
        })
        for (const existing of existingOptions) {
          if (retainedIds.has(existing.id)) continue
          const inUse = sqlite.query('SELECT 1 FROM inventory_custom_field_option_values WHERE option_id = ? LIMIT 1').get(existing.id)
          if (inUse) {
            sqlite.query(`
              UPDATE custom_field_options
              SET archived_at_ms = COALESCE(archived_at_ms, ?), revision = revision + 1, updated_at_ms = ?
              WHERE id = ?
            `).run(at, at, existing.id)
          } else {
            sqlite.query('DELETE FROM custom_field_options WHERE id = ?').run(existing.id)
          }
        }
        return getDefinition(definitionId)
      }).immediate()
    } catch (error) {
      databaseError(error, `Custom field definition ${definition.name} conflicts with existing metadata.`)
    }
  }

  function setDefinitionArchived(definitionId, expectedRevision, archived) {
    assertPositiveId(definitionId, 'Custom field definition ID')
    assertPositiveId(expectedRevision, 'Custom field definition revision')
    const current = getDefinition(definitionId, { includeArchived: true })
    if (!current) notFound('Custom field definition', definitionId)
    if (current.revision !== expectedRevision) conflict(`Custom field definition ${definitionId} has changed.`)
    if (archived === Boolean(current.archivedAt)) return current
    const at = now()
    const result = sqlite.query(`
      UPDATE custom_field_definitions
      SET archived_at_ms = ?, revision = revision + 1, updated_at_ms = ?
      WHERE id = ? AND revision = ?
    `).run(archived ? at : null, at, definitionId, expectedRevision)
    if (result.changes !== 1) conflict(`Custom field definition ${definitionId} has changed.`)
    return getDefinition(definitionId, { includeArchived: true })
  }

  function definitionImpact(definitionId) {
    if (!getDefinition(definitionId, { includeArchived: true })) notFound('Custom field definition', definitionId)
    const itemCount = sqlite.query('SELECT COUNT(*) AS count FROM inventory_custom_field_values WHERE definition_id = ?').get(definitionId).count
    const optionSelectionCount = sqlite.query(`
      SELECT COUNT(*) AS count
      FROM inventory_custom_field_option_values selection
      JOIN inventory_custom_field_values value ON value.id = selection.value_id
      WHERE value.definition_id = ?
    `).get(definitionId).count
    const affectedItemTypes = sqlite.query(`
      SELECT item_type.key AS type, COUNT(*) AS item_count
      FROM inventory_custom_field_values value
      JOIN inventory_items item ON item.id = value.item_id
      JOIN inventory_item_types item_type ON item_type.id = item.type_id
      WHERE value.definition_id = ?
      GROUP BY item_type.id, item_type.key
      ORDER BY item_type.sort_order, item_type.id
    `).all(definitionId).map((row) => ({ type: row.type, itemCount: row.item_count }))
    return { definitionId, itemCount, optionSelectionCount, affectedItemTypes }
  }

  function deleteDefinitionPermanently(definitionId, confirmationName) {
    const current = getDefinition(definitionId, { includeArchived: true })
    if (!current) notFound('Custom field definition', definitionId)
    if (!current.archivedAt) conflict('Custom field definition must be archived before permanent deletion.')
    if (confirmationName !== current.name) confirmationFailure('Custom field definition')
    const impact = definitionImpact(definitionId)
    sqlite.query('DELETE FROM custom_field_definitions WHERE id = ?').run(definitionId)
    return impact
  }

  function reorderDefinitions(definitionIds) {
    if (!Array.isArray(definitionIds)) throw new InventoryMetadataError('Definition order must be an array.')
    const ids = definitionIds.map((id) => assertPositiveId(id, 'Custom field definition ID'))
    if (new Set(ids).size !== ids.length) conflict('Definition order cannot contain duplicates.')
    const activeIds = sqlite.query(`
      SELECT id FROM custom_field_definitions WHERE archived_at_ms IS NULL ORDER BY display_order, id
    `).all().map((row) => row.id)
    if (ids.length !== activeIds.length || ids.some((id) => !activeIds.includes(id))) {
      conflict('Definition order must contain every active custom field exactly once.')
    }
    const at = now()
    sqlite.transaction(() => {
      const update = sqlite.query(`
        UPDATE custom_field_definitions
        SET display_order = ?, revision = revision + 1, updated_at_ms = ?
        WHERE id = ? AND archived_at_ms IS NULL
      `)
      ids.forEach((id, index) => update.run(index, at, id))
    }).immediate()
    return listCatalog()
  }

  function createTag(input) {
    const tag = normalizeTagInput(input)
    const at = now()
    try {
      const displayOrder = sqlite.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS value FROM inventory_tags').get().value
      const row = sqlite.query(`
        INSERT INTO inventory_tags (
          name, normalized_name, color_token, display_order,
          revision, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING id
      `).get(tag.name, tag.normalizedName, tag.colorToken, displayOrder, at, at)
      return getTag(row.id)
    } catch (error) {
      databaseError(error, `A tag named ${tag.name} already exists.`)
    }
  }

  function updateTag(tagId, expectedRevision, input) {
    const tag = normalizeTagInput(input)
    const current = getTag(tagId, { includeArchived: true })
    if (!current) notFound('Inventory tag', tagId)
    if (current.revision !== expectedRevision) conflict(`Inventory tag ${tagId} has changed.`)
    if (current.archivedAt) conflict('Archived tags must be restored before editing.')
    const duplicate = sqlite.query('SELECT id FROM inventory_tags WHERE normalized_name = ? AND id <> ?').get(tag.normalizedName, tagId)
    if (duplicate) conflict(`A tag named ${tag.name} already exists.`)
    const at = now()
    sqlite.query(`
      UPDATE inventory_tags
      SET name = ?, normalized_name = ?, color_token = ?, revision = revision + 1, updated_at_ms = ?
      WHERE id = ? AND revision = ?
    `).run(tag.name, tag.normalizedName, tag.colorToken, at, tagId, expectedRevision)
    return getTag(tagId)
  }

  function setTagArchived(tagId, expectedRevision, archived) {
    const current = getTag(tagId, { includeArchived: true })
    if (!current) notFound('Inventory tag', tagId)
    if (current.revision !== expectedRevision) conflict(`Inventory tag ${tagId} has changed.`)
    if (archived === Boolean(current.archivedAt)) return current
    const at = now()
    sqlite.query(`
      UPDATE inventory_tags
      SET archived_at_ms = ?, revision = revision + 1, updated_at_ms = ?
      WHERE id = ? AND revision = ?
    `).run(archived ? at : null, at, tagId, expectedRevision)
    return getTag(tagId, { includeArchived: true })
  }

  function tagImpact(tagId) {
    if (!getTag(tagId, { includeArchived: true })) notFound('Inventory tag', tagId)
    return {
      tagId,
      itemCount: sqlite.query('SELECT COUNT(*) AS count FROM inventory_item_tags WHERE tag_id = ?').get(tagId).count,
    }
  }

  function deleteTagPermanently(tagId, confirmationName) {
    const current = getTag(tagId, { includeArchived: true })
    if (!current) notFound('Inventory tag', tagId)
    if (!current.archivedAt) conflict('Inventory tag must be archived before permanent deletion.')
    if (confirmationName !== current.name) confirmationFailure('Inventory tag')
    const impact = tagImpact(tagId)
    sqlite.query('DELETE FROM inventory_tags WHERE id = ?').run(tagId)
    return impact
  }

  function reorderTags(tagIds) {
    if (!Array.isArray(tagIds)) throw new InventoryMetadataError('Tag order must be an array.')
    const ids = tagIds.map((id) => assertPositiveId(id, 'Inventory tag ID'))
    if (new Set(ids).size !== ids.length) conflict('Tag order cannot contain duplicates.')
    const activeIds = sqlite.query(`
      SELECT id FROM inventory_tags WHERE archived_at_ms IS NULL ORDER BY display_order, id
    `).all().map((row) => row.id)
    if (ids.length !== activeIds.length || ids.some((id) => !activeIds.includes(id))) {
      conflict('Tag order must contain every active inventory tag exactly once.')
    }
    const at = now()
    sqlite.transaction(() => {
      const update = sqlite.query(`
        UPDATE inventory_tags
        SET display_order = ?, revision = revision + 1, updated_at_ms = ?
        WHERE id = ? AND archived_at_ms IS NULL
      `)
      ids.forEach((id, index) => update.run(index, at, id))
    }).immediate()
    return listCatalog()
  }

  function getItemMetadata(itemId) {
    assertPositiveId(itemId, 'Inventory item ID')
    const item = sqlite.query('SELECT id, type_id FROM inventory_items WHERE id = ?').get(itemId)
    if (!item) notFound('Inventory item', itemId)
    const definitions = sqlite.query(`
      SELECT definition.*
      FROM custom_field_definitions definition
      JOIN custom_field_applicability applicability
        ON applicability.definition_id = definition.id
        AND applicability.item_type_id = ?
      WHERE definition.archived_at_ms IS NULL
      ORDER BY definition.display_order, definition.id
    `).all(item.type_id).map((row) => mapDefinition(row))
    const rows = sqlite.query(`
      SELECT value.*, definition.field_type
      FROM inventory_custom_field_values value
      JOIN custom_field_definitions definition ON definition.id = value.definition_id
      WHERE value.item_id = ? AND definition.archived_at_ms IS NULL
      ORDER BY definition.display_order, definition.id
    `).all(itemId)
    const optionIds = sqlite.query(`
      SELECT value.id AS value_id, selection.option_id
      FROM inventory_custom_field_values value
      JOIN inventory_custom_field_option_values selection ON selection.value_id = value.id
      WHERE value.item_id = ?
      ORDER BY selection.option_id
    `).all(itemId)
    const optionIdsByValue = Map.groupBy(optionIds, (row) => row.value_id)
    const values = rows.map((row) => ({
      definitionId: row.definition_id,
      value: scalarValue(row),
      optionIds: (optionIdsByValue.get(row.id) ?? []).map((entry) => entry.option_id),
      revision: row.revision,
    }))
    const tags = sqlite.query(`
      SELECT tag.*
      FROM inventory_item_tags relation
      JOIN inventory_tags tag ON tag.id = relation.tag_id
      WHERE relation.item_id = ? AND tag.archived_at_ms IS NULL
      ORDER BY tag.display_order, tag.id
    `).all(itemId).map(mapTag)
    return { itemId, definitions, values, tags }
  }

  function replaceItemMetadata(itemId, input, options = {}) {
    assertPositiveId(itemId, 'Inventory item ID')
    const item = sqlite.query('SELECT id, type_id FROM inventory_items WHERE id = ? AND archived_at_ms IS NULL').get(itemId)
    if (!item) notFound('Active inventory item', itemId)
    const rawValues = input?.values ?? []
    const rawTagIds = input?.tagIds ?? []
    if (!Array.isArray(rawValues) || !Array.isArray(rawTagIds)) {
      throw new InventoryMetadataError('Metadata values and tags must be arrays.')
    }
    const seenDefinitions = new Set()
    const preparedValues = rawValues.map((entry) => {
      const definitionId = assertPositiveId(entry?.definitionId, 'Custom field definition ID')
      if (seenDefinitions.has(definitionId)) conflict(`Custom field definition ${definitionId} was provided more than once.`)
      seenDefinitions.add(definitionId)
      const definition = getDefinition(definitionId)
      if (!definition) notFound('Active custom field definition', definitionId)
      const applies = sqlite.query(`
        SELECT 1 FROM custom_field_applicability
        WHERE definition_id = ? AND item_type_id = ?
      `).get(definitionId, item.type_id)
      if (!applies) conflict(`Custom field ${definition.name} is not applicable to this inventory item.`)
      const normalized = normalizeMetadataValueInput(definition, entry.value)
      if (!normalized) return null
      if (normalized.optionIds.length > 0) {
        const placeholders = normalized.optionIds.map(() => '?').join(',')
        const rows = sqlite.query(`
          SELECT id FROM custom_field_options
          WHERE definition_id = ? AND archived_at_ms IS NULL AND id IN (${placeholders})
        `).all(definitionId, ...normalized.optionIds)
        if (rows.length !== normalized.optionIds.length) conflict(`One or more options do not belong to custom field ${definition.name}.`)
      }
      return { definitionId, normalized }
    }).filter(Boolean)
    const tagIds = [...new Set(rawTagIds.map((id) => assertPositiveId(id, 'Inventory tag ID')))].sort((left, right) => left - right)
    if (tagIds.length > 0) {
      const rows = sqlite.query(`
        SELECT id FROM inventory_tags
        WHERE archived_at_ms IS NULL AND id IN (${tagIds.map(() => '?').join(',')})
      `).all(...tagIds)
      if (rows.length !== tagIds.length) conflict('One or more inventory tags are unavailable.')
    }
    const at = now()
    const replace = () => {
      sqlite.query(`
        DELETE FROM inventory_custom_field_values
        WHERE item_id = ? AND definition_id IN (
          SELECT id FROM custom_field_definitions WHERE archived_at_ms IS NULL
        )
      `).run(itemId)
      sqlite.query(`
        DELETE FROM inventory_item_tags
        WHERE item_id = ? AND tag_id IN (
          SELECT id FROM inventory_tags WHERE archived_at_ms IS NULL
        )
      `).run(itemId)
      const insertValue = sqlite.query(`
        INSERT INTO inventory_custom_field_values (
          definition_id, item_id, text_value, number_value, boolean_value,
          date_value, date_time_value, revision, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id
      `)
      const insertOption = sqlite.query(`
        INSERT INTO inventory_custom_field_option_values (value_id, option_id, created_at_ms)
        VALUES (?, ?, ?)
      `)
      for (const entry of preparedValues) {
        const value = insertValue.get(
          entry.definitionId,
          itemId,
          entry.normalized.textValue ?? null,
          entry.normalized.numberValue ?? null,
          entry.normalized.booleanValue == null ? null : Number(entry.normalized.booleanValue),
          entry.normalized.dateValue ?? null,
          entry.normalized.dateTimeValue ?? null,
          at,
          at,
        )
        for (const optionId of entry.normalized.optionIds) insertOption.run(value.id, optionId, at)
      }
      const insertTag = sqlite.query(`
        INSERT INTO inventory_item_tags (item_id, tag_id, created_at_ms) VALUES (?, ?, ?)
      `)
      for (const tagId of tagIds) insertTag.run(itemId, tagId, at)
    }
    if (options.transaction === false) replace()
    else sqlite.transaction(replace).immediate()
    return { itemId, affectedProjectIds: affectedProjectIds(sqlite, itemId) }
  }

  function copyItemMetadata(sourceItemId, targetItemId, options = {}) {
    assertPositiveId(sourceItemId, 'Source inventory item ID')
    assertPositiveId(targetItemId, 'Target inventory item ID')
    const source = getItemMetadata(sourceItemId)
    const definitions = new Map(source.definitions.map((definition) => [definition.id, definition]))
    const values = source.values.map((entry) => {
      const definition = definitions.get(entry.definitionId)
      if (!definition) conflict(`Custom field definition ${entry.definitionId} is unavailable.`)
      if (definition.fieldType === 'singleSelect') {
        return { definitionId: entry.definitionId, value: entry.optionIds[0] }
      }
      if (definition.fieldType === 'multiSelect') {
        return { definitionId: entry.definitionId, value: entry.optionIds }
      }
      return { definitionId: entry.definitionId, value: entry.value }
    })
    replaceItemMetadata(targetItemId, {
      values,
      tagIds: source.tags.map((tag) => tag.id),
    }, options)
    return { sourceItemId, targetItemId }
  }

  return Object.freeze({
    listCatalog,
    getDefinition,
    createDefinition,
    updateDefinition,
    archiveDefinition: (id, revision) => setDefinitionArchived(id, revision, true),
    restoreDefinition: (id, revision) => setDefinitionArchived(id, revision, false),
    definitionImpact,
    deleteDefinitionPermanently,
    reorderDefinitions,
    getTag,
    createTag,
    updateTag,
    archiveTag: (id, revision) => setTagArchived(id, revision, true),
    restoreTag: (id, revision) => setTagArchived(id, revision, false),
    tagImpact,
    deleteTagPermanently,
    reorderTags,
    getItemMetadata,
    replaceItemMetadata,
    copyItemMetadata,
    itemProjectIds: (itemId) => {
      assertPositiveId(itemId, 'Inventory item ID')
      return affectedProjectIds(sqlite, itemId)
    },
  })
}
