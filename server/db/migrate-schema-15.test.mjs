import { describe, expect, it } from 'vitest'
import { migrateSchema14To15 } from './migrate-schema-15.mjs'

describe('schema 14 to 15 registry migration', () => {
  it('creates registry defaults without requiring legacy data', () => {
    expect(migrateSchema14To15(undefined)).toMatchObject({
      settings: {
        mode: 'disabled',
        defaultInventorySource: 'catalog',
        automaticContributions: false,
      },
      privateTemplates: [],
      links: [],
    })
  })

  it('preserves valid local preferences', () => {
    expect(migrateSchema14To15({
      settings: {
        mode: 'offline',
        defaultInventorySource: 'manual',
        automaticContributions: false,
        updatedAt: '2026-07-26T12:00:00.000Z',
      },
    }).settings).toEqual({
      mode: 'offline',
      defaultInventorySource: 'manual',
      automaticContributions: false,
      updatedAt: '2026-07-26T12:00:00.000Z',
    })
  })
})
