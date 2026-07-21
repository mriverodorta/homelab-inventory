import { describe, expect, it } from 'vitest'

import { canonicalPowerPorts } from '../../shared/power-ports.mjs'
import { migrateSchema10To11 } from './migrate-schema-11.mjs'

function schema10Inventory() {
  const powerStripSpecs = { outlets: 6, surgeProtectedOutlets: 6 }

  return {
    upsSystems: [{
      id: 1,
      name: 'Cyberpower CP1500PFCLCD',
      specs: {
        outlets: 10,
        batteryBackupOutlets: 5,
        surgeProtectedOutlets: 5,
      },
    }],
    powerStrips: [{
      id: 1,
      name: 'Kasa HS300',
      specs: powerStripSpecs,
      ports: canonicalPowerPorts({ type: 'powerStrip', specs: powerStripSpecs }),
    }],
  }
}

const expectedUpsPorts = [
  { id: 1, key: 'battery-outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 1, label: 'Battery outlet 1' },
  { id: 2, key: 'battery-outlet-2', kind: 'power-port', type: 'ac-outlet', slotNumber: 2, label: 'Battery outlet 2' },
  { id: 3, key: 'battery-outlet-3', kind: 'power-port', type: 'ac-outlet', slotNumber: 3, label: 'Battery outlet 3' },
  { id: 4, key: 'battery-outlet-4', kind: 'power-port', type: 'ac-outlet', slotNumber: 4, label: 'Battery outlet 4' },
  { id: 5, key: 'battery-outlet-5', kind: 'power-port', type: 'ac-outlet', slotNumber: 5, label: 'Battery outlet 5' },
  { id: 6, key: 'surge-outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 6, label: 'Surge outlet 1' },
  { id: 7, key: 'surge-outlet-2', kind: 'power-port', type: 'ac-outlet', slotNumber: 7, label: 'Surge outlet 2' },
  { id: 8, key: 'surge-outlet-3', kind: 'power-port', type: 'ac-outlet', slotNumber: 8, label: 'Surge outlet 3' },
  { id: 9, key: 'surge-outlet-4', kind: 'power-port', type: 'ac-outlet', slotNumber: 9, label: 'Surge outlet 4' },
  { id: 10, key: 'surge-outlet-5', kind: 'power-port', type: 'ac-outlet', slotNumber: 10, label: 'Surge outlet 5' },
]

describe('schema 10 to 11 canonical power-port migration', () => {
  it('backfills canonical UPS ports and preserves already-canonical power-strip ports', () => {
    const inventory = schema10Inventory()
    const original = structuredClone(inventory)

    const migrated = migrateSchema10To11(inventory)

    expect(migrated.upsSystems[0].ports).toEqual(expectedUpsPorts)
    expect(migrated.powerStrips[0].ports).toEqual(inventory.powerStrips[0].ports)
    expect(inventory).toEqual(original)
  })

  it('reconciles every power-equipment table using its canonical type', () => {
    const inventory = {
      monitors: [{ id: 1, name: 'Monitor' }],
      powerAdapters: [{ id: 1, name: 'Adapter' }],
      powerSupplies: [{ id: 1, name: 'Power supply' }],
    }

    const migrated = migrateSchema10To11(inventory)

    for (const table of ['monitors', 'powerAdapters', 'powerSupplies']) {
      expect(migrated[table][0].ports).toEqual([
        { id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1, label: 'AC input' },
      ])
    }
  })

  it('rejects duplicate existing port IDs', () => {
    const inventory = schema10Inventory()
    inventory.upsSystems[0].ports = [
      { id: 11, key: 'custom-a', kind: 'power-port', type: 'ac-outlet', slotNumber: 11 },
      { id: 11, key: 'custom-b', kind: 'power-port', type: 'ac-outlet', slotNumber: 12 },
    ]

    expect(() => migrateSchema10To11(inventory)).toThrow(
      'upsSystems[0].ports contains duplicate ID 11.',
    )
  })

  it('rejects duplicate existing semantic keys', () => {
    const inventory = schema10Inventory()
    inventory.upsSystems[0].ports = [
      { id: 11, key: 'custom', kind: 'power-port', type: 'ac-outlet', slotNumber: 11 },
      { id: 12, key: 'custom', kind: 'power-port', type: 'ac-outlet', slotNumber: 12 },
    ]

    expect(() => migrateSchema10To11(inventory)).toThrow(
      'upsSystems[0].ports contains duplicate key custom.',
    )
  })

  it('rejects a canonical key whose persisted topology is wrong', () => {
    const inventory = schema10Inventory()
    inventory.upsSystems[0].ports = [{
      id: 1,
      key: 'battery-outlet-1',
      kind: 'power-port',
      type: 'ac-input',
      slotNumber: 1,
    }]

    expect(() => migrateSchema10To11(inventory)).toThrow(
      'upsSystems[0].ports key battery-outlet-1 conflicts with the canonical power topology.',
    )
  })

  it('allocates the next free ID when a canonical preferred ID belongs to a non-power port', () => {
    const inventory = schema10Inventory()
    inventory.upsSystems[0].ports = [{
      id: 1,
      key: 'hdmi-1',
      kind: 'server-port',
      type: 'hdmi',
      slotNumber: 1,
    }]

    const migrated = migrateSchema10To11(inventory)

    expect(migrated.upsSystems[0].ports[0]).toEqual(inventory.upsSystems[0].ports[0])
    expect(migrated.upsSystems[0].ports.find((port) => port.key === 'battery-outlet-1')?.id).toBe(2)
    expect(new Set(migrated.upsSystems[0].ports.map((port) => port.id)).size).toBe(11)
  })

  it('preserves an existing canonical port surrogate ID', () => {
    const inventory = schema10Inventory()
    inventory.upsSystems[0].ports = [{
      id: 42,
      key: 'battery-outlet-1',
      kind: 'power-port',
      type: 'ac-outlet',
      slotNumber: 1,
    }]

    const migrated = migrateSchema10To11(inventory)

    expect(migrated.upsSystems[0].ports.find((port) => port.key === 'battery-outlet-1')?.id).toBe(42)
  })

  it('backfills outlets-only UPS records as surge-only outlets', () => {
    const inventory = {
      upsSystems: [{ id: 1, name: 'Basic UPS', specs: { outlets: 3 } }],
    }

    const migrated = migrateSchema10To11(inventory)

    expect(migrated.upsSystems[0].ports).toEqual([
      { id: 1, key: 'surge-outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 1, label: 'Surge outlet 1' },
      { id: 2, key: 'surge-outlet-2', kind: 'power-port', type: 'ac-outlet', slotNumber: 2, label: 'Surge outlet 2' },
      { id: 3, key: 'surge-outlet-3', kind: 'power-port', type: 'ac-outlet', slotNumber: 3, label: 'Surge outlet 3' },
    ])
  })

  it.each([
    ['power kind', { id: 11, key: 'phantom-kind', kind: 'power-port', type: 'hdmi', slotNumber: 11 }],
    ['power type', { id: 11, key: 'phantom-type', kind: 'server-port', type: 'ac-outlet', slotNumber: 11 }],
  ])('rejects an extra endpoint marked as power by %s', (_case, phantomPort) => {
    const inventory = schema10Inventory()
    inventory.upsSystems[0].ports = [phantomPort]

    expect(() => migrateSchema10To11(inventory)).toThrow(
      `upsSystems[0].ports contains noncanonical power endpoint ${phantomPort.key}.`,
    )
  })

  it('preserves unrelated monitor display ports while adding canonical power input', () => {
    const displayPorts = [
      { id: 2, key: 'hdmi-1', kind: 'server-port', type: 'hdmi', slotNumber: 1 },
      { id: 3, key: 'displayport-1', kind: 'server-port', type: 'displayport', slotNumber: 2 },
    ]
    const inventory = {
      monitors: [{ id: 1, name: 'Monitor', ports: displayPorts }],
    }

    const migrated = migrateSchema10To11(inventory)

    expect(migrated.monitors[0].ports).toEqual([
      ...displayPorts,
      { id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1, label: 'AC input' },
    ])
  })
})
