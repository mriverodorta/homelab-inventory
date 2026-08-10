import { describe, expect, it } from 'vitest'
import { createRegistryStore } from '../registry/model.mjs'
import { createRoutingCache } from '../routing-cache-model.mjs'
import { migrateSchema28To29 } from './migrate-schema-29.mjs'

function inventory() {
  return {
    servers: [{
      id: 1, type: 'server', name: 'Host', hardwareClass: 'desktop', usageRole: 'server',
      compatibility: { host: { memory: {
        slots: 2, generations: ['DDR4'], moduleTypes: ['SODIMM', 'UDIMM'], maxCapacityGb: 64,
      } } },
    }],
    pcBuilds: [], cpus: [],
    ram: [{ id: 1, type: 'ram', name: 'Stick', specs: { capacityGb: 16, speed: 3200, formFactor: 'SODIMM' } }],
    storage: [], networkCards: [], gpus: [], motherboards: [], cpuCoolers: [], cases: [],
    powerSupplies: [], soundCards: [], wirelessCards: [], powerAdapters: [], nas: [], switches: [],
    patchPanels: [], monitors: [], upsSystems: [], powerStrips: [],
  }
}

function project() {
  return {
    id: 'default', revision: 4,
    metadata: { name: 'Project', version: 1, updatedAt: '2026-08-10T00:00:00.000Z' },
    placements: [{ itemType: 'server', itemId: 1, x: 0, y: 0 }],
    assignments: [{ id: 1, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 1, type: 'ram', assignedAt: '2026-08-10T00:00:00.000Z', allocation: { resourceType: 'memory', positions: [0] } }],
    connections: [], compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
  }
}

describe('schema 29 RAM contract migration', () => {
  it('separates host form factor and module type while preserving relationships', () => {
    const source = inventory()
    const projectStore = project()
    const registry = createRegistryStore()
    const routing = createRoutingCache()
    const preserved = {
      project: structuredClone(projectStore),
      registry: structuredClone(registry),
      routing: structuredClone(routing),
    }

    const migrated = migrateSchema28To29(source, projectStore, registry, routing)

    expect(migrated.inventory.ram[0].specs).toEqual({
      capacityGb: 16, speedMt: 3200, formFactor: 'SO-DIMM',
    })
    expect(migrated.inventory.servers[0].compatibility.host.memory).toEqual({
      slots: 2,
      generations: ['DDR4'],
      formFactors: ['SO-DIMM'],
      moduleTypes: ['UDIMM'],
      maxCapacityGb: 64,
    })
    expect({ project: projectStore, registry, routing }).toEqual(preserved)
    expect(migrated.summary).toMatchObject({
      migratedSpeeds: 1,
      normalizedRamFormFactors: 1,
      migratedHostMemoryDefinitions: 1,
      preservedAssignments: 1,
      preservedPlacements: 1,
    })
  })

  it('is idempotent after the first migration', () => {
    const first = migrateSchema28To29(inventory(), project(), createRegistryStore(), createRoutingCache())
    const second = migrateSchema28To29(first.inventory, project(), createRegistryStore(), createRoutingCache())
    expect(second.inventory).toEqual(first.inventory)
    expect(second.summary).toMatchObject({
      migratedSpeeds: 0,
      normalizedRamFormFactors: 0,
      migratedHostMemoryDefinitions: 0,
    })
  })

  it('rejects conflicting speed values and ambiguous host memory values', () => {
    const conflicting = inventory()
    conflicting.ram[0].specs.speedMt = 2666
    expect(() => migrateSchema28To29(conflicting, project(), createRegistryStore(), createRoutingCache()))
      .toThrow(/conflicts/i)

    const ambiguous = inventory()
    ambiguous.servers[0].compatibility.host.memory.moduleTypes = ['registered memory']
    expect(() => migrateSchema28To29(ambiguous, project(), createRegistryStore(), createRoutingCache()))
      .toThrow(/ambiguous or unsupported/i)
  })
})
