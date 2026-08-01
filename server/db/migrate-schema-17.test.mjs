import { describe, expect, it } from 'vitest'
import { createRegistryStore } from '../registry/model.mjs'
import { migrateSchema16To17 } from './migrate-schema-17.mjs'

describe('schema 17 registry adoption migration', () => {
  it('preserves existing registry relationships and enables the adoption link state', () => {
    const registry = createRegistryStore()
    registry.settings.mode = 'connected'
    registry.sources.push({ id: 1, kind: 'official-connected', displayName: 'Official Catalog' })
    registry.links.push({
      id: 1,
      itemType: 'cpu',
      itemId: 4,
      sourceId: 1,
      templateKey: 'cpu-example-core-c1',
      importedRevision: 1,
      importedContentHash: 'a'.repeat(64),
      state: 'linked',
      linkedAt: '2026-07-31T12:00:00.000Z',
    })

    const migrated = migrateSchema16To17(registry)

    expect(migrated.registry).toEqual(registry)
    expect(migrated.summary).toEqual({ catalogLinks: 1, adoptionLinks: 0 })
  })

  it('normalizes missing registry defaults without inventing relationships', () => {
    const migrated = migrateSchema16To17({ settings: { mode: 'disabled' } })

    expect(migrated.registry.links).toEqual([])
    expect(migrated.registry.settings.showRegistryLinkIndicators).toBe(false)
    expect(migrated.summary).toEqual({ catalogLinks: 0, adoptionLinks: 0 })
  })
})
