import { normalizeInventoryMetadataFilters } from '../inventory-metadata/filter-service.mjs'

const HOST_TYPES = ['server', 'nas', 'pcBuild']
const REGISTRATIONS = ['registered', 'unregistered']
const REGISTRY_STATES = ['linked', 'unlinked']
export const SYSTEMS_COLUMN_KEYS = [
  'type', 'name', 'manufacturer', 'cpu', 'memory', 'storage', 'attention',
  'agent', 'registry', 'operatingSystem', 'uptime', 'lanIp',
]
const SYSTEMS_OPTIONAL_COLUMN_KEYS = ['tags']
const SORT_DIRECTIONS = ['ascending', 'descending']
const DENSITIES = ['dense', 'comfortable']

export class SystemsViewError extends Error {
  constructor(message, code, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new SystemsViewError(`${label} must be a positive safe integer.`, 'invalid-systems-view')
  return parsed
}

function enumArray(value, allowed, label) {
  if (!Array.isArray(value)) throw new SystemsViewError(`${label} must be an array.`, 'invalid-systems-view')
  const result = [...new Set(value)]
  if (result.some((entry) => !allowed.includes(entry))) throw new SystemsViewError(`${label} contains an unsupported value.`, 'invalid-systems-view')
  return result
}

function cleanName(value) {
  const name = String(value ?? '').normalize('NFKC').trim()
  if (!name || name.length > 80) throw new SystemsViewError('Saved view name must contain 1-80 characters.', 'invalid-systems-view')
  return name
}

function customFieldId(key) {
  const match = /^custom-field:([1-9]\d*)$/u.exec(key)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) ? id : null
}

function validateMetadataReferences(database, columns, filters) {
  if (!database) return
  const definitionIds = [...new Set([
    ...columns.map((column) => column.definitionId).filter(Boolean),
    ...filters.map((filter) => filter.definitionId).filter(Boolean),
  ])]
  for (const id of definitionIds) {
    if (!database.query('SELECT 1 FROM custom_field_definitions WHERE id = ?').get(id)) {
      throw new SystemsViewError(`Custom field definition ${id} is unavailable.`, 'invalid-systems-view')
    }
  }
  for (const filter of filters) {
    for (const optionId of filter.optionIds ?? []) {
      if (!database.query('SELECT 1 FROM custom_field_options WHERE id = ? AND definition_id = ?').get(optionId, filter.definitionId)) {
        throw new SystemsViewError(`Custom field option ${optionId} is unavailable.`, 'invalid-systems-view')
      }
    }
    for (const tagId of filter.tagIds ?? []) {
      if (!database.query('SELECT 1 FROM inventory_tags WHERE id = ?').get(tagId)) {
        throw new SystemsViewError(`Inventory tag ${tagId} is unavailable.`, 'invalid-systems-view')
      }
    }
  }
}

