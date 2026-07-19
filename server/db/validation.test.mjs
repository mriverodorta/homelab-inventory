import { describe, expect, it } from 'vitest'
import {
  assertInventoryStoreShape,
  assertLegacyProjectShape,
  assertProjectShape,
  assertProjectStoreShape,
} from './validation.mjs'

function inventoryWith(item) {
  return {
    servers: [], cpus: [item], ram: [], storage: [], networkCards: [], gpus: [],
    nas: [], switches: [], patchPanels: [],
  }
}

function inventoryTables(overrides = {}) {
  return {
    servers: [], cpus: [], ram: [], storage: [], networkCards: [], gpus: [],
    nas: [], switches: [], patchPanels: [],
    ...overrides,
  }
}

function compatibleItems() {
  return {
    'server:1': {
      id: 1,
      key: 'server:1',
      type: 'server',
      name: 'Host',
      compatibility: {
        host: {
          memory: { generations: ['DDR4'], slots: 2, maxCapacityGb: 64 },
          storageSlots: [
            { id: 'storage-1', label: 'M.2', count: 1, interfaces: ['NVMe'] },
          ],
          expansionSlots: [
            {
              id: 'expansion-1',
              label: 'PCIe',
              count: 1,
              interfaceFamily: 'pcie',
              mechanicalLanes: 16,
              electricalLanes: 4,
              acceptedHeights: ['low-profile'],
            },
          ],
        },
      },
    },
    'storage:1': {
      id: 1,
      key: 'storage:1',
      type: 'storage',
      name: 'Drive',
      specs: { interface: 'NVMe', formFactor: '2280' },
    },
  }
}

describe('inventory lifecycle validation', () => {
  it('accepts an absent or valid ISO archivedAt timestamp', () => {
    expect(() => assertInventoryStoreShape(inventoryWith({ id: 1, name: 'CPU' }))).not.toThrow()
    expect(() => assertInventoryStoreShape(inventoryWith({
      id: 1,
      name: 'CPU',
      archivedAt: '2026-07-19T12:00:00.000Z',
    }))).not.toThrow()
  })

  it('rejects invalid archivedAt values', () => {
    for (const archivedAt of ['', 'not-a-date', 123]) {
      expect(() => assertInventoryStoreShape(inventoryWith({ id: 1, name: 'CPU', archivedAt })))
        .toThrow('archivedAt')
    }
  })
})

describe('compatibility validation', () => {
  it('accepts valid compatibility profiles and preserves forward-compatible extension fields', () => {
    const inventory = inventoryTables({
      servers: [{
        id: 1,
        name: 'Server',
        compatibility: {
          extensionVersion: 2,
          host: {
            cpu: { sockets: ['LGA1200'], generations: ['10th Gen'], maxTdpWatts: 65 },
            memory: {
              generations: ['DDR4'],
              slots: 2,
              maxCapacityGb: 64,
              maxModuleCapacityGb: 32,
              maxSpeedMt: 3200,
            },
            storageSlots: [{
              id: 'storage-1',
              label: 'M.2 slot',
              count: 1,
              interfaces: ['NVMe'],
              formFactors: ['2280'],
              pcieGeneration: 3,
              vendorExtension: true,
            }],
            expansionSlots: [{
              id: 'expansion-1',
              label: 'PCIe slot',
              count: 1,
              interfaceFamily: 'pcie',
              pcieGeneration: 3,
              mechanicalLanes: 16,
              electricalLanes: 4,
              acceptedHeights: ['low-profile'],
              maxSlotWidth: 1,
              maxPowerWatts: 75,
            }],
            maxExpansionPowerWatts: 75,
          },
        },
      }],
      cpus: [{
        id: 1,
        name: 'CPU',
        compatibility: {
          requirements: {
            cpu: { socket: 'LGA1200', generation: '10th Gen', tdpWatts: 35 },
            futureRequirement: { retained: true },
          },
        },
      }],
    })

    expect(() => assertInventoryStoreShape(inventory)).not.toThrow()
  })

  it('rejects duplicate compatibility resource IDs', () => {
    const inventory = inventoryTables({
      servers: [{
        id: 1,
        name: 'Server',
        compatibility: {
          host: {
            storageSlots: [
              { id: 'storage-1', label: 'First', count: 1 },
              { id: 'storage-1', label: 'Second', count: 1 },
            ],
          },
        },
      }],
    })

    expect(() => assertInventoryStoreShape(inventory)).toThrow(
      'Inventory item server:1 compatibility.host.storageSlots[1].id must be unique.',
    )
  })

  it('rejects invalid group counts with the exact nested path', () => {
    const inventory = inventoryTables({
      servers: [{
        id: 1,
        name: 'Server',
        compatibility: {
          host: { storageSlots: [{ id: 'storage-1', label: 'M.2', count: 0 }] },
        },
      }],
    })

    expect(() => assertInventoryStoreShape(inventory)).toThrow(
      'Inventory item server:1 compatibility.host.storageSlots[0].count must be a positive integer.',
    )
  })

  it.each([
    [
      { host: { maxExpansionPowerWatts: -1 } },
      'Inventory item server:1 compatibility.host.maxExpansionPowerWatts must be a finite non-negative number.',
    ],
    [
      {
        host: {
          expansionSlots: [{
            id: 'expansion-1', label: 'PCIe', count: 1, interfaceFamily: 'pcie', mechanicalLanes: 0,
          }],
        },
      },
      'Inventory item server:1 compatibility.host.expansionSlots[0].mechanicalLanes must be a positive integer.',
    ],
    [
      { requirements: { expansion: { interfaceFamily: 'thunderbolt' } } },
      'Inventory item server:1 compatibility.requirements.expansion.interfaceFamily has an unsupported value.',
    ],
    [
      { host: { cpu: { sockets: [undefined] } } },
      'Inventory item server:1 compatibility.host.cpu.sockets[0] must be a non-empty string.',
    ],
  ])('rejects invalid known compatibility fields', (compatibility, message) => {
    const inventory = inventoryTables({
      servers: [{ id: 1, name: 'Server', compatibility }],
    })

    expect(() => assertInventoryStoreShape(inventory)).toThrow(message)
  })
})

