import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SYSTEMS_TABLE_PREFERENCES,
  readSystemsTablePreferences,
  writeSystemsTablePreferences,
} from '@/lib/systems-preferences'

describe('Systems table preferences', () => {
  it('round trips scoped filters and sorting', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const preference = {
      query: 'micro',
      types: ['server'] as const,
      registrations: ['registered'] as const,
      registryStates: ['unlinked'] as const,
      sortKey: 'cpu' as const,
      sortDirection: 'descending' as const,
      density: 'comfortable' as const,
      columns: DEFAULT_SYSTEMS_TABLE_PREFERENCES.columns,
      activeViewId: 3,
    }
    writeSystemsTablePreferences('account:7:project:2', preference, storage)
    expect(readSystemsTablePreferences('account:7:project:2', storage)).toEqual(preference)
    expect(readSystemsTablePreferences('account:7:project:3', storage)).toEqual(DEFAULT_SYSTEMS_TABLE_PREFERENCES)
  })

  it('drops invalid persisted values', () => {
    const storage = { getItem: () => JSON.stringify({ types: ['nas', 'gpu'], sortKey: 'wat', sortDirection: 'sideways' }) }
    expect(readSystemsTablePreferences('device:anonymous:project:1', storage)).toMatchObject({
      types: ['nas'],
      sortKey: 'name',
      sortDirection: 'ascending',
    })
  })
})
