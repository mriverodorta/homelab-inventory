import { describe, expect, it } from 'vitest'
import { migrateSchema25To26 } from './migrate-schema-26.mjs'

describe('schema 25 to 26 migration', () => {
  it('adds empty hardware collections without changing agent identity records', () => {
    const source = {
      enrollments: { 1: { id: 1, hostType: 'server', hostId: 2, tokenHash: 'private' } },
      devices: { 3: { id: 3, hostType: 'server', hostId: 2, publicKey: 'public' } },
    }
    const migrated = migrateSchema25To26(source)
    expect(migrated.agents).toEqual({ ...source, hardwareSnapshots: {}, hardwareEvents: {} })
    expect(source).not.toHaveProperty('hardwareSnapshots')
  })

  it('rejects malformed or prematurely populated stores', () => {
    expect(() => migrateSchema25To26({ enrollments: [], devices: {} })).toThrow('enrollments')
    expect(migrateSchema25To26({ enrollments: {}, devices: {}, hardwareSnapshots: {}, hardwareEvents: {} }).agents).toEqual({
      enrollments: {}, devices: {}, hardwareSnapshots: {}, hardwareEvents: {},
    })
    expect(() => migrateSchema25To26({ enrollments: {}, devices: {}, hardwareSnapshots: {} })).toThrow('incomplete')
    expect(() => migrateSchema25To26({ enrollments: {}, devices: {}, hardwareSnapshots: { 1: {} }, hardwareEvents: {} })).toThrow('populated')
  })
})
