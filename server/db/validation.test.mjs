import { describe, expect, it } from 'vitest'
import {
  assertInventoryStoreShape,
  assertLegacyProjectShape,
  assertProjectShape,
  assertProjectStoreShape,
} from './validation.mjs'
import {
  ASSIGNABLE_COMPONENT_TYPES,
  CANVAS_EQUIPMENT_TYPES,
  HOST_TYPES,
  INVENTORY_TYPES,
  isAssignableComponentType,
  isCanvasEquipmentType,
  isHostType,
  isInventoryType,
} from './inventory-capabilities.mjs'
import { canonicalPowerPorts } from '../../shared/power-ports.mjs'

function inventoryWith(item) {
  return {
    ...inventoryTables(),
    cpus: [item],
  }
}

function inventoryTables(overrides = {}) {
  return {
    servers: [],
    pcBuilds: [],
    cpus: [],
    ram: [],
    storage: [],
    networkCards: [],
    gpus: [],
    motherboards: [],
    cpuCoolers: [],
    cases: [],
    powerSupplies: [],
    soundCards: [],
    wirelessCards: [],
    powerAdapters: [],
    nas: [],
    switches: [],
    patchPanels: [],
    monitors: [],
    upsSystems: [],
    powerStrips: [],
    ...overrides,
  }
}

