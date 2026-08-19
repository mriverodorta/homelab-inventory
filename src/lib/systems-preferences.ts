import type { CustomFieldDefinition, InventoryMetadataFilter } from '@/types/inventory-metadata'
import type { SystemsBaseColumnKey, SystemsColumnKey, SystemsDensity, SystemsHostType, SystemsViewColumn } from '@/types/systems'

export type SystemsSortKey = SystemsBaseColumnKey
export type SystemsSortDirection = 'ascending' | 'descending'
export type SystemsRegistrationFilter = 'registered' | 'unregistered'
export type SystemsRegistryFilter = 'linked' | 'unlinked'

export type SystemsTablePreferences = Readonly<{
  query: string
  types: readonly SystemsHostType[]
  registrations: readonly SystemsRegistrationFilter[]
  registryStates: readonly SystemsRegistryFilter[]
  sortKey: SystemsSortKey
  sortDirection: SystemsSortDirection
  density: SystemsDensity
  columns: readonly SystemsViewColumn[]
  metadataFilters: readonly InventoryMetadataFilter[]
  activeViewId: number | null
}>

export const SYSTEMS_BASE_COLUMN_KEYS: readonly SystemsBaseColumnKey[] = [
  'type', 'name', 'manufacturer', 'cpu', 'memory', 'storage', 'attention',
  'agent', 'registry', 'operatingSystem', 'uptime', 'lanIp',
]

export const DEFAULT_SYSTEMS_COLUMNS: readonly SystemsViewColumn[] = [
  ...SYSTEMS_BASE_COLUMN_KEYS.map((key, order) => ({
    key,
    order,
    visible: !['operatingSystem', 'uptime', 'lanIp'].includes(key),
  })),
  { key: 'tags', order: SYSTEMS_BASE_COLUMN_KEYS.length, visible: false },
]

export const DEFAULT_SYSTEMS_TABLE_PREFERENCES: SystemsTablePreferences = Object.freeze({
  query: '',
  types: [],
  registrations: [],
  registryStates: [],
  sortKey: 'name',
  sortDirection: 'ascending',
  density: 'dense',
  columns: DEFAULT_SYSTEMS_COLUMNS,
  metadataFilters: [],
  activeViewId: null,
})

function storageKey(scope: string) {
  return `homelab-inventory:systems-table:${scope}:v2`
}

function allowedValues<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return []
  const allowedSet = new Set(allowed)
  return [...new Set(value.filter((entry): entry is T => typeof entry === 'string' && allowedSet.has(entry as T)))]
}

export function customFieldIdFromSystemsColumn(key: string) {
  const match = /^custom-field:([1-9]\d*)$/u.exec(key)
  if (!match) return null
  const definitionId = Number(match[1])
  return Number.isSafeInteger(definitionId) ? definitionId : null
}

export function isSystemsColumnKey(value: unknown): value is SystemsColumnKey {
  return typeof value === 'string'
    && (value === 'tags' || SYSTEMS_BASE_COLUMN_KEYS.includes(value as SystemsBaseColumnKey) || customFieldIdFromSystemsColumn(value) !== null)
}

export function reconcileSystemsMetadataColumns(
  columns: readonly SystemsViewColumn[],
  definitions: readonly CustomFieldDefinition[],
) {
  const definitionIds = new Set(definitions.map((definition) => definition.id))
  const activeHostDefinitionIds = definitions
    .filter((definition) => !definition.archivedAt && definition.applicableItemTypes.some((type) => ['server', 'nas', 'pcBuild'].includes(type)))
    .map((definition) => definition.id)
  const retained = columns.filter((column) => {
    const definitionId = customFieldIdFromSystemsColumn(column.key)
    return definitionId === null || definitionIds.has(definitionId)
  })
  const existing = new Set(retained.map((column) => column.key))
  const complete = [...retained]
  if (!existing.has('tags')) complete.push({ key: 'tags', visible: false, order: complete.length })
  for (const definitionId of activeHostDefinitionIds) {
    const key = `custom-field:${definitionId}` as const
    if (!existing.has(key)) complete.push({ key, visible: false, order: complete.length })
  }
  return complete.map((column, order) => ({
    ...column,
    order,
    visible: order < 2 ? true : column.visible,
  }))
}

