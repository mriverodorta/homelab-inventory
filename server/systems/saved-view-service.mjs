const HOST_TYPES = ['server', 'nas', 'pcBuild']
const REGISTRATIONS = ['registered', 'unregistered']
const REGISTRY_STATES = ['linked', 'unlinked']
export const SYSTEMS_COLUMN_KEYS = [
  'type', 'name', 'manufacturer', 'cpu', 'memory', 'storage', 'attention',
  'agent', 'registry', 'operatingSystem', 'uptime', 'lanIp',
]
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

export function normalizeSystemsViewInput(input, { requireName = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SystemsViewError('Saved view configuration is required.', 'invalid-systems-view')
  const columnInput = Array.isArray(input.columns) ? input.columns : []
  if (columnInput.length !== SYSTEMS_COLUMN_KEYS.length) throw new SystemsViewError('Saved view columns are incomplete.', 'invalid-systems-view')
  const columns = columnInput.map((column, index) => ({
    key: String(column?.key ?? ''),
    visible: column?.visible === true,
    order: Number(column?.order ?? index),
  })).sort((left, right) => left.order - right.order)
  if (new Set(columns.map((column) => column.key)).size !== SYSTEMS_COLUMN_KEYS.length
    || columns.some((column) => !SYSTEMS_COLUMN_KEYS.includes(column.key))) {
    throw new SystemsViewError('Saved view columns must contain every supported column once.', 'invalid-systems-view')
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
  return {
    ...(requireName ? { name: cleanName(input.name) } : {}),
    types: enumArray(input.types ?? [], HOST_TYPES, 'System types'),
    registrations: enumArray(input.registrations ?? [], REGISTRATIONS, 'Agent registrations'),
    registryStates: enumArray(input.registryStates ?? [], REGISTRY_STATES, 'Registry states'),
    sortKey,
    sortDirection,
    density,
    columns,
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
      sortKey: row.sort_key,
      sortDirection: row.sort_direction,
      density: row.density,
      columns: columns.map((column) => ({ key: column.column_key, visible: column.visible === 1, order: column.display_order })),
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
  const column = database.query(`INSERT INTO systems_saved_view_columns (saved_view_id, column_key, visible, display_order) VALUES (?, ?, ?, ?)`)
  for (const entry of configuration.columns) column.run(viewId, entry.key, entry.visible ? 1 : 0, entry.order)
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
    const configuration = normalizeSystemsViewInput(input)
    const database = store.core.database
    try {
      return database.transaction(() => {
        const at = this.now()
        const row = database.query(`
          INSERT INTO systems_saved_views (
            project_id, owner_scope, account_id, name, sort_key, sort_direction,
            density, is_default, revision, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?) RETURNING *
        `).get(id, identity.scope, identity.accountId, configuration.name, configuration.sortKey, configuration.sortDirection, configuration.density, at, at)
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
    const configuration = normalizeSystemsViewInput(input)
    const database = store.core.database
    try {
      return database.transaction(() => {
        const current = ownedView(database, project, accountId, view)
        if (!current) throw new SystemsViewError('Saved view was not found.', 'systems-view-not-found', 404)
        if (current.revision !== revision) throw new SystemsViewError('This saved view changed in another session.', 'systems-view-conflict', 409)
        const result = database.query(`
          UPDATE systems_saved_views SET name = ?, sort_key = ?, sort_direction = ?, density = ?,
            revision = revision + 1, updated_at_ms = ?
          WHERE id = ? AND revision = ?
        `).run(configuration.name, configuration.sortKey, configuration.sortDirection, configuration.density, this.now(), view, revision)
        if (result.changes !== 1) throw new SystemsViewError('This saved view changed in another session.', 'systems-view-conflict', 409)
        database.query('DELETE FROM systems_saved_view_filters WHERE saved_view_id = ?').run(view)
        database.query('DELETE FROM systems_saved_view_columns WHERE saved_view_id = ?').run(view)
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
