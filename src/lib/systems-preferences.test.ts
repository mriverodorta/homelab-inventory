import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SYSTEMS_TABLE_PREFERENCES,
  readSystemsTablePreferences,
  reconcileSystemsMetadataColumns,
  writeSystemsTablePreferences,
} from '@/lib/systems-preferences'
import type { CustomFieldDefinition } from '@/types/inventory-metadata'

function definition(id: number, archivedAt: string | null = null): CustomFieldDefinition {
  return {
    id,
    name: `Field ${id}`,
    description: null,
    fieldType: 'shortText',
    unit: null,
    numberMinimum: null,
    numberMaximum: null,
    numberPrecision: null,
    displayOrder: id,
    revision: 1,
    archivedAt,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    applicableItemTypes: ['server'],
    options: [],
  }
}

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
      canvasWorkspaceId: 4,
      sortKey: 'cpu' as const,
      sortDirection: 'descending' as const,
      density: 'comfortable' as const,
      columns: DEFAULT_SYSTEMS_TABLE_PREFERENCES.columns,
      metadataFilters: [],
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

  it('adds host metadata columns hidden and retains archived definitions already in a view', () => {
    const columns = reconcileSystemsMetadataColumns(
      [...DEFAULT_SYSTEMS_TABLE_PREFERENCES.columns, { key: 'custom-field:2', visible: true, order: 13 }],
      [definition(1), definition(2, '2026-08-19T00:00:00.000Z')],
    )
    expect(columns.find((column) => column.key === 'custom-field:1')).toMatchObject({ visible: false })
    expect(columns.find((column) => column.key === 'custom-field:2')).toMatchObject({ visible: true })
    expect(columns.find((column) => column.key === 'tags')).toMatchObject({ visible: false })
  })
})