describe('assignment allocation validation', () => {
  it('rejects unsupported allocation resource types', () => {
    expect(() => assertProjectStoreShape({
      placements: [],
      assignments: [{
        id: 1,
        hostType: 'server',
        hostId: 1,
        itemType: 'storage',
        itemId: 1,
        type: 'storage',
        allocation: { resourceType: 'drive', groupId: 'storage-1', positions: [0] },
      }],
      connections: [],
    })).toThrow('Project assignment 1 allocation.resourceType has an unsupported value.')
  })

  it('rejects allocations outside the referenced group range', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [],
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:1',
        type: 'storage',
        allocation: { resourceType: 'storage', groupId: 'storage-1', positions: [1] },
      }],
      connections: [],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project assignment 1 allocation.positions[0] is outside compatibility.host.storageSlots group storage-1.',
    )
  })

  it('requires a group ID for storage and expansion allocations', () => {
    expect(() => assertProjectStoreShape({
      placements: [],
      assignments: [{
        id: 1,
        hostType: 'server',
        hostId: 1,
        itemType: 'storage',
        itemId: 1,
        type: 'storage',
        allocation: { resourceType: 'storage', positions: [0] },
      }],
      connections: [],
    })).toThrow('Project assignment 1 allocation.groupId must be a non-empty string.')
  })

  it('rejects allocations that reference a missing host group', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [],
      assignments: [{
        id: 1,
        serverId: 'server:1',
        itemId: 'storage:1',
        type: 'storage',
        allocation: { resourceType: 'storage', groupId: 'missing', positions: [0] },
      }],
      connections: [],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project assignment 1 allocation.groupId references missing compatibility.host.storageSlots group missing.',
    )
  })

  it('rejects two assignments that claim the same normalized allocation position', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: {
        ...compatibleItems(),
        'storage:2': {
          id: 2,
          key: 'storage:2',
          type: 'storage',
          name: 'Second drive',
          specs: { interface: 'NVMe', formFactor: '2280' },
        },
      },
      placements: [],
      assignments: [
        {
          id: 1,
          serverId: 'server:1',
          itemId: 'storage:1',
          type: 'storage',
          allocation: { resourceType: 'storage', groupId: 'storage-1', positions: [0] },
        },
        {
          id: 2,
          serverId: 'server:1',
          itemId: 'storage:2',
          type: 'storage',
          allocation: { resourceType: 'storage', groupId: 'storage-1', positions: [0] },
        },
      ],
      connections: [],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project assignments[1].allocation.positions[0] conflicts with Project assignments[0].allocation.positions[0].',
    )
  })
})

describe('canonical project identity validation', () => {
  it('rejects assignment IDs that collide after numeric normalization', () => {
    expect(() => assertProjectStoreShape({
      placements: [],
      assignments: [
        { id: 1, serverId: 'server:1', itemId: 'storage:1', type: 'storage' },
        { id: '1', serverId: 'server:1', itemId: 'storage:2', type: 'storage' },
      ],
      connections: [],
    })).toThrow(
      'Project assignments[1].id duplicates canonical id 1 from Project assignments[0].id.',
    )
  })

  it('rejects connection IDs that collide after numeric normalization', () => {
    const connection = (id) => ({
      id,
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 1 },
      type: 'network',
      createdAt: '2026-07-19T00:00:00.000Z',
    })

    expect(() => assertProjectStoreShape({
      placements: [],
      assignments: [],
      connections: [connection(1), connection('1')],
    })).toThrow(
      'Project connections[1].id duplicates canonical id 1 from Project connections[0].id.',
    )
  })

  it('rejects assigning the same component record more than once', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [],
      assignments: [
        { id: 1, serverId: 'server:1', itemId: 'storage:1', type: 'storage' },
        { id: 2, serverId: 'server:1', itemId: 'storage:1', type: 'storage' },
      ],
      connections: [],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project assignments[1].itemId duplicates component storage:1 from Project assignments[0].itemId.',
    )
  })

  it('rejects assignment types that disagree with the referenced component', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [],
      assignments: [
        { id: 1, serverId: 'server:1', itemId: 'storage:1', type: 'gpu' },
      ],
      connections: [],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project assignments[0].type gpu does not match referenced inventory item storage:1 type storage.',
    )
  })
})

describe('legacy single-file validation', () => {
  function legacyProject(items) {
    return {
      id: 'default',
      metadata: {},
      items,
      placements: [],
      assignments: [],
      connections: [],
    }
  }

  it('rejects unsupported records before normalization can skip them', () => {
    expect(() => assertLegacyProjectShape(legacyProject({
      mystery: { id: 'mystery', type: 'router', name: 'Unsupported' },
    }))).toThrow('Project items["mystery"].type has an unsupported value.')
  })

  it('rejects inventory keys that collide after legacy ID normalization', () => {
    expect(() => assertLegacyProjectShape(legacyProject({
      first: { id: '1', type: 'cpu', name: 'First CPU' },
      'cpu:1': { id: 1, type: 'cpu', name: 'Second CPU' },
    }))).toThrow(
      'Project items["cpu:1"] normalizes to duplicate inventory key cpu:1 from Project items["first"].',
    )
  })
})
