import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVENTORY_SIDEBAR_PREFERENCES,
  clearInventorySidebarPreferences,
  readInventorySidebarPreferences,
  writeInventorySidebarPreferences,
} from '@/lib/inventory-sidebar-preferences'

function storageFixture() {
  const values = new Map<string, string>()
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    },
  }
}

describe('inventory sidebar preferences', () => {
  it('returns defaults when no scoped record exists', () => {
    const { storage } = storageFixture()

    expect(readInventorySidebarPreferences('account:1:project:1:workspace:2', storage))
      .toEqual(DEFAULT_INVENTORY_SIDEBAR_PREFERENCES)
  })

  it('round trips durable view state without selection state', () => {
    const { storage, values } = storageFixture()
    const scope = 'account:1:project:1:workspace:2'

    writeInventorySidebarPreferences(scope, {
      version: 1,
      filters: { query: '7090', type: 'server', status: 'assigned', sort: 'name' },
      metadataFilters: [
        { operator: 'tags-any', tagIds: [3, 1, 3] },
        { operator: 'contains', definitionId: 4, text: 'production' },
      ],
      collapsedTypes: ['storage', 'cpu', 'storage'],
    }, storage)

    expect(readInventorySidebarPreferences(scope, storage)).toEqual({
      version: 1,
      filters: { query: '7090', type: 'server', status: 'assigned', sort: 'name' },
      metadataFilters: [
        { operator: 'tags-any', tagIds: [1, 3] },
        { operator: 'contains', definitionId: 4, text: 'production' },
      ],
      collapsedTypes: ['cpu', 'storage'],
    })
    expect([...values.values()][0]).not.toContain('selectedItemIds')
    expect([...values.values()][0]).not.toContain('selectionMode')
  })

  it('isolates records by account, project, and workspace scope', () => {
    const { storage } = storageFixture()
    const first = 'account:1:project:1:workspace:2'
    const second = 'device:anonymous:project:1:workspace:3'

    writeInventorySidebarPreferences(first, {
      ...DEFAULT_INVENTORY_SIDEBAR_PREFERENCES,
      filters: { ...DEFAULT_INVENTORY_SIDEBAR_PREFERENCES.filters, query: 'first' },
    }, storage)
    writeInventorySidebarPreferences(second, {
      ...DEFAULT_INVENTORY_SIDEBAR_PREFERENCES,
      filters: { ...DEFAULT_INVENTORY_SIDEBAR_PREFERENCES.filters, query: 'second' },
    }, storage)

    expect(readInventorySidebarPreferences(first, storage).filters.query).toBe('first')
    expect(readInventorySidebarPreferences(second, storage).filters.query).toBe('second')
  })

  it('falls back per field for corrupt and obsolete values', () => {
    const { storage, values } = storageFixture()
    const scope = 'account:1:project:1:workspace:2'
    values.set(`homelab-inventory:inventory-sidebar:v1:${scope}`, JSON.stringify({
      version: 99,
      filters: {
        query: 12,
        type: 'not-real',
        status: 'assigned',
        sort: 'wrong',
      },
      metadataFilters: [
        { operator: 'contains', definitionId: -1, text: 'bad' },
        { operator: 'set', definitionId: 8 },
        { operator: 'tags-any', tagIds: [2, -4, 2] },
      ],
      collapsedTypes: ['ram', 'not-real', 'ram'],
    }))

    expect(readInventorySidebarPreferences(scope, storage)).toEqual({
      version: 1,
      filters: { query: '', type: 'all', status: 'assigned', sort: 'type' },
      metadataFilters: [
        { operator: 'set', definitionId: 8 },
        { operator: 'tags-any', tagIds: [2] },
      ],
      collapsedTypes: ['ram'],
    })
  })

  it('clears only the requested scoped record', () => {
    const { storage } = storageFixture()
    const first = 'account:1:project:1:workspace:2'
    const second = 'account:1:project:1:workspace:3'
    writeInventorySidebarPreferences(first, DEFAULT_INVENTORY_SIDEBAR_PREFERENCES, storage)
    writeInventorySidebarPreferences(second, DEFAULT_INVENTORY_SIDEBAR_PREFERENCES, storage)

    clearInventorySidebarPreferences(first, storage)

    expect(readInventorySidebarPreferences(first, storage)).toEqual(DEFAULT_INVENTORY_SIDEBAR_PREFERENCES)
    expect(readInventorySidebarPreferences(second, storage)).toEqual(DEFAULT_INVENTORY_SIDEBAR_PREFERENCES)
  })
})
