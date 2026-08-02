import { describe, expect, it } from 'vitest'
import { migrateSchema21To22 } from './migrate-schema-22.mjs'

function schema21Stores() {
  return {
    inventory: {
      servers: [{
        id: 1,
        type: 'server',
        name: 'OEM Mini used as a server',
        hardwareClass: 'desktop',
        usageRole: 'server',
        ports: [{ id: 1, key: 'lan-1', type: 'rj45' }],
        compatibility: {
          host: {
            storageSlots: [
              { id: 2, key: 'sata', label: 'SATA bay', count: 1 },
              { key: 'nvme', label: 'NVMe slot', count: 1 },
            ],
            expansionSlots: [{ key: 'pcie', label: 'PCIe slot', count: 1 }],
            optionalModuleSlots: [{ key: 'wlan', label: 'WLAN', count: 1 }],
            fixedPorts: [{ key: 'fixed-lan', label: 'LAN', count: 1 }],
          },
        },
      }],
      networkCards: [{
        id: 1,
        type: 'network',
        name: 'Module NIC',
        ports: [{ id: 1, key: 'nic-1', type: 'rj45' }],
      }],
    },
    registry: {
      links: [{
        id: 1,
        itemType: 'server',
        itemId: 1,
        sourceId: 1,
        templateKey: 'desktop-oem-mini',
        importedRevision: 1,
        importedContentHash: 'a'.repeat(64),
        state: 'linked',
      }],
    },
  }
}

describe('schema 22 OEM catalog migration', () => {
  it('preserves local roles while adding numeric resources, port origins, and v4 matching stores', () => {
    const source = schema21Stores()
    const migrated = migrateSchema21To22(source.inventory, source.registry)
    const server = migrated.inventory.servers[0]

    expect(server).toMatchObject({
      id: 1,
      hardwareClass: 'desktop',
      usageRole: 'server',
      ports: [{ id: 1, origin: 'fixed' }],
    })
    expect(server.compatibility.host.storageSlots.map((group) => group.id)).toEqual([2, 1])
    expect(server.compatibility.host.expansionSlots[0].id).toBe(1)
    expect(server.compatibility.host.optionalModuleSlots[0].id).toBe(1)
    expect(server.compatibility.host.fixedPorts[0].id).toBe(1)
    expect(migrated.inventory.networkCards[0].ports[0].origin).toBe('module')
    expect(migrated.registry.variantMatches).toEqual([])
    expect(migrated.registry.links[0].importedFingerprintVersion).toBe(2)
    expect(source.inventory.servers[0].ports[0].origin).toBeUndefined()
  })

  it('is idempotent after the first successful migration', () => {
    const source = schema21Stores()
    const first = migrateSchema21To22(source.inventory, source.registry)
    const second = migrateSchema21To22(first.inventory, first.registry)

    expect(second.inventory).toEqual(first.inventory)
    expect(second.registry).toEqual(first.registry)
    expect(second.summary.assignedResourceIds).toBe(0)
    expect(second.summary.normalizedPorts).toBe(0)
  })

  it('rejects duplicate persisted resource IDs instead of guessing relationships', () => {
    const source = schema21Stores()
    source.inventory.servers[0].compatibility.host.storageSlots = [
      { id: 1, key: 'first', label: 'First', count: 1 },
      { id: 1, key: 'second', label: 'Second', count: 1 },
    ]

    expect(() => migrateSchema21To22(source.inventory, source.registry)).toThrow(
      'must be a unique positive safe integer',
    )
  })
})
