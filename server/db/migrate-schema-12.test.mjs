import { describe, expect, it } from 'vitest'

import { migrateSchema11To12 } from './migrate-schema-12.mjs'

const CREATED_AT = '2026-07-22T12:00:00.000Z'

function schema11Stores() {
  return {
    inventory: {
      servers: [], pcBuilds: [], cpus: [], ram: [], storage: [], networkCards: [],
      gpus: [], motherboards: [], cpuCoolers: [], cases: [], powerSupplies: [],
      soundCards: [], wirelessCards: [],
      powerAdapters: [{
        id: 1,
        name: 'OEM adapter',
        ports: [{
          id: 1,
          key: 'ac-input',
          kind: 'power-port',
          type: 'ac-input',
          slotNumber: 1,
          label: 'AC input',
        }],
      }],
      nas: [
        {
          id: 1,
          name: 'Internal NAS',
          ports: Array.from({ length: 4 }, (_, index) => ({
            id: index + 1,
            kind: 'server-port',
            type: 'rj45',
            slotNumber: index + 1,
            speed: '1G',
          })),
        },
        {
          id: 2,
          name: 'External NAS',
          ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G' }],
        },
        {
          id: 3,
          name: 'Configured NAS',
          specs: { powerConfiguration: 'external-adapter' },
        },
      ],
      switches: [], patchPanels: [], monitors: [], upsSystems: [], powerStrips: [],
    },
    project: {
      placements: [],
      assignments: [{
        id: 1,
        hostType: 'nas',
        hostId: 2,
        itemType: 'powerAdapter',
        itemId: 1,
        type: 'powerAdapter',
        assignedAt: CREATED_AT,
      }],
      connections: [{
        id: 1,
        from: { itemType: 'ups', itemId: 1, portId: 1 },
        to: {
          itemType: 'nas',
          itemId: 2,
          hostedItemType: 'powerAdapter',
          hostedItemId: 1,
          portId: 1,
        },
        type: 'power',
        createdAt: CREATED_AT,
      }],
      compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
    },
  }
}

describe('schema 11 to 12 NAS power migration', () => {
  it('defaults unassigned NAS records to internal power and preserves assigned adapters', () => {
    const stores = schema11Stores()
    const original = structuredClone(stores)
    const migrated = migrateSchema11To12(stores.inventory, stores.project)

    expect(migrated.inventory.nas[0].specs.powerConfiguration).toBe('internal-psu')
    expect(migrated.inventory.nas[0].ports.find((port) => port.key === 'ac-input')).toEqual({
      id: 5,
      key: 'ac-input',
      kind: 'power-port',
      type: 'ac-input',
      slotNumber: 1,
      label: 'AC input',
    })
    expect(migrated.inventory.nas[1].specs.powerConfiguration).toBe('external-adapter')
    expect(migrated.inventory.nas[1].ports.some((port) => port.type === 'ac-input')).toBe(false)
    expect(migrated.inventory.nas[2].specs.powerConfiguration).toBe('external-adapter')
    expect(migrated.project).toEqual(stores.project)
    expect(stores).toEqual(original)
  })

  it('is idempotent and ignores unresolved adapter-like assignments', () => {
    const stores = schema11Stores()
    stores.project.assignments.push({
      id: 2,
      hostType: 'nas',
      hostId: 1,
      itemType: 'powerAdapter',
      itemId: 999,
      type: 'powerAdapter',
      assignedAt: CREATED_AT,
    })

    const first = migrateSchema11To12(stores.inventory, stores.project)
    const second = migrateSchema11To12(first.inventory, first.project)

    expect(first.inventory.nas[0].specs.powerConfiguration).toBe('internal-psu')
    expect(second).toEqual(first)
  })
})