const SCHEMA_9_TABLE_TYPES = {
  servers: 'server',
  pcBuilds: 'pcBuild',
  cpus: 'cpu',
  ram: 'ram',
  storage: 'storage',
  networkCards: 'network',
  gpus: 'gpu',
  motherboards: 'motherboard',
  cpuCoolers: 'cpuCooler',
  cases: 'case',
  powerSupplies: 'powerSupply',
  soundCards: 'soundCard',
  wirelessCards: 'wireless',
  powerAdapters: 'powerAdapter',
  nas: 'nas',
  switches: 'switch',
  patchPanels: 'patchPanel',
  monitors: 'monitor',
  upsSystems: 'ups',
  powerStrips: 'powerStrip',
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
            { id: 1, key: 'storage-1', label: 'M.2', count: 1, interfaces: ['NVMe'] },
          ],
          expansionSlots: [
            {
              id: 1,
              key: 'expansion-1',
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

describe('inventory capability validation', () => {
  it.each(Object.entries(SCHEMA_9_TABLE_TYPES))(
    'requires and validates the schema 9 %s table as %s records',
    (table, type) => {
      const item = { id: 1, name: `${type} item`, type }
      const ports = canonicalPowerPorts(item)
      const inventory = inventoryTables({
        [table]: [{ ...item, ...(ports.length > 0 ? { ports } : {}) }],
      })
      expect(() => assertInventoryStoreShape(inventory)).not.toThrow()

      delete inventory[table]
      expect(() => assertInventoryStoreShape(inventory))
        .toThrow(`Inventory store is missing a ${table} array.`)
    },
  )

  it('mirrors the complete inventory capability model on the backend', () => {
    expect(HOST_TYPES).toHaveLength(3)
    expect(CANVAS_EQUIPMENT_TYPES).toHaveLength(8)
    expect(ASSIGNABLE_COMPONENT_TYPES).toHaveLength(12)
    expect(INVENTORY_TYPES).toHaveLength(20)
    expect(new Set(INVENTORY_TYPES).size).toBe(INVENTORY_TYPES.length)
    expect(INVENTORY_TYPES.every(isInventoryType)).toBe(true)
    expect(HOST_TYPES.every(isHostType)).toBe(true)
    expect(CANVAS_EQUIPMENT_TYPES.every(isCanvasEquipmentType)).toBe(true)
    expect(ASSIGNABLE_COMPONENT_TYPES.every(isAssignableComponentType)).toBe(true)
  })

  it.each(INVENTORY_TYPES)('accepts %s as a supported legacy inventory type', (type) => {
    const project = {
      id: 'default',
      metadata: {},
      items: { [`${type}:1`]: { id: 1, type, name: `${type} item` } },
      placements: [],
      assignments: [],
      connections: [],
    }

    expect(() => assertLegacyProjectShape(project)).not.toThrow()
  })

  it('keeps operating systems as host metadata rather than inventory items', () => {
    expect(isInventoryType('operatingSystem')).toBe(false)
    expect(() => assertLegacyProjectShape({
      id: 'default',
      metadata: {},
      items: {
        'operatingSystem:1': {
          id: 1,
          type: 'operatingSystem',
          name: 'Linux',
        },
      },
      placements: [],
      assignments: [],
      connections: [],
    })).toThrow('type has an unsupported value')
  })
})

describe('canonical power topology validation', () => {
  const specs = { batteryBackupOutlets: 1, surgeProtectedOutlets: 1 }

  it('rejects strict UPS records without persisted canonical power ports', () => {
    const inventory = inventoryTables({
      upsSystems: [{ id: 1, name: 'UPS', specs }],
    })

    expect(() => assertInventoryStoreShape(inventory)).toThrow(
      'Inventory item ups:1 is missing canonical power port battery-outlet-1.',
    )
  })

  it.each([
    ['kind', { kind: 'server-port' }],
    ['type', { type: 'ac-input' }],
    ['slot number', { slotNumber: 99 }],
  ])('rejects a canonical UPS port with a mismatched %s', (_field, changes) => {
    const ports = canonicalPowerPorts({ type: 'ups', specs }).map((port) => (
      port.key === 'battery-outlet-1' ? { ...port, ...changes } : port
    ))
    const inventory = inventoryTables({
      upsSystems: [{ id: 1, name: 'UPS', specs, ports }],
    })

    expect(() => assertInventoryStoreShape(inventory)).toThrow(
      'Inventory item ups:1 is missing canonical power port battery-outlet-1.',
    )
  })

  it('accepts a canonical power port with a non-preferred positive surrogate ID', () => {
    const ports = canonicalPowerPorts({ type: 'ups', specs }).map((port) => (
      port.key === 'battery-outlet-1' ? { ...port, id: 42 } : port
    ))
    const inventory = inventoryTables({
      upsSystems: [{ id: 1, name: 'UPS', specs, ports }],
    })

    expect(() => assertInventoryStoreShape(inventory)).not.toThrow()
  })

  it('requires and accepts surge-only canonical ports for an outlets-only UPS', () => {
    const outletsOnlySpecs = { outlets: 3 }
    const withoutPorts = inventoryTables({
      upsSystems: [{ id: 1, name: 'UPS', specs: outletsOnlySpecs }],
    })

    expect(() => assertInventoryStoreShape(withoutPorts)).toThrow(
      'Inventory item ups:1 is missing canonical power port surge-outlet-1.',
    )

    const withPorts = inventoryTables({
      upsSystems: [{
        id: 1,
        name: 'UPS',
        specs: outletsOnlySpecs,
        ports: canonicalPowerPorts({ type: 'ups', specs: outletsOnlySpecs }),
      }],
    })
    expect(() => assertInventoryStoreShape(withPorts)).not.toThrow()
  })

  it('accepts a strict UPS record with its canonical persisted power topology', () => {
    const inventory = inventoryTables({
      upsSystems: [{
        id: 1,
        name: 'UPS',
        specs,
        ports: canonicalPowerPorts({ type: 'ups', specs }),
      }],
    })

    expect(() => assertInventoryStoreShape(inventory)).not.toThrow()
  })

  it('rejects duplicate semantic port keys during strict validation', () => {
    const ports = canonicalPowerPorts({ type: 'ups', specs })
    const inventory = inventoryTables({
      upsSystems: [{
        id: 1,
        name: 'UPS',
        specs,
        ports: [...ports, { ...ports[0], id: 3 }],
      }],
    })

    expect(() => assertInventoryStoreShape(inventory)).toThrow(
      'Inventory item ups:1 port key battery-outlet-1 must be unique.',
    )
  })

  it.each([
    ['power kind', { id: 3, key: 'phantom-kind', kind: 'power-port', type: 'hdmi', slotNumber: 3 }],
    ['power type', { id: 3, key: 'phantom-type', kind: 'server-port', type: 'ac-outlet', slotNumber: 3 }],
  ])('rejects an extra port marked as a power endpoint by %s', (_case, phantomPort) => {
    const inventory = inventoryTables({
      upsSystems: [{
        id: 1,
        name: 'UPS',
        specs,
        ports: [...canonicalPowerPorts({ type: 'ups', specs }), phantomPort],
      }],
    })

    expect(() => assertInventoryStoreShape(inventory)).toThrow(
      `Inventory item ups:1 has noncanonical power port ${phantomPort.key}.`,
    )
  })

  it('preserves unrelated monitor display ports beside canonical power input', () => {
    const inventory = inventoryTables({
      monitors: [{
        id: 1,
        name: 'Monitor',
        ports: [
          ...canonicalPowerPorts({ type: 'monitor' }),
          { id: 2, key: 'hdmi-1', kind: 'server-port', type: 'hdmi', slotNumber: 1 },
          { id: 3, key: 'displayport-1', kind: 'server-port', type: 'displayport', slotNumber: 2 },
        ],
      }],
    })

    expect(() => assertInventoryStoreShape(inventory)).not.toThrow()
  })

  it('keeps legacy pre-migration UPS records valid without persisted ports', () => {
    expect(() => assertLegacyProjectShape({
      id: 'default',
      metadata: {},
      items: { 'ups:1': { id: 1, type: 'ups', name: 'UPS', specs } },
      placements: [],
      assignments: [],
      connections: [],
    })).not.toThrow()
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
              id: 1,
              key: 'storage-1',
              label: 'M.2 slot',
              count: 1,
              interfaces: ['NVMe'],
              formFactors: ['2280'],
              pcieGeneration: 3,
              vendorExtension: true,
            }],
            expansionSlots: [{
              id: 1,
              key: 'expansion-1',
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
              { id: 1, key: 'storage-1', label: 'First', count: 1 },
              { id: 1, key: 'storage-2', label: 'Second', count: 1 },
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
          host: { storageSlots: [{ id: 1, key: 'storage-1', label: 'M.2', count: 0 }] },
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
            id: 1, key: 'expansion-1', label: 'PCIe', count: 1, interfaceFamily: 'pcie', mechanicalLanes: 0,
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

  it.each([
    [
      {
        disabledHosts: [
          { hostType: 'server', hostId: 1 },
          { hostType: 'server', hostId: 1 },
        ],
        ignoredWarningIds: [],
      },
      'compatibilityPolicy.disabledHosts[1] duplicates host server:1.',
    ],
    [
      {
        disabledHosts: [],
        ignoredWarningIds: ['warning:1', 2],
      },
      'compatibilityPolicy.ignoredWarningIds must contain unique strings',
    ],
  ])('rejects malformed compatibility policy arrays', (compatibilityPolicy, message) => {
    expect(() => assertProjectStoreShape({
      placements: [],
      assignments: [],
      connections: [],
      compatibilityPolicy,
    })).toThrow(message)
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
        allocation: { resourceType: 'drive', groupId: 1, positions: [0] },
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
        hostType: 'server',
        hostId: 1,
        itemType: 'storage',
        itemId: 1,
        type: 'storage',
        allocation: { resourceType: 'storage', groupId: 1, positions: [1] },
      }],
      connections: [],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project assignment 1 allocation.positions[0] is outside compatibility.host.storageSlots group 1.',
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
    })).toThrow('Project assignment 1 allocation.groupId must be a positive safe-integer relational ID.')
  })

  it('accepts PC Build logical and motherboard-backed allocations', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: {
        'pcBuild:1': { id: 1, key: 'pcBuild:1', type: 'pcBuild', name: 'Workstation' },
        'motherboard:1': {
          id: 1,
          key: 'motherboard:1',
          type: 'motherboard',
          name: 'AM5 board',
          specs: { cpuSocketCount: 1 },
          compatibility: {
            host: {
              cpu: { sockets: ['AM5'] },
              memory: { slots: 2, generations: ['DDR5'] },
              storageSlots: [{ id: 1, key: 'm2', label: 'M.2', count: 1 }],
            },
          },
        },
        'cpu:1': { id: 1, key: 'cpu:1', type: 'cpu', name: 'CPU' },
        'cpuCooler:1': { id: 1, key: 'cpuCooler:1', type: 'cpuCooler', name: 'Cooler' },
        'ram:1': { id: 1, key: 'ram:1', type: 'ram', name: 'Memory' },
        'storage:1': { id: 1, key: 'storage:1', type: 'storage', name: 'Storage' },
        'powerSupply:1': {
          id: 1,
          key: 'powerSupply:1',
          type: 'powerSupply',
          name: 'PSU',
          ports: canonicalPowerPorts({ type: 'powerSupply' }),
        },
      },
      placements: [{ itemType: 'pcBuild', itemId: 1, x: 0, y: 0 }],
      assignments: [
        {
          id: 1,
          hostType: 'pcBuild',
          hostId: 1,
          itemType: 'motherboard',
          itemId: 1,
          type: 'motherboard',
          allocation: { resourceType: 'motherboard', positions: [0] },
        },
        {
          id: 2,
          hostType: 'pcBuild',
          hostId: 1,
          itemType: 'cpu',
          itemId: 1,
          type: 'cpu',
          allocation: { resourceType: 'cpu', positions: [0] },
        },
        {
          id: 3,
          hostType: 'pcBuild',
          hostId: 1,
          itemType: 'cpuCooler',
          itemId: 1,
          type: 'cpuCooler',
          allocation: { resourceType: 'cooling', positions: [0] },
        },
        {
          id: 4,
          hostType: 'pcBuild',
          hostId: 1,
          itemType: 'ram',
          itemId: 1,
          type: 'ram',
          allocation: { resourceType: 'memory', positions: [0, 1] },
        },
        {
          id: 5,
          hostType: 'pcBuild',
          hostId: 1,
          itemType: 'storage',
          itemId: 1,
          type: 'storage',
          allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
        },
        {
          id: 6,
          hostType: 'pcBuild',
          hostId: 1,
          itemType: 'powerSupply',
          itemId: 1,
          type: 'powerSupply',
          allocation: { resourceType: 'power', positions: [0] },
        },
      ],
      connections: [],
    }

    expect(() => assertProjectShape(project)).not.toThrow()
  })

  it('rejects allocations that reference a missing host group', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [],
      assignments: [{
        id: 1,
        hostType: 'server',
        hostId: 1,
        itemType: 'storage',
        itemId: 1,
        type: 'storage',
        allocation: { resourceType: 'storage', groupId: 99, positions: [0] },
      }],
      connections: [],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project assignment 1 allocation.groupId references missing compatibility.host.storageSlots group 99.',
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
          hostType: 'server',
          hostId: 1,
          itemType: 'storage',
          itemId: 1,
          type: 'storage',
          allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
        },
        {
          id: 2,
          hostType: 'server',
          hostId: 1,
          itemType: 'storage',
          itemId: 2,
          type: 'storage',
          allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
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
  it('rejects string assignment IDs instead of coercing them', () => {
    expect(() => assertProjectStoreShape({
      placements: [],
      assignments: [
        { id: 1, hostType: 'server', hostId: 1, itemType: 'storage', itemId: 1, type: 'storage' },
        { id: '1', hostType: 'server', hostId: 1, itemType: 'storage', itemId: 2, type: 'storage' },
      ],
      connections: [],
    })).toThrow(
      'Project assignments[1].id must be a positive safe-integer relational ID.',
    )
  })

  it('rejects string connection IDs instead of coercing them', () => {
    const connection = (id) => ({
      id,
      from: { itemType: 'server', itemId: 1, portId: 1 },
      to: { itemType: 'switch', itemId: 1, portId: 1 },
      type: 'network',
      createdAt: '2026-07-19T00:00:00.000Z',
    })

    expect(() => assertProjectStoreShape({
      placements: [],
      assignments: [],
      connections: [connection(1), connection('1')],
    })).toThrow(
      'Project connections[1].id must be a positive safe-integer relational ID.',
    )
  })

  it('rejects assigning the same component record more than once', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [],
      assignments: [
        { id: 1, hostType: 'server', hostId: 1, itemType: 'storage', itemId: 1, type: 'storage' },
        { id: 2, hostType: 'server', hostId: 1, itemType: 'storage', itemId: 1, type: 'storage' },
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
        { id: 1, hostType: 'server', hostId: 1, itemType: 'storage', itemId: 1, type: 'gpu' },
      ],
      connections: [],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project assignments[0].type gpu does not match referenced inventory item storage:1 type storage.',
    )
  })

  it('rejects missing placement and assignment foreign-key references', () => {
    expect(() => assertProjectShape({
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [{ itemType: 'server', itemId: 99, x: 0, y: 0 }],
      assignments: [],
      connections: [],
    })).toThrow('Project placements[0] references missing item server:99.')

    expect(() => assertProjectShape({
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [],
      assignments: [
        { id: 1, hostType: 'server', hostId: 99, itemType: 'storage', itemId: 1, type: 'storage' },
      ],
      connections: [],
    })).toThrow('Project assignments[0] references missing host server:99.')

    expect(() => assertProjectShape({
      id: 'default',
      metadata: {},
      items: compatibleItems(),
      placements: [],
      assignments: [
        { id: 1, hostType: 'server', hostId: 1, itemType: 'storage', itemId: 99, type: 'storage' },
      ],
      connections: [],
    })).toThrow('Project assignments[0] references missing component storage:99.')
  })

  it('rejects missing connection owners, ports, sides, and hosted assignments', () => {
    const project = {
      id: 'default',
      metadata: {},
      items: {
        ...compatibleItems(),
        'server:1': {
          ...compatibleItems()['server:1'],
          ports: [{ id: 1, slotNumber: 1, kind: 'server-port', type: 'rj45' }],
        },
        'network:1': {
          id: 1,
          key: 'network:1',
          type: 'network',
          name: 'NIC',
          ports: [{ id: 1, slotNumber: 1, kind: 'server-port', type: 'rj45' }],
        },
        'patchPanel:1': {
          id: 1,
          key: 'patchPanel:1',
          type: 'patchPanel',
          name: 'Patch panel',
          ports: [{
            id: 1,
            slotNumber: 1,
            kind: 'keystone',
            type: 'rj45',
            endpoints: [
              { id: 1, side: 'front' },
              { id: 2, side: 'back' },
            ],
          }],
        },
      },
      placements: [],
      assignments: [],
      connections: [{
        id: 1,
        from: { itemId: 'server:1', portId: 99 },
        to: { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
        type: 'network',
        createdAt: '2026-07-20T00:00:00.000Z',
      }],
    }

    expect(() => assertProjectShape(project)).toThrow(
      'Project connections[0].from.portId references missing port 99 on server:1.',
    )

    expect(() => assertProjectShape({
      ...project,
      connections: [{
        ...project.connections[0],
        from: { itemId: 'server:1', hostedItemId: 'network:1', portId: 1 },
      }],
    })).toThrow(
      'Project connections[0].from hosted item network:1 is not assigned to host server:1.',
    )

    expect(() => assertProjectShape({
      ...project,
      connections: [{
        ...project.connections[0],
        from: { itemId: 'server:1', portId: 1 },
        to: { itemId: 'patchPanel:1', portId: 1 },
      }],
    })).toThrow(
      'Project connections[0].to.endpointId is required for multi-sided port 1.',
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
