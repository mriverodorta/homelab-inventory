import { describe, expect, it } from 'vitest'
import { migrateSchema18To19 } from './migrate-schema-19.mjs'

describe('schema 19 catalog fingerprint migration', () => {
  it('marks existing registry relationships and delivery records as protocol v2', () => {
    const input = {
      links: [{ id: 1, itemType: 'cpu', itemId: 2, importedRevision: 1 }],
      contributionOutbox: [{ id: 1, identityHash: 'a'.repeat(64) }],
      contributionLedger: [{ id: 2, contentHash: 'b'.repeat(64) }],
      contributionGroups: [{ id: 3, identityHash: 'c'.repeat(64) }],
      projectionCache: [{ id: 4, identityHash: 'd'.repeat(64) }],
    }

    const result = migrateSchema18To19(input)

    expect(result.registry.links[0].importedFingerprintVersion).toBe(2)
    for (const collection of ['contributionOutbox', 'contributionLedger', 'contributionGroups', 'projectionCache']) {
      expect(result.registry[collection][0].fingerprintVersion).toBe(2)
    }
    expect(result.summary).toEqual({ initializedRecords: 5, links: 1, fingerprintVersion: 2 })
    expect(input.links[0]).not.toHaveProperty('importedFingerprintVersion')
  })

  it('preserves explicit versions and is idempotent', () => {
    const input = {
      links: [{ id: 1, importedFingerprintVersion: 3 }],
      contributionOutbox: [{ id: 1, fingerprintVersion: 3 }],
      contributionLedger: [], contributionGroups: [], projectionCache: [],
    }
    const first = migrateSchema18To19(input)
    const second = migrateSchema18To19(first.registry)

    expect(second.registry).toEqual(first.registry)
    expect(second.summary.initializedRecords).toBe(0)
  })
})
