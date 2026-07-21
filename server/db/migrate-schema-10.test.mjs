import { describe, expect, it } from 'vitest'

import { migrateSchema9To10 } from './migrate-schema-10.mjs'

function legacyStores() {
  return {
    inventory: {
      servers: [{
        id: '1',
        name: 'Host',
        ports: [{
          id: '1',
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 1,
        }],
        compatibility: {
          host: {
            storageSlots: [{
              id: 'm2-primary',
              label: 'Primary M.2',
              count: 1,
              interfaces: ['NVMe'],
            }],
          },
        },
      }],
      storage: [{ id: '1', name: 'Storage' }],
      patchPanels: [{
        id: '1',
        name: 'Panel',
        ports: [{
          id: '1',
          kind: 'keystone',
          type: 'rj45',
          slotNumber: 1,
          endpoints: [
            { id: '1', side: 'front' },
            { id: '2', side: 'back' },
          ],
        }],
      }],
      upsSystems: [{
        id: '1',
        name: 'UPS',
        specs: { batteryBackupOutlets: 2, surgeProtectedOutlets: 1 },
      }],
      powerStrips: [{ id: '1', name: 'Power strip', specs: { outlets: 2 } }],
    },
    project: {
      id: 'default',
      placements: [{ itemType: 'server', itemId: '1', x: 10, y: 20 }],
      assignments: [{
        id: '1',
        hostType: 'server',
        hostId: '1',
        itemType: 'storage',
        itemId: '1',
        type: 'storage',
        allocation: {
          resourceType: 'storage',
          groupId: 'm2-primary',
          positions: [0],
        },
      }],
      connections: [{
        id: '1',
        type: 'power',
        createdAt: '2026-07-20T00:00:00.000Z',
        from: { itemType: 'ups', itemId: '1', portId: 'outlet-2' },
        to: { itemType: 'powerStrip', itemId: '1', portId: 'ac-input' },
      }],
      compatibilityPolicy: {
        disabledHostIds: ['server:1'],
        ignoredWarningIds: ['warning-1'],
      },
    },
    agents: {
      enrollments: {
        1: { id: '1', serverId: 'server:1' },
      },
      devices: {
        2: { id: '2', serverId: '1' },
      },
    },
    agentStatus: {
      servers: {
        1: { serverId: 'server:1', state: 'online' },
      },
    },
  }
}

describe('schema 9 to 10 relational ID migration', () => {
  it('materializes numeric primary and foreign keys without changing semantic keys', () => {
    const stores = legacyStores()
    const migrated = migrateSchema9To10(
      stores.inventory,
      stores.project,
      stores.agents,
      stores.agentStatus,
    )

    const server = migrated.inventory.servers[0]
    expect(server.id).toBe(1)
    expect(server.ports[0].id).toBe(1)
    expect(server.compatibility.host.storageSlots[0]).toMatchObject({
      id: 1,
      key: 'm2-primary',
    })
    expect(migrated.inventory.patchPanels[0].ports[0].endpoints).toEqual([
      { id: 1, side: 'front' },
      { id: 2, side: 'back' },
    ])

    expect(migrated.project.placements[0].itemId).toBe(1)
    expect(migrated.project.assignments[0]).toMatchObject({
      id: 1,
      hostId: 1,
      itemId: 1,
      allocation: { groupId: 1 },
    })
    expect(migrated.project.connections[0]).toMatchObject({
      id: 1,
      from: { itemId: 1, portId: 2 },
      to: { itemId: 1, portId: 1 },
    })
    expect(migrated.project.compatibilityPolicy).toEqual({
      disabledHosts: [{ hostType: 'server', hostId: 1 }],
      ignoredWarningIds: ['warning-1'],
    })
    expect(migrated.agents.enrollments['1']).toMatchObject({ id: 1, serverId: 1 })
    expect(migrated.agents.devices['2']).toMatchObject({ id: 2, serverId: 1 })
    expect(migrated.agentStatus.servers['1']).toMatchObject({ serverId: 1 })
  })

  it('rejects a connection endpoint that cannot resolve to exactly one owner port', () => {
    const stores = legacyStores()
    stores.project.connections[0].from.portId = 'missing-port'

    expect(() => migrateSchema9To10(
      stores.inventory,
      stores.project,
      stores.agents,
      stores.agentStatus,
    )).toThrow('cannot be resolved unambiguously')
  })

  it('rejects nested port ID collisions created by numeric conversion', () => {
    const stores = legacyStores()
    stores.inventory.servers[0].ports.push({
      id: 1,
      kind: 'server-port',
      type: 'displayport',
      slotNumber: 2,
    })

    expect(() => migrateSchema9To10(
      stores.inventory,
      stores.project,
      stores.agents,
      stores.agentStatus,
    )).toThrow('ports contains duplicate ID 1')
  })
})
