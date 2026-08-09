import { describe, expect, it } from 'vitest'
import { createRegistryStore } from '../registry/model.mjs'
import { createRoutingCache } from '../routing-cache-model.mjs'
import { migrateSchema26To27 } from './migrate-schema-27.mjs'

function inventory() {
  return {
    servers: [], pcBuilds: [], cpus: [], ram: [], storage: [], networkCards: [], gpus: [],
    motherboards: [{
      id: 1,
      type: 'motherboard',
      name: 'ASUS PRIME Z690-P D4',
      aliases: ['PRIME Z690-P D4-CSM'],
      ports: [{ id: 1, key: 'lan-1', kind: 'network', type: 'rj45', slotNumber: 1, speed: '2.5G', origin: 'fixed' }],
      compatibility: {
        host: {
          powerConnectors: [{
            id: 1, key: 'atx-main', label: '24-pin ATX', kind: 'main-power',
            connector: '24-pin ATX', count: 1, required: true,
          }],
        },
      },
    }],
    cpuCoolers: [], cases: [], powerSupplies: [], soundCards: [], wirelessCards: [],
    powerAdapters: [], nas: [], switches: [], patchPanels: [], monitors: [], upsSystems: [], powerStrips: [],
  }
}

function project() {
  return {
    id: 'default', revision: 4,
    metadata: { name: 'Project', version: 1, updatedAt: '2026-08-09T00:00:00.000Z' },
    placements: [], assignments: [], connections: [],
    compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
  }
}

describe('schema 27 motherboard contract migration', () => {
  it('validates v7 topology without mutating any persisted store', () => {
    const stores = {
      inventory: inventory(),
      project: project(),
      registry: createRegistryStore(),
      routingCache: createRoutingCache(),
    }
    const before = structuredClone(stores)

    expect(migrateSchema26To27(
      stores.inventory,
      stores.project,
      stores.registry,
      stores.routingCache,
    ).summary).toEqual({
      preservedMotherboards: 1,
      preservedAssignments: 0,
      preservedPlacements: 0,
      preservedConnections: 0,
      preservedRegistryLinks: 0,
      preservedRoutingEntries: 0,
    })
    expect(stores).toEqual(before)
  })

  it('rejects invalid numeric motherboard power relationships', () => {
    const invalid = inventory()
    invalid.motherboards[0].compatibility.host.powerConnectors[0].id = 'atx-main'
    expect(() => migrateSchema26To27(
      invalid,
      project(),
      createRegistryStore(),
      createRoutingCache(),
    )).toThrow(/positive safe-integer/i)
  })
})