export function normalizeSystemsViewInput(input, { requireName = true, database = null, projectId = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SystemsViewError('Saved view configuration is required.', 'invalid-systems-view')
  const columnInput = Array.isArray(input.columns) ? input.columns : []
  const columns = columnInput.map((column, index) => ({
    key: String(column?.key ?? ''),
    visible: column?.visible === true,
    order: Number(column?.order ?? index),
    definitionId: customFieldId(String(column?.key ?? '')),
  })).sort((left, right) => left.order - right.order)
  const allowedColumn = (column) => SYSTEMS_COLUMN_KEYS.includes(column.key)
    || SYSTEMS_OPTIONAL_COLUMN_KEYS.includes(column.key)
    || column.definitionId !== null
  if (new Set(columns.map((column) => column.key)).size !== columns.length
    || columns.some((column) => !allowedColumn(column))
    || SYSTEMS_COLUMN_KEYS.some((key) => !columns.some((column) => column.key === key))) {
    throw new SystemsViewError('Saved view columns must contain every base column once and only supported metadata columns.', 'invalid-systems-view')
  }
  if (columns.some((column, index) => !Number.isSafeInteger(column.order) || column.order !== index)) {
    throw new SystemsViewError('Saved view column order must be contiguous.', 'invalid-systems-view')
  }
  if (columns[0]?.key !== 'type' || columns[1]?.key !== 'name' || !columns[0].visible || !columns[1].visible) {
    throw new SystemsViewError('Type and Name must remain visible and first.', 'invalid-systems-view')
  }
  const sortKey = String(input.sortKey ?? 'name')
  const sortDirection = String(input.sortDirection ?? 'ascending')
  const density = String(input.density ?? 'dense')
  if (!SYSTEMS_COLUMN_KEYS.includes(sortKey)) throw new SystemsViewError('Saved view sort column is invalid.', 'invalid-systems-view')
  if (!SORT_DIRECTIONS.includes(sortDirection)) throw new SystemsViewError('Saved view sort direction is invalid.', 'invalid-systems-view')
  if (!DENSITIES.includes(density)) throw new SystemsViewError('Saved view density is invalid.', 'invalid-systems-view')
  const metadataFilters = normalizeInventoryMetadataFilters(input.metadataFilters ?? [])
  validateMetadataReferences(database, columns, metadataFilters)
  const canvasWorkspaceId = input.canvasWorkspaceId == null
    ? null
    : positiveId(input.canvasWorkspaceId, 'Saved view canvas ID')
  if (canvasWorkspaceId !== null && database && projectId !== null) {
    const canvas = database.query(`
      SELECT id FROM workspaces
      WHERE id = ? AND project_id = ? AND type = 'canvas' AND archived_at_ms IS NULL
    `).get(canvasWorkspaceId, projectId)
    if (!canvas) {
      throw new SystemsViewError('The selected saved-view canvas is unavailable.', 'invalid-systems-view')
    }
  }
  return {
    ...(requireName ? { name: cleanName(input.name) } : {}),
    types: enumArray(input.types ?? [], HOST_TYPES, 'System types'),
    registrations: enumArray(input.registrations ?? [], REGISTRATIONS, 'Agent registrations'),
    registryStates: enumArray(input.registryStates ?? [], REGISTRY_STATES, 'Registry states'),
    canvasWorkspaceId,
    sortKey,
    sortDirection,
    density,
    columns: columns.map(({ key, visible, order }) => ({ key, visible, order })),
    metadataFilters,
  }
}

function owner(accountId) {
  if (accountId == null) return { scope: 'open-installation', accountId: null }
  return { scope: 'account', accountId: positiveId(accountId, 'Account ID') }
}

function ownedView(database, projectId, accountId, viewId) {
  const identity = owner(accountId)
  return database.query(`
    SELECT * FROM systems_saved_views
    WHERE id = ? AND project_id = ? AND owner_scope = ?
      AND ((? IS NULL AND account_id IS NULL) OR account_id = ?)
  `).get(viewId, projectId, identity.scope, identity.accountId, identity.accountId)
}

function readMetadataFilters(database, savedViewId) {
  const filters = database.query(`
    SELECT * FROM systems_saved_view_metadata_filters
    WHERE saved_view_id = ? ORDER BY id
  `).all(savedViewId)
  if (!filters.length) return []
  const ids = filters.map((filter) => filter.id)
  const placeholders = ids.map(() => '?').join(',')
  const optionRows = database.query(`
    SELECT filter_id, option_id FROM systems_saved_view_metadata_filter_options
    WHERE filter_id IN (${placeholders}) ORDER BY filter_id, option_id
  `).all(...ids)
  const tagRows = database.query(`
    SELECT filter_id, tag_id FROM systems_saved_view_metadata_filter_tags
    WHERE filter_id IN (${placeholders}) ORDER BY filter_id, tag_id
  `).all(...ids)
  const options = Map.groupBy(optionRows, (entry) => entry.filter_id)
  const tags = Map.groupBy(tagRows, (entry) => entry.filter_id)
  return filters.map((filter) => ({
    operator: filter.operator,
    ...(filter.definition_id == null ? {} : { definitionId: filter.definition_id }),
    ...(filter.text_value == null ? {} : { text: filter.text_value }),
    ...(filter.number_minimum == null ? {} : { minimum: filter.number_minimum }),
    ...(filter.number_maximum == null ? {} : { maximum: filter.number_maximum }),
    ...(filter.date_after == null ? {} : { after: filter.date_after }),
    ...(filter.date_before == null ? {} : { before: filter.date_before }),
    ...((options.get(filter.id) ?? []).length ? { optionIds: options.get(filter.id).map((entry) => entry.option_id) } : {}),
    ...((tags.get(filter.id) ?? []).length ? { tagIds: tags.get(filter.id).map((entry) => entry.tag_id) } : {}),
  }))
}

function readView(database, row) {
  const filters = database.query(`
    SELECT filter_category, filter_value FROM systems_saved_view_filters
    WHERE saved_view_id = ? ORDER BY filter_category, filter_value
  `).all(row.id)
  const columns = database.query(`
    SELECT column_key, visible, display_order FROM systems_saved_view_columns
    WHERE saved_view_id = ? ORDER BY display_order
  `).all(row.id)
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    isDefault: row.is_default === 1,
    revision: row.revision,
    configuration: {
      types: filters.filter((entry) => entry.filter_category === 'type').map((entry) => entry.filter_value),
      registrations: filters.filter((entry) => entry.filter_category === 'registration').map((entry) => entry.filter_value),
      registryStates: filters.filter((entry) => entry.filter_category === 'registry').map((entry) => entry.filter_value),
      canvasWorkspaceId: row.canvas_workspace_id != null && database.query(`
        SELECT 1 FROM workspaces
        WHERE id = ? AND project_id = ? AND type = 'canvas' AND archived_at_ms IS NULL
      `).get(row.canvas_workspace_id, row.project_id) ? row.canvas_workspace_id : null,
      sortKey: row.sort_key,
      sortDirection: row.sort_direction,
      density: row.density,
      columns: columns.map((column) => ({ key: column.column_key, visible: column.visible === 1, order: column.display_order })),
      metadataFilters: readMetadataFilters(database, row.id),
    },
    createdAt: new Date(row.created_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  }
}

function insertChildren(database, viewId, configuration) {
  const filter = database.query(`INSERT INTO systems_saved_view_filters (saved_view_id, filter_category, filter_value) VALUES (?, ?, ?)`)
  for (const value of configuration.types) filter.run(viewId, 'type', value)
  for (const value of configuration.registrations) filter.run(viewId, 'registration', value)
  for (const value of configuration.registryStates) filter.run(viewId, 'registry', value)
  const column = database.query(`INSERT INTO systems_saved_view_columns (saved_view_id, column_key, definition_id, visible, display_order) VALUES (?, ?, ?, ?, ?)`)
  for (const entry of configuration.columns) column.run(viewId, entry.key, customFieldId(entry.key), entry.visible ? 1 : 0, entry.order)
  const metadataFilter = database.query(`
    INSERT INTO systems_saved_view_metadata_filters (
      saved_view_id, definition_id, operator, text_value, number_minimum,
      number_maximum, date_after, date_before
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `)
  const option = database.query('INSERT INTO systems_saved_view_metadata_filter_options (filter_id, option_id) VALUES (?, ?)')
  const tag = database.query('INSERT INTO systems_saved_view_metadata_filter_tags (filter_id, tag_id) VALUES (?, ?)')
  for (const entry of configuration.metadataFilters) {
    const created = metadataFilter.get(
      viewId, entry.definitionId ?? null, entry.operator, entry.text ?? null,
      entry.minimum ?? null, entry.maximum ?? null, entry.after ?? null, entry.before ?? null,
    )
    for (const optionId of entry.optionIds ?? []) option.run(created.id, optionId)
    for (const tagId of entry.tagIds ?? []) tag.run(created.id, tagId)
  }
}

function mapConstraintError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('systems_saved_views') && message.includes('UNIQUE constraint failed')) {
    throw new SystemsViewError('A saved view with this name already exists.', 'systems-view-name-conflict', 409)
  }
  throw error
}

