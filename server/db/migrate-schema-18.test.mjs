import { describe, expect, it } from 'vitest'
import { migrateSchema17To18 } from './migrate-schema-18.mjs'

describe('schema 18 equipment classification migration', () => {
  it('classifies legacy OEM equipment as desktop hardware used as servers', () => {
    const result = migrateSchema17To18({ servers: [{ id: 1, name: 'Mini PC', type: 'server' }] })

    expect(result.inventory.servers[0]).toMatchObject({
      id: 1,
      hardwareClass: 'desktop',
      usageRole: 'server',
    })
    expect(result.summary).toEqual({
      servers: 1,
      defaultedHardwareClass: 1,
      defaultedUsageRole: 1,
    })
  })

  it('preserves explicit physical classes and local roles', () => {
    const inventory = {
      servers: [
        { id: 1, name: 'Rack server', type: 'server', hardwareClass: 'server', usageRole: 'server' },
        { id: 2, name: 'Gaming PC', type: 'server', hardwareClass: 'desktop', usageRole: 'workstation' },
      ],
    }

    const result = migrateSchema17To18(inventory)

    expect(result.inventory).toEqual(inventory)
    expect(result.summary).toEqual({
      servers: 2,
      defaultedHardwareClass: 0,
      defaultedUsageRole: 0,
    })
  })

  it('is idempotent', () => {
    const first = migrateSchema17To18({ servers: [{ id: 1, name: 'Mini PC', type: 'server' }] })
    const second = migrateSchema17To18(first.inventory)

    expect(second.inventory).toEqual(first.inventory)
    expect(second.summary.defaultedHardwareClass).toBe(0)
    expect(second.summary.defaultedUsageRole).toBe(0)
  })
})
