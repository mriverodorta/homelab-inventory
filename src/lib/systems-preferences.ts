import type { SystemsColumnKey, SystemsDensity, SystemsHostType, SystemsViewColumn } from '@/types/systems'

export type SystemsSortKey = SystemsColumnKey
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
  activeViewId: number | null
}>

export const SYSTEMS_COLUMN_KEYS: readonly SystemsColumnKey[] = [
  'type', 'name', 'manufacturer', 'cpu', 'memory', 'storage', 'attention',
  'agent', 'registry', 'operatingSystem', 'uptime', 'lanIp',
]

export const DEFAULT_SYSTEMS_COLUMNS: readonly SystemsViewColumn[] = SYSTEMS_COLUMN_KEYS.map((key, order) => ({
  key,
  order,
  visible: !['operatingSystem', 'uptime', 'lanIp'].includes(key),
}))

export const DEFAULT_SYSTEMS_TABLE_PREFERENCES: SystemsTablePreferences = Object.freeze({
  query: '',
  types: [],
  registrations: [],
  registryStates: [],
  sortKey: 'name',
  sortDirection: 'ascending',
  density: 'dense',
  columns: DEFAULT_SYSTEMS_COLUMNS,
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

export function readSystemsTablePreferences(
  scope: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): SystemsTablePreferences {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(scope)) ?? '{}') as Record<string, unknown>
    const sortKeys = SYSTEMS_COLUMN_KEYS
    const persistedColumns = Array.isArray(parsed.columns) ? parsed.columns : []
    const ordered = persistedColumns.map((entry, order) => {
      const candidate = entry as Record<string, unknown>
      return { key: candidate.key, visible: candidate.visible === true, order }
    }).filter((entry): entry is SystemsViewColumn => typeof entry.key === 'string' && SYSTEMS_COLUMN_KEYS.includes(entry.key as SystemsColumnKey))
    const columns = new Set(ordered.map((column) => column.key)).size === SYSTEMS_COLUMN_KEYS.length
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
      SYSTEMS_COLUMN_KEYS.includes(key as SystemsColumnKey) && Number.isFinite(width) && Number(width) >= 40 && Number(width) <= 800
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
