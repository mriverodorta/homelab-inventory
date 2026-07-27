import { describe, expect, it } from 'vitest'
import { migrateSchema15To16 } from './migrate-schema-16.mjs'

function stores(overrides = {}) {
  return {
    inventory: { ram: [{
      id: 1, name: '32GB DDR4', manufacturer: 'Kingston', secondaryManufacturer: 'Crucial',
      specs: { capacityGb: 32, moduleCount: 2, generation: 'DDR4', speedMt: 3200, secondarySpeedMt: 2666, formFactor: 'SO-DIMM', ecc: false },
    }] },
    project: { assignments: [{
      id: 7, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 1, type: 'ram', assignedAt: '2026-01-01T00:00:00.000Z',
      allocation: { resourceType: 'memory', positions: [0, 1] },
    }] },
    registry: {
      links: [{ id: 1, itemType: 'ram', itemId: 1 }, { id: 2, itemType: 'cpu', itemId: 1 }],
      contributionOutbox: [{ id: 1, itemType: 'ram', itemId: 1 }], contributionLedger: [],
    },
    ...overrides,
  }
}

describe('schema 16 RAM migration', () => {
  it('splits a kit into physical sticks and preserves slots and capacity', () => {
    const input = stores()
    const migrated = migrateSchema15To16(input.inventory, input.project, input.registry)
    expect(migrated.inventory.ram).toEqual([
      expect.objectContaining({ id: 1, name: '16GB DDR4', manufacturer: 'Kingston', specs: expect.objectContaining({ capacityGb: 16, speedMt: 3200 }) }),
      expect.objectContaining({ id: 2, name: '16GB DDR4', manufacturer: 'Crucial', specs: expect.objectContaining({ capacityGb: 16, speedMt: 2666 }) }),
    ])
    expect(migrated.inventory.ram.every((item) => item.specs.moduleCount === undefined && item.secondaryManufacturer === undefined)).toBe(true)
    expect(migrated.project.assignments).toEqual([
      expect.objectContaining({ id: 7, itemId: 1, allocation: expect.objectContaining({ positions: [0] }) }),
      expect.objectContaining({ id: 8, itemId: 2, allocation: expect.objectContaining({ positions: [1] }) }),
    ])
    expect(migrated.summary.totalCapacityGb).toBe(32)
    expect(migrated.registry.links).toEqual([{ id: 2, itemType: 'cpu', itemId: 1 }])
    expect(migrated.registry.contributionOutbox).toEqual([])
  })

  it('splits an unassigned kit into two unassigned sticks', () => {
    const input = stores({ project: { assignments: [] } })
    const migrated = migrateSchema15To16(input.inventory, input.project, input.registry)
    expect(migrated.inventory.ram).toHaveLength(2)
    expect(migrated.project.assignments).toEqual([])
  })

  it('leaves an existing single stick canonical and idempotent', () => {
    const input = stores({
      inventory: { ram: [{ id: 4, name: '8GB DDR4', manufacturer: 'Kingston', specs: { capacityGb: 8, generation: 'DDR4', speedMt: 3200, formFactor: 'SO-DIMM', ecc: false } }] },
      project: { assignments: [] },
    })
    const once = migrateSchema15To16(input.inventory, input.project, input.registry)
    const twice = migrateSchema15To16(once.inventory, once.project, once.registry)
    expect(twice.inventory).toEqual(once.inventory)
  })

  it('inherits missing secondary manufacturer and speed', () => {
    const input = stores()
    delete input.inventory.ram[0].secondaryManufacturer
    delete input.inventory.ram[0].specs.secondarySpeedMt
    const migrated = migrateSchema15To16(input.inventory, input.project, input.registry)
    expect(migrated.inventory.ram[1]).toMatchObject({ manufacturer: 'Kingston', specs: { speedMt: 3200 } })
  })

  it.each([
    [{ capacityGb: 31, moduleCount: 2 }, 'not divisible'],
    [{ capacityGb: 32, moduleCount: 3 }, 'unsupported moduleCount'],
  ])('rejects ambiguous kit specs', (specs, message) => {
    const input = stores()
    input.inventory.ram[0].specs = { ...input.inventory.ram[0].specs, ...specs }
    expect(() => migrateSchema15To16(input.inventory, input.project, input.registry)).toThrow(message)
  })

  it('rejects assignment position mismatch', () => {
    const input = stores()
    input.project.assignments[0].allocation.positions = [0]
    expect(() => migrateSchema15To16(input.inventory, input.project, input.registry)).toThrow('positions must match')
  })
})
