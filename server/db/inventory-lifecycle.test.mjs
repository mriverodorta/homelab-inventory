import { describe, expect, it } from 'vitest'
import {
  analyzeInventoryDependencies,
  buildDuplicateRecord,
  buildQuantityRecords,
  nextEquipmentName,
  resolveInventoryRef,
} from './inventory-lifecycle.mjs'

function emptyInventory() {
  return {
    servers: [], cpus: [], ram: [], storage: [], networkCards: [], gpus: [],
    nas: [], switches: [], patchPanels: [],
  }
}

function state(item, overrides = {}) {
  const inventory = emptyInventory()
  const table = item.type === 'server' ? 'servers' : item.type === 'network' ? 'networkCards' : 'cpus'
  inventory[table] = [{ ...item, type: undefined }]

  return {
    inventory,
    project: { placements: [], assignments: [], connections: [] },
    agents: { enrollments: {}, devices: {} },
    agentStatus: { servers: {} },
    ...overrides,
  }
}

describe('inventory lifecycle helpers', () => {
  it('resolves numeric inventory references by category', () => {
    const inventory = emptyInventory()
    inventory.cpus.push({ id: 7, name: 'CPU' })
    expect(resolveInventoryRef(inventory, { type: 'cpu', id: '7' })).toMatchObject({ table: 'cpus', index: 0 })
  })

  it('allocates collision-free equipment suffixes', () => {
    expect(nextEquipmentName('NETGEAR GS305', [
      { name: 'NETGEAR GS305' },
      { name: 'NETGEAR GS305 #2' },
    ])).toBe('NETGEAR GS305 #3')
  })

  it('creates numbered equipment quantities and identically named components', () => {
    expect(buildQuantityRecords({
      input: { name: 'Switch' }, type: 'switch', quantity: 2, startingId: 4,
      existingRecords: [{ id: 1, name: 'Switch' }],
    }).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 4, name: 'Switch #2' },
      { id: 5, name: 'Switch #3' },
    ])
    expect(buildQuantityRecords({
      input: { name: '32GB DDR4' }, type: 'ram', quantity: 2, startingId: 1, existingRecords: [],
    }).map((item) => item.name)).toEqual(['32GB DDR4', '32GB DDR4'])
  })

  it('duplicates reusable hardware while clearing instance data and regenerating nested ids', () => {
    const duplicate = buildDuplicateRecord({
      type: 'server', nextId: 8, existingRecords: [{ name: 'Server' }],
      source: {
        id: 1,
        name: 'Server',
        manufacturer: 'Example',
        notes: 'rack note',
        archivedAt: '2026-07-19T12:00:00.000Z',
        specs: { formFactor: 'Mini' },
        properties: { name: 'runtime-name', lanIp: '10.0.0.1' },
        ports: [{
          id: 91, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G',
          label: 'LAN', notes: 'patched', ipAddress: '10.0.0.1',
          endpoints: [{ id: 42, side: 'front', label: 'front' }],
        }],
      },
    })

    expect(duplicate).toEqual({
      id: 8,
      name: 'Server #2',
      manufacturer: 'Example',
      specs: { formFactor: 'Mini' },
      ports: [{
        id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G',
        endpoints: [{ id: 1, side: 'front' }],
      }],
    })
  })

  it('reports every strict dependency category', () => {
    const item = {
      id: 1,
      type: 'server',
      name: 'Server',
      ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, label: 'LAN' }],
    }
    const report = analyzeInventoryDependencies(state(item, {
      project: {
        placements: [{ itemType: 'server', itemId: 1, x: 0, y: 0 }],
        assignments: [{ id: 1, hostType: 'server', hostId: 1, itemType: 'cpu', itemId: 1, type: 'cpu' }],
        connections: [{
          id: 1, type: 'network', createdAt: '2026-07-19T00:00:00.000Z',
          from: { itemType: 'server', itemId: 1, portId: 1 },
          to: { itemType: 'switch', itemId: 1, portId: 1 },
        }],
      },
      agents: {
        enrollments: { 1: { id: 1, serverId: 1 } },
        devices: { 1: { id: 1, serverId: 1 } },
      },
      agentStatus: { servers: { 1: { serverId: 1 } } },
    }), { type: 'server', id: 1 })

    expect(report.reasons.map((entry) => entry.kind)).toEqual([
      'canvas-placement',
      'hosted-components',
      'port-connections',
      'agent-registration',
      'agent-status',
      'port-metadata',
    ])
  })

  it('reports a clean unassigned component as dependency free', () => {
    const report = analyzeInventoryDependencies(state({ id: 1, type: 'cpu', name: 'CPU' }), { type: 'cpu', id: 1 })
    expect(report).toMatchObject({ blocked: false, reasons: [] })
  })
})