export class SystemsSavedViewService {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now
  }

  list(store, { projectId, accountId = null }) {
    const id = positiveId(projectId, 'Project ID')
    const identity = owner(accountId)
    const rows = store.core.database.query(`
      SELECT * FROM systems_saved_views
      WHERE project_id = ? AND owner_scope = ?
        AND ((? IS NULL AND account_id IS NULL) OR account_id = ?)
      ORDER BY lower(name), id
    `).all(id, identity.scope, identity.accountId, identity.accountId)
    return rows.map((row) => readView(store.core.database, row))
  }

  create(store, { projectId, accountId = null, input }) {
    const id = positiveId(projectId, 'Project ID')
    const identity = owner(accountId)
    const database = store.core.database
    const configuration = normalizeSystemsViewInput(input, { database, projectId: id })
    try {
      return database.transaction(() => {
        const at = this.now()
        const row = database.query(`
          INSERT INTO systems_saved_views (
            project_id, owner_scope, account_id, name, canvas_workspace_id, sort_key, sort_direction,
            density, is_default, revision, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?) RETURNING *
        `).get(id, identity.scope, identity.accountId, configuration.name, configuration.canvasWorkspaceId, configuration.sortKey, configuration.sortDirection, configuration.density, at, at)
        insertChildren(database, row.id, configuration)
        return readView(database, row)
      })()
    } catch (error) {
      mapConstraintError(error)
    }
  }

  replace(store, { projectId, accountId = null, viewId, expectedRevision, input }) {
    const project = positiveId(projectId, 'Project ID')
    const view = positiveId(viewId, 'Saved view ID')
    const revision = positiveId(expectedRevision, 'Expected revision')
    const database = store.core.database
    const configuration = normalizeSystemsViewInput(input, { database, projectId: project })
    try {
      return database.transaction(() => {
        const current = ownedView(database, project, accountId, view)
        if (!current) throw new SystemsViewError('Saved view was not found.', 'systems-view-not-found', 404)
        if (current.revision !== revision) throw new SystemsViewError('This saved view changed in another session.', 'systems-view-conflict', 409)
        const result = database.query(`
          UPDATE systems_saved_views SET name = ?, canvas_workspace_id = ?, sort_key = ?, sort_direction = ?, density = ?,
            revision = revision + 1, updated_at_ms = ?
          WHERE id = ? AND revision = ?
        `).run(configuration.name, configuration.canvasWorkspaceId, configuration.sortKey, configuration.sortDirection, configuration.density, this.now(), view, revision)
        if (result.changes !== 1) throw new SystemsViewError('This saved view changed in another session.', 'systems-view-conflict', 409)
        database.query('DELETE FROM systems_saved_view_filters WHERE saved_view_id = ?').run(view)
        database.query('DELETE FROM systems_saved_view_columns WHERE saved_view_id = ?').run(view)
        database.query('DELETE FROM systems_saved_view_metadata_filters WHERE saved_view_id = ?').run(view)
        insertChildren(database, view, configuration)
        return readView(database, ownedView(database, project, accountId, view))
      })()
    } catch (error) {
      if (error instanceof SystemsViewError) throw error
      mapConstraintError(error)
    }
  }

  delete(store, { projectId, accountId = null, viewId, expectedRevision }) {
    const project = positiveId(projectId, 'Project ID')
    const view = positiveId(viewId, 'Saved view ID')
    const revision = positiveId(expectedRevision, 'Expected revision')
    const current = ownedView(store.core.database, project, accountId, view)
    if (!current) throw new SystemsViewError('Saved view was not found.', 'systems-view-not-found', 404)
    const result = store.core.database.query('DELETE FROM systems_saved_views WHERE id = ? AND revision = ?').run(view, revision)
    if (result.changes !== 1) throw new SystemsViewError('This saved view changed in another session.', 'systems-view-conflict', 409)
    return { deleted: true, id: view }
  }

  setDefault(store, { projectId, accountId = null, viewId, expectedRevision }) {
    const project = positiveId(projectId, 'Project ID')
    const view = positiveId(viewId, 'Saved view ID')
    const revision = positiveId(expectedRevision, 'Expected revision')
    const identity = owner(accountId)
    const database = store.core.database
    return database.transaction(() => {
      const current = ownedView(database, project, accountId, view)
      if (!current) throw new SystemsViewError('Saved view was not found.', 'systems-view-not-found', 404)
      if (current.revision !== revision) throw new SystemsViewError('This saved view changed in another session.', 'systems-view-conflict', 409)
      database.query(`
        UPDATE systems_saved_views SET is_default = 0, updated_at_ms = ?
        WHERE project_id = ? AND owner_scope = ?
          AND ((? IS NULL AND account_id IS NULL) OR account_id = ?) AND is_default = 1
      `).run(this.now(), project, identity.scope, identity.accountId, identity.accountId)
      database.query(`UPDATE systems_saved_views SET is_default = 1, revision = revision + 1, updated_at_ms = ? WHERE id = ?`).run(this.now(), view)
      return readView(database, ownedView(database, project, accountId, view))
    })()
  }

  transferOpenViewsToAccount(store, accountId) {
    const account = positiveId(accountId, 'Account ID')
    const database = store.core.database
    return database.transaction(() => {
      const openViews = database.query(`SELECT * FROM systems_saved_views WHERE owner_scope = 'open-installation' ORDER BY id`).all()
      for (const view of openViews) {
        let name = view.name
        let suffix = 2
        while (database.query(`SELECT 1 FROM systems_saved_views WHERE project_id = ? AND account_id = ? AND lower(name) = lower(?)`).get(view.project_id, account, name)) {
          name = `${view.name} (${suffix++})`.slice(0, 80)
        }
        const existingDefault = database.query(`SELECT 1 FROM systems_saved_views WHERE project_id = ? AND account_id = ? AND is_default = 1`).get(view.project_id, account)
        database.query(`
          UPDATE systems_saved_views SET owner_scope = 'account', account_id = ?, name = ?,
            is_default = ?, revision = revision + 1, updated_at_ms = ? WHERE id = ?
        `).run(account, name, view.is_default === 1 && !existingDefault ? 1 : 0, this.now(), view.id)
      }
      return { transferred: openViews.length }
    })()
  }
}
