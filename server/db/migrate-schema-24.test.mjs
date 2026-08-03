import { describe, expect, it } from 'vitest'
import { migrateSchema23To24 } from './migrate-schema-24.mjs'

function schema23Inventory() {
  return {
    servers: [{
      id: 1,
      type: 'server',
      name: 'Compact workstation',
      hardwareClass: 'workstation',
      usageRole: 'server',
      compatibility: {
        host: {
          storageSlots: [{ id: 3, key: 'nvme', label: 'NVMe', count: 2 }],
          controllerSlots: [{ key: 'raid', label: 'RAID controller', count: 1 }],
        },
      },
    }],
    nas: [{ id: 1, type: 'nas', name: 'Storage host' }],
    pcBuilds: [],
    motherboards: [],
  }
}

describe('schema 24 workstation and conventional-server topology migration', () => {
  it('preserves physical and usage classes while initializing topology arrays and numeric IDs', () => {
    const source = schema23Inventory()
    const migrated = migrateSchema23To24(source)
    const server = migrated.inventory.servers[0]
    const nas = migrated.inventory.nas[0]

    expect(server).toMatchObject({ hardwareClass: 'workstation', usageRole: 'server' })
    expect(server.compatibility.host.storageSlots[0].id).toBe(3)
    expect(server.compatibility.host.controllerSlots[0].id).toBe(1)
    for (const collection of [
      'storageSlots',
      'expansionSlots',
      'optionalModuleSlots',
      'controllerSlots',
      'bootDeviceSlots',
      'coolingProfiles',
      'constraintGroups',
      'fixedPorts',
    ]) {
      expect(server.compatibility.host[collection]).toBeInstanceOf(Array)
      expect(nas.compatibility.host[collection]).toBeInstanceOf(Array)
    }
    expect(source.servers[0].compatibility.host.controllerSlots[0].id).toBeUndefined()
  })

  it('is idempotent after the first successful migration', () => {
    const first = migrateSchema23To24(schema23Inventory())
    const second = migrateSchema23To24(first.inventory)
    expect(second.inventory).toEqual(first.inventory)
    expect(second.summary.initializedCollections).toBe(0)
    expect(second.summary.assignedResourceIds).toBe(0)
  })

  it('rejects duplicate persisted IDs instead of guessing topology relationships', () => {
    const source = schema23Inventory()
    source.servers[0].compatibility.host.controllerSlots = [
      { id: 1, key: 'first', label: 'First controller', count: 1 },
      { id: 1, key: 'second', label: 'Second controller', count: 1 },
    ]
    expect(() => migrateSchema23To24(source)).toThrow('unique positive safe integer')
  })

  it('preserves unknown fields for forward-safe registry round trips', () => {
    const source = schema23Inventory()
    source.servers[0].compatibility.host.futureTopology = { opaque: true }
    const migrated = migrateSchema23To24(source)
    expect(migrated.inventory.servers[0].compatibility.host.futureTopology).toEqual({ opaque: true })
  })
})
