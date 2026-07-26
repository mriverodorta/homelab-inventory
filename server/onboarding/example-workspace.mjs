import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'

const assignedAt = '2026-01-01T00:00:00.000Z'

const inventory = [
  {
    type: 'server',
    id: 1,
    name: 'Atlas Mini Server',
    manufacturer: 'Fictional Hardware Works',
    model: 'Atlas Mini',
    specs: { formFactor: 'Mini', wireless: 'No' },
    compatibility: {
      host: {
        cpu: {
          sockets: ['FCLGA1700'],
          generations: ['Fictional Gen 1'],
          maxTdpWatts: 65,
        },
        memory: {
          generations: ['DDR4'],
          slots: 2,
          maxCapacityGb: 64,
          maxModuleCapacityGb: 32,
          maxSpeedMt: 3200,
        },
        storageSlots: [{
          id: 1,
          key: 'atlas-m2',
          label: 'M.2 storage slot',
          count: 1,
          interfaces: ['NVMe'],
          formFactors: ['2280'],
          pcieGeneration: 4,
        }],
      },
    },
    ports: [
      { id: 1, key: 'board-nic-1', kind: 'server-port', type: 'rj45', slotNumber: 1, label: 'NIC 01', speed: '1G' },
      { id: 2, key: 'board-dp-1', kind: 'server-port', type: 'displayport', slotNumber: 2, label: 'DP 01' },
    ],
  },
  {
    type: 'cpu', id: 1, name: 'NovaCore 6C', manufacturer: 'Fictional Silicon Works',
    family: 'NovaCore', number: 'NC-6', specs: { cores: 6, threads: 12, baseClockGhz: 2.6, boostClockGhz: 4.2 },
    compatibility: {
      requirements: {
        cpu: { socket: 'FCLGA1700', generation: 'Fictional Gen 1', tdpWatts: 35 },
      },
    },
  },
  {
    type: 'ram', id: 1, name: '16 GB DDR4', manufacturer: 'Fictional Memory Works',
    family: 'DDR4',
    specs: {
      capacityGb: 16,
      modules: '2x8GB',
      moduleCount: 2,
      generation: 'DDR4',
      speedMhz: 3200,
      speedMt: 3200,
    },
  },
  {
    type: 'storage', id: 1, name: '512 GB NVMe', manufacturer: 'Fictional Storage Works',
    specs: { capacityGb: 512, interface: 'NVMe', formFactor: '2280', media: 'SSD' },
  },
  withCanonicalPowerPorts({
    type: 'powerAdapter', id: 1, name: 'Atlas 90W', manufacturer: 'Fictional Hardware Works',
    specs: { wattageWatts: 90, connector: 'Slim tip' },
  }),
  {
    type: 'switch', id: 1, name: 'Relay 8-port Switch', manufacturer: 'Fictional Network Works',
    model: 'Relay 8', specs: { management: 'Web managed', fanless: true },
    ports: Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      key: `port-${index + 1}`,
      kind: 'switch-port',
      type: 'rj45',
      slotNumber: index + 1,
      speed: '1G',
      role: index === 7 ? 'uplink' : 'access',
    })),
  },
  {
    type: 'patchPanel', id: 1, name: 'Bridge 8-port Patch Panel', manufacturer: 'Fictional Network Works',
    model: 'Bridge 8', specs: { rackUnits: 1 },
    ports: Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      key: `keystone-${index + 1}`,
      kind: 'keystone',
      type: 'rj45',
      slotNumber: index + 1,
      endpoints: [{ id: 1, side: 'front' }, { id: 2, side: 'back' }],
    })),
  },
  withCanonicalPowerPorts({
    type: 'ups', id: 1, name: 'Anchor 750VA UPS', manufacturer: 'Fictional Power Works',
    model: 'Anchor 750', specs: { capacityVa: 750, outlets: 6, batteryBackupOutlets: 4, surgeProtectedOutlets: 2 },
  }),
  withCanonicalPowerPorts({
    type: 'powerStrip', id: 1, name: 'Beam 4-outlet Power Strip', manufacturer: 'Fictional Power Works',
    model: 'Beam 4', specs: { outlets: 4, surgeProtectedOutlets: 4 },
  }),
]

export const EXAMPLE_WORKSPACE_TEMPLATE = Object.freeze({
  version: 1,
  inventory,
  placements: [
    { itemType: 'patchPanel', itemId: 1, x: 120, y: 100 },
    { itemType: 'switch', itemId: 1, x: 650, y: 100 },
    { itemType: 'server', itemId: 1, x: 120, y: 450 },
    { itemType: 'powerStrip', itemId: 1, x: 520, y: 470 },
    { itemType: 'ups', itemId: 1, x: 1100, y: 430 },
  ],
  assignments: [
    { id: 1, hostType: 'server', hostId: 1, itemType: 'cpu', itemId: 1, type: 'cpu', assignedAt },
    { id: 2, hostType: 'server', hostId: 1, itemType: 'ram', itemId: 1, type: 'ram', assignedAt },
    {
      id: 3,
      hostType: 'server',
      hostId: 1,
      itemType: 'storage',
      itemId: 1,
      type: 'storage',
      assignedAt,
      allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
    },
    { id: 4, hostType: 'server', hostId: 1, itemType: 'powerAdapter', itemId: 1, type: 'powerAdapter', assignedAt },
  ],
  connections: [
    {
      id: 1,
      from: { itemType: 'server', itemId: 1, portId: 1 },
      to: { itemType: 'patchPanel', itemId: 1, portId: 1, endpointId: 2 },
      type: 'network', negotiatedSpeedMbps: 1000, createdAt: assignedAt,
      route: { sourceSide: 'top', targetSide: 'bottom' },
    },
    {
      id: 2,
      from: { itemType: 'patchPanel', itemId: 1, portId: 1, endpointId: 1 },
      to: { itemType: 'switch', itemId: 1, portId: 1 },
      type: 'network', negotiatedSpeedMbps: 1000, createdAt: assignedAt,
      route: { sourceSide: 'right', targetSide: 'left' },
    },
    {
      id: 3,
      from: { itemType: 'powerStrip', itemId: 1, portId: 2 },
      to: { itemType: 'server', itemId: 1, hostedItemType: 'powerAdapter', hostedItemId: 1, portId: 1 },
      type: 'power', createdAt: assignedAt,
      route: { sourceSide: 'left', targetSide: 'right' },
    },
    {
      id: 4,
      from: { itemType: 'ups', itemId: 1, portId: 1 },
      to: { itemType: 'powerStrip', itemId: 1, portId: 1 },
      type: 'power', createdAt: assignedAt,
      route: { sourceSide: 'left', targetSide: 'right' },
    },
  ],
})

export function cloneExampleWorkspaceTemplate() {
  return structuredClone(EXAMPLE_WORKSPACE_TEMPLATE)
}