function metadataFilters(value: unknown): InventoryMetadataFilter[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is InventoryMetadataFilter => {
    if (!entry || typeof entry !== 'object' || !('operator' in entry)) return false
    const operator = String(entry.operator)
    if (['has-tags', 'no-tags'].includes(operator)) return true
    if (operator === 'tags-any') return 'tagIds' in entry && Array.isArray(entry.tagIds)
    return 'definitionId' in entry && Number.isSafeInteger(Number(entry.definitionId)) && Number(entry.definitionId) > 0
  }).slice(0, 25)
}

export function readSystemsTablePreferences(
  scope: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): SystemsTablePreferences {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(scope)) ?? '{}') as Record<string, unknown>
    const sortKeys = SYSTEMS_BASE_COLUMN_KEYS
    const persistedColumns = Array.isArray(parsed.columns) ? parsed.columns : []
    const ordered = persistedColumns.map((entry, order) => {
      const candidate = entry as Record<string, unknown>
      return { key: candidate.key, visible: candidate.visible === true, order }
    }).filter((entry): entry is SystemsViewColumn => isSystemsColumnKey(entry.key))
    const hasEveryBaseColumn = SYSTEMS_BASE_COLUMN_KEYS.every((key) => ordered.some((column) => column.key === key))
    const columns = new Set(ordered.map((column) => column.key)).size === ordered.length
      && hasEveryBaseColumn
      && ordered[0]?.key === 'type' && ordered[1]?.key === 'name'
      ? ordered.map((column, order) => ({ ...column, order, visible: order < 2 ? true : column.visible }))
      : DEFAULT_SYSTEMS_COLUMNS
    return {
      query: typeof parsed.query === 'string' ? parsed.query.slice(0, 200) : '',
      types: allowedValues(parsed.types, ['server', 'nas', 'pcBuild']),
      registrations: allowedValues(parsed.registrations, ['registered', 'unregistered']),
      registryStates: allowedValues(parsed.registryStates, ['linked', 'unlinked']),
      sortKey: sortKeys.includes(parsed.sortKey as SystemsSortKey) ? parsed.sortKey as SystemsSortKey : 'name',
      sortDirection: parsed.sortDirection === 'descending' ? 'descending' : 'ascending',
      density: parsed.density === 'comfortable' ? 'comfortable' : 'dense',
      columns,
      metadataFilters: metadataFilters(parsed.metadataFilters),
      activeViewId: Number.isSafeInteger(parsed.activeViewId) && Number(parsed.activeViewId) > 0 ? Number(parsed.activeViewId) : null,
    }
  } catch {
    return DEFAULT_SYSTEMS_TABLE_PREFERENCES
  }
}

function widthsKey(scope: string, viewId: number | null) {
  return `homelab-inventory:systems-widths:${scope}:view:${viewId ?? 'builtin'}:v1`
}

export function readSystemsColumnWidths(scope: string, viewId: number | null, storage: Pick<Storage, 'getItem'> = window.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(widthsKey(scope, viewId)) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(value).filter(([key, width]) => (
      isSystemsColumnKey(key) && Number.isFinite(width) && Number(width) >= 40 && Number(width) <= 800
    )).map(([key, width]) => [key, Number(width)])) as Partial<Record<SystemsColumnKey, number>>
  } catch {
    return {}
  }
}

export function writeSystemsColumnWidths(scope: string, viewId: number | null, widths: Partial<Record<SystemsColumnKey, number>>, storage: Pick<Storage, 'setItem'> = window.localStorage) {
  storage.setItem(widthsKey(scope, viewId), JSON.stringify(widths))
}

export function writeSystemsTablePreferences(
  scope: string,
  preferences: SystemsTablePreferences,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  storage.setItem(storageKey(scope), JSON.stringify(preferences))
}
