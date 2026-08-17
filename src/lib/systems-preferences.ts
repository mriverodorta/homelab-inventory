import type { SystemsHostType } from '@/types/systems'

export type SystemsSortKey = 'type' | 'name' | 'manufacturer' | 'cpu' | 'memory' | 'storage' | 'agent' | 'registry'
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
}>

export const DEFAULT_SYSTEMS_TABLE_PREFERENCES: SystemsTablePreferences = Object.freeze({
  query: '',
  types: [],
  registrations: [],
  registryStates: [],
  sortKey: 'name',
  sortDirection: 'ascending',
})

function storageKey(scope: string) {
  return `homelab-inventory:systems-table:${scope}:v1`
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
    const sortKeys: SystemsSortKey[] = ['type', 'name', 'manufacturer', 'cpu', 'memory', 'storage', 'agent', 'registry']
    return {
      query: typeof parsed.query === 'string' ? parsed.query.slice(0, 200) : '',
      types: allowedValues(parsed.types, ['server', 'nas', 'pcBuild']),
      registrations: allowedValues(parsed.registrations, ['registered', 'unregistered']),
      registryStates: allowedValues(parsed.registryStates, ['linked', 'unlinked']),
      sortKey: sortKeys.includes(parsed.sortKey as SystemsSortKey) ? parsed.sortKey as SystemsSortKey : 'name',
      sortDirection: parsed.sortDirection === 'descending' ? 'descending' : 'ascending',
    }
  } catch {
    return DEFAULT_SYSTEMS_TABLE_PREFERENCES
  }
}

export function writeSystemsTablePreferences(
  scope: string,
  preferences: SystemsTablePreferences,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  storage.setItem(storageKey(scope), JSON.stringify(preferences))
}
