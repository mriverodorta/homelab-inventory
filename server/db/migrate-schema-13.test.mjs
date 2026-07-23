import { describe, expect, it } from 'vitest'
import { migrateSchema12To13 } from './migrate-schema-13.mjs'

function schema12Project() {
  return {
    id: 'default',
    metadata: { name: 'Lab', version: 1, updatedAt: '2026-07-22T12:00:00.000Z' },
    placements: [{ itemType: 'server', itemId: 1, x: 24, y: 48 }],
    assignments: [{
      id: 1,
      hostType: 'server',
      hostId: 1,
      itemType: 'cpu',
      itemId: 1,
      type: 'cpu',
      assignedAt: '2026-07-22T12:00:00.000Z',
    }],
    connections: [],
    compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
  }
}

describe('schema 12 to 13 project revision migration', () => {
  it('initializes revision without changing project relationships', () => {
    const source = schema12Project()
    const original = structuredClone(source)
    const migrated = migrateSchema12To13(source)

    expect(migrated).toEqual({ ...original, revision: 1 })
    expect(source).toEqual(original)
  })

  it('is idempotent and rejects invalid existing revisions', () => {
    const first = migrateSchema12To13(schema12Project())
    expect(migrateSchema12To13(first)).toEqual(first)
    expect(() => migrateSchema12To13({ ...schema12Project(), revision: 0 })).toThrow(
      /positive safe integer/,
    )
  })
})
