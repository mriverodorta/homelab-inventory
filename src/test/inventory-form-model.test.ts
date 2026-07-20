import { describe, expect, it } from 'vitest'
import {
  createInventoryFormValues,
  inventoryFormValuesToInput,
  inventoryItemToFormValues,
  inventoryPortsToFormPatch,
  MAX_PORT_GROUP_COUNT,
  reconcilePorts,
  validateInventoryFormValues,
} from '@/components/inventory-form/model'
import {
  COOLER_TYPES,
  CPU_GENERATIONS,
  EXPANSION_INTERFACE_FAMILIES,
  MOTHERBOARD_FORM_FACTORS,
  PCIE_GENERATIONS,
  PCIE_LANE_WIDTHS,
  POWER_EFFICIENCY_RATINGS,
  PSU_FORM_FACTORS,
  STORAGE_INTERFACES,
  SWITCH_MANAGEMENT_OPTIONS,
  WIFI_GENERATIONS,
  withLegacyOption,
} from '@/components/inventory-form/options'
import type { InventoryItem, InventoryType } from '@/types/inventory'

function fixtureFor(type: InventoryType): InventoryItem {
  const common = {
    id: 42,
    type,
    name: `${type} fixture`,
    manufacturer: 'Fixture Corp',
    model: 'Model 1',
    notes: 'Kept during editing',
  } satisfies InventoryItem

  switch (type) {
    case 'server':
      return {
        ...common,
        specs: { formFactor: 'Micro', networkSlot: 'M.2 A+E', wireless: 'Yes' },
        ports: [
          { id: 7, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G' },
        ],
      }
    case 'nas':
      return { ...common, specs: { driveBays: 6, m2Slots: 2 } }
    case 'cpu':
      return {
        ...common,
        family: 'Core i7',
        number: 'i7-10700T',
        specs: { cores: 8, threads: 16, baseClockGhz: 2, boostClockGhz: 4.5 },
      }
    case 'ram':
      return {
        ...common,
        secondaryManufacturer: 'Second Corp',
        specs: { capacityGb: 32, generation: 'DDR4', speedMt: 3200, secondarySpeedMt: 2666 },
      }
    case 'storage':
      return { ...common, specs: { capacityTb: 4, interface: 'NVMe', formFactor: '2280' } }
    case 'gpu':
      return {
        ...common,
        specs: {
          vramGb: 8,
          formFactor: 'Low profile',
          slotWidth: 'Single slot',
          pcie: 'PCIe 4.0 x8',
        },
      }
    case 'network':
      return {
        ...common,
        specs: { ports: 2, speedMbps: 10000, interface: 'PCIe 3.0 x8', formFactor: 'Low profile' },
        ports: [
          { id: 1, kind: 'server-port', type: 'sfp-plus', slotNumber: 1, speed: '10G', role: 'access' },
          { id: 2, kind: 'server-port', type: 'sfp-plus', slotNumber: 2, speed: '10G', role: 'access' },
        ],
      }
    case 'switch':
      return {
        ...common,
        specs: { management: 'Omada managed', switchingCapacityGbps: 80, fanless: true },
        ports: [
          { id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '2.5G', role: 'access' },
          { id: 2, kind: 'switch-port', type: 'rj45', slotNumber: 2, speed: '2.5G', role: 'access' },
        ],
      }
    case 'patchPanel':
      return {
        ...common,
        specs: { rackUnits: 1, mount: 'Rack mounted' },
        ports: [
          {
            id: 1,
            kind: 'keystone',
            type: 'rj45',
            slotNumber: 1,
            endpoints: [
              { id: 1, side: 'front' },
              { id: 2, side: 'back' },
            ],
          },
        ],
      }
    default:
      throw new Error(`Fixture not implemented for ${type}`)
  }
}

const newTypeFixtures: InventoryItem[] = [
  {
    id: 101,
    type: 'pcBuild',
    name: 'Gaming PC',
    specs: { operatingSystem: 'Windows 11 Pro', role: 'Gaming' },
  },
  {
    id: 102,
    type: 'motherboard',
    name: 'ASUS ROG Strix B650E-I',
    manufacturer: 'ASUS',
    model: 'ROG Strix B650E-I',
    specs: { formFactor: 'Mini-ITX', cpuSocketCount: 1 },
    compatibility: {
      host: {
        cpu: { sockets: ['AM5'], generations: ['AMD Zen 4'], maxTdpWatts: 170 },
        memory: {
          generations: ['DDR5'],
          slots: 2,
          maxCapacityGb: 96,
          maxModuleCapacityGb: 48,
          maxSpeedMt: 7600,
        },
        storageSlots: [{
          id: 'm2-primary',
          label: 'M.2 Primary',
          count: 2,
          interfaces: ['NVMe'],
          formFactors: ['2280'],
          pcieGeneration: 4,
        }],
        expansionSlots: [{
          id: 'pcie-main',
          label: 'PCIe Main',
          count: 1,
          interfaceFamily: 'pcie',
          pcieGeneration: 5,
          mechanicalLanes: 16,
          electricalLanes: 16,
          acceptedHeights: ['full-height'],
          maxSlotWidth: 3,
          maxPowerWatts: 75,
        }],
        maxExpansionPowerWatts: 75,
      },
    },
    ports: [
      { id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '2.5G', label: '' },
      { id: 2, kind: 'server-port', type: 'hdmi', slotNumber: 2, label: '' },
    ],
  },
  {
    id: 103,
    type: 'cpuCooler',
    name: 'Noctua NH-L12S',
    specs: { coolerType: 'air' },
  },
  {
    id: 104,
    type: 'case',
    name: 'Fractal Design North',
    specs: { formFactors: 'Mini-ITX, Micro-ATX, ATX' },
  },
  {
    id: 105,
    type: 'powerSupply',
    name: 'Corsair SF750',
    specs: { formFactor: 'SFX', wattageWatts: 750, efficiency: '80 Plus Platinum' },
  },
  {
    id: 106,
    type: 'soundCard',
    name: 'Sound Blaster AE-7',
    specs: { interface: 'PCIe' },
  },
  {
    id: 107,
    type: 'wireless',
    name: 'Intel AX210',
    specs: { interface: 'M.2 A+E', wifiGeneration: 'Wi-Fi 6E', bluetooth: true },
  },
  {
    id: 108,
    type: 'powerAdapter',
    name: 'Dell 90W AC Adapter',
    specs: { wattageWatts: 90, connector: 'Barrel' },
  },
  {
    id: 109,
    type: 'monitor',
    name: 'Dell UltraSharp U2723QE',
    specs: { sizeInches: 27, resolution: '3840x2160', refreshRateHz: 60 },
  },
  {
    id: 110,
    type: 'ups',
    name: 'APC Back-UPS Pro',
    specs: {
      wattageWatts: 900,
      capacityVa: 1500,
      batteryBackupOutlets: 5,
      surgeProtectedOutlets: 5,
      outlets: 10,
    },
  },
  {
    id: 111,
    type: 'powerStrip',
    name: 'Kasa Smart Plug Power Strip',
    specs: { outlets: 6, surgeProtected: true, surgeProtectedOutlets: 6 },
  },
]

describe('inventory form model', () => {
  it('creates blank compatibility drafts without inventing support data', () => {
    const values = createInventoryFormValues('server')

    expect(values.hostCpuSockets).toEqual([])
    expect(values.hostMemoryGenerations).toEqual([])
    expect(values.storageSlotGroups).toEqual([])
    expect(values.expansionSlotGroups).toEqual([])
    expect(values.preservedCompatibility).toEqual({})

    values.name = 'Unknown chassis'
    expect(inventoryFormValuesToInput(values)).not.toHaveProperty('compatibility')
  })

  it('round trips host compatibility resource groups with stable IDs', () => {
    const item: InventoryItem = {
      id: 1,
      type: 'server',
      name: 'Compatible host',
      compatibility: {
        host: {
          cpu: { sockets: ['LGA1200'], generations: ['Intel 10th Gen'], maxTdpWatts: 65 },
          memory: {
            generations: ['DDR4'],
            slots: 2,
            maxCapacityGb: 64,
            maxModuleCapacityGb: 32,
            maxSpeedMt: 3200,
          },
          storageSlots: [{
            id: 'm2-primary',
            label: 'M.2 Primary',
            count: 1,
            interfaces: ['NVMe'],
            formFactors: ['2280'],
            pcieGeneration: 3,
          }],
          expansionSlots: [{
            id: 'pcie-main',
            label: 'PCIe Main',
            count: 1,
            interfaceFamily: 'pcie',
            pcieGeneration: 3,
            mechanicalLanes: 16,
            electricalLanes: 8,
            acceptedHeights: ['low-profile'],
            maxSlotWidth: 2,
            maxPowerWatts: 75,
          }],
          maxExpansionPowerWatts: 100,
        },
      },
    }

    const values = inventoryItemToFormValues(item)
    expect(values.storageSlotGroups[0].id).toBe('m2-primary')
    expect(values.expansionSlotGroups[0].id).toBe('pcie-main')
    expect(inventoryFormValuesToInput(values).compatibility).toEqual(item.compatibility)
  })

  it('round trips CPU and expansion requirements and omits cleared values', () => {
    const cpu = inventoryItemToFormValues({
      id: 2,
      type: 'cpu',
      name: 'CPU',
      compatibility: { requirements: { cpu: { socket: 'LGA1200', generation: 'Intel 10th Gen', tdpWatts: 35 } } },
    })
    expect(inventoryFormValuesToInput(cpu).compatibility).toEqual({
      requirements: { cpu: { socket: 'LGA1200', generation: 'Intel 10th Gen', tdpWatts: 35 } },
    })

    const network = inventoryItemToFormValues({
      id: 3,
      type: 'network',
      name: 'NIC',
      compatibility: {
        requirements: {
          expansion: {
            interfaceFamily: 'pcie',
            pcieGeneration: 3,
            connectorLanes: 8,
            minimumElectricalLanes: 4,
            height: 'low-profile',
            slotWidth: 1,
            powerWatts: 12,
          },
        },
      },
    })
    expect(inventoryFormValuesToInput(network).compatibility).toEqual({
      requirements: {
        expansion: {
          interfaceFamily: 'pcie',
          pcieGeneration: 3,
          connectorLanes: 8,
          minimumElectricalLanes: 4,
          height: 'low-profile',
          slotWidth: 1,
          powerWatts: 12,
        },
      },
    })

    network.expansionPowerWatts = ''
    expect(inventoryFormValuesToInput(network).compatibility?.requirements?.expansion)
      .not.toHaveProperty('powerWatts')
  })

  it('persists RAM moduleCount as a canonical spec', () => {
    const values = inventoryItemToFormValues({
      id: 4,
      type: 'ram',
      name: '32GB DDR4',
      specs: { capacityGb: 32, generation: 'DDR4', moduleCount: 2 },
    })

    expect(values.moduleCount).toBe('2')
    expect(inventoryFormValuesToInput(values).specs).toEqual({
      capacityGb: 32,
      generation: 'DDR4',
      moduleCount: 2,
    })
  })

  it('preserves unknown compatibility fields while editing known values', () => {
    const item = {
      id: 5,
      type: 'server' as const,
      name: 'Legacy host',
      compatibility: {
        legacyRoot: { keep: true },
        host: {
          legacyHost: 'keep-me',
          cpu: { sockets: ['LGA1151'], legacyCpu: 42 },
          storageSlots: [{
            id: 'legacy-slot',
            label: 'Legacy slot',
            count: 1,
            interfaces: ['SATA'],
            legacyGroup: 'keep-group',
          }],
        },
      },
    } as unknown as InventoryItem

    const values = inventoryItemToFormValues(item)
    values.hostCpuMaxTdpWatts = '65'
    const compatibility = inventoryFormValuesToInput(values).compatibility as unknown as Record<string, any>

    expect(compatibility.legacyRoot).toEqual({ keep: true })
    expect(compatibility.host.legacyHost).toBe('keep-me')
    expect(compatibility.host.cpu.legacyCpu).toBe(42)
    expect(compatibility.host.storageSlots[0].legacyGroup).toBe('keep-group')
    expect(compatibility.host.cpu.maxTdpWatts).toBe(65)
  })

  it('exposes canonical constrained compatibility choices', () => {
    expect(CPU_GENERATIONS).toContain('Intel 10th Gen')
    expect(STORAGE_INTERFACES).toContain('NVMe')
    expect(PCIE_GENERATIONS).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(PCIE_LANE_WIDTHS).toEqual(['1', '2', '4', '8', '16'])
    expect(EXPANSION_INTERFACE_FAMILIES).toEqual(['pcie', 'm2-ae', 'usb', 'onboard'])
    expect(MOTHERBOARD_FORM_FACTORS).toContain('Mini-ITX')
    expect(PSU_FORM_FACTORS).toContain('SFX')
    expect(COOLER_TYPES).toEqual(['air', 'aio', 'custom-loop', 'passive'])
    expect(POWER_EFFICIENCY_RATINGS).toContain('80 Plus Platinum')
    expect(WIFI_GENERATIONS).toContain('Wi-Fi 6E')
  })

  it.each(newTypeFixtures)('round trips $type create and edit fields', (item) => {
    const rebuilt = inventoryFormValuesToInput(inventoryItemToFormValues(item))

    expect(rebuilt).toMatchObject({
      type: item.type,
      name: item.name,
      ...(item.manufacturer ? { manufacturer: item.manufacturer } : {}),
      ...(item.model ? { model: item.model } : {}),
      ...(item.specs ? { specs: item.specs } : {}),
    })
    expect(rebuilt.compatibility).toEqual(item.compatibility)
    expect(rebuilt.ports).toEqual(item.ports)
  })

  it('serializes PC Build operating-system metadata without assignment fields', () => {
    const values = createInventoryFormValues('pcBuild')
    values.name = 'Gaming PC'
    values.operatingSystem = 'Windows 11 Pro'
    values.role = 'Gaming'

    expect(inventoryFormValuesToInput(values)).toEqual({
      name: 'Gaming PC',
      type: 'pcBuild',
      specs: { operatingSystem: 'Windows 11 Pro', role: 'Gaming' },
    })
  })

  it('serializes motherboard DIMM, resource, and rear-I/O definitions', () => {
    const item = newTypeFixtures.find((fixture) => fixture.type === 'motherboard')!
    const rebuilt = inventoryFormValuesToInput(inventoryItemToFormValues(item))

    expect(rebuilt.specs).toEqual({ formFactor: 'Mini-ITX', cpuSocketCount: 1 })
    expect(rebuilt.compatibility?.host?.memory).toEqual(item.compatibility?.host?.memory)
    expect(rebuilt.compatibility?.host?.storageSlots).toEqual(item.compatibility?.host?.storageSlots)
    expect(rebuilt.compatibility?.host?.expansionSlots).toEqual(item.compatibility?.host?.expansionSlots)
    expect(rebuilt.ports).toEqual(item.ports)
  })

  it('serializes power outlet classifications without assignment-only fields', () => {
    const ups = inventoryFormValuesToInput(inventoryItemToFormValues(
      newTypeFixtures.find((fixture) => fixture.type === 'ups')!,
    ))
    const powerStrip = inventoryFormValuesToInput(inventoryItemToFormValues(
      newTypeFixtures.find((fixture) => fixture.type === 'powerStrip')!,
    ))

    expect(ups.specs).toEqual({
      wattageWatts: 900,
      capacityVa: 1500,
      batteryBackupOutlets: 5,
      surgeProtectedOutlets: 5,
      outlets: 10,
    })
    expect(powerStrip.specs).toEqual({
      outlets: 6,
      surgeProtected: true,
      surgeProtectedOutlets: 6,
    })
    expect(ups).not.toHaveProperty('properties')
    expect(powerStrip).not.toHaveProperty('properties')
  })

  it.each([
    'server',
    'nas',
    'cpu',
    'ram',
    'storage',
    'gpu',
    'network',
    'switch',
    'patchPanel',
  ] as const)('preserves %s identity and type-specific fields', (type) => {
    const item = fixtureFor(type)
    const values = inventoryItemToFormValues(item)
    const rebuilt = inventoryFormValuesToInput(values)

    expect(rebuilt.type).toBe(type)
    expect(rebuilt.name).toBe(item.name)
    expect(rebuilt.manufacturer).toBe(item.manufacturer)
    expect(rebuilt.model).toBe(item.model)
    expect(rebuilt.notes).toBe(item.notes)
    expect(rebuilt.specs).toEqual(item.specs)
  })

  it('exposes the approved switch management values and keeps legacy values selectable', () => {
    expect(SWITCH_MANAGEMENT_OPTIONS).toEqual([
      'Unmanaged',
      'Smart / Web-managed',
      'Layer 2 Managed',
      'Layer 2+ Managed',
      'Layer 3 Managed',
      'Controller / Cloud-managed',
    ])
    expect(withLegacyOption(SWITCH_MANAGEMENT_OPTIONS, 'Omada managed')).toContain('Omada managed')
    expect(withLegacyOption(SWITCH_MANAGEMENT_OPTIONS, 'Layer 2 Managed')).toEqual(
      SWITCH_MANAGEMENT_OPTIONS,
    )
  })

  it('reports invalid numeric fields without converting them into persisted values', () => {
    const values = {
      ...createInventoryFormValues('cpu'),
      name: 'Invalid CPU',
      cores: 'six',
      threads: '-1',
      baseClockGhz: 'fast',
    }

    expect(validateInventoryFormValues(values)).toMatchObject({
      cores: expect.any(String),
      threads: expect.any(String),
      baseClockGhz: expect.any(String),
    })
  })

  it('requires a name and a supported speed for switch network ports', () => {
    const values = {
      ...createInventoryFormValues('switch'),
      portGroups: [
        { id: 1, count: 4, type: 'sfp-plus' as const, speed: '', role: 'uplink' as const },
      ],
    }

    expect(validateInventoryFormValues(values)).toMatchObject({
      name: 'Name is required.',
      portGroups: expect.stringContaining('SFP+'),
    })
  })

  it('builds patch-panel front and back endpoints from port groups', () => {
    const values = {
      ...createInventoryFormValues('patchPanel'),
      name: 'Patch panel',
      portGroups: [
        { id: 1, count: 2, type: 'rj45' as const, speed: '', role: 'access' as const },
      ],
    }

    expect(inventoryFormValuesToInput(values).ports).toEqual([
      expect.objectContaining({
        id: 1,
        kind: 'keystone',
        slotNumber: 1,
        endpoints: [
          { id: 1, side: 'front' },
          { id: 2, side: 'back' },
        ],
      }),
      expect.objectContaining({ id: 2, kind: 'keystone', slotNumber: 2 }),
    ])
  })

  it('does not invent ports when adapting an existing empty chassis', () => {
    const values = inventoryItemToFormValues({
      id: 9,
      type: 'nas',
      name: 'Empty NAS',
      specs: { driveBays: 4 },
    })

    expect(values.portGroups).toEqual([])
    expect(inventoryFormValuesToInput(values).ports).toBeUndefined()
  })

  it('retains existing port IDs and metadata while applying edited group structure', () => {
    const originalPorts = [
      {
        id: 'uplink-a',
        kind: 'switch-port' as const,
        type: 'rj45' as const,
        slotNumber: 4,
        label: 'Core uplink',
        notes: 'Do not remove',
        ipAddress: '10.0.0.2',
        role: 'access' as const,
        speed: '1G',
        poe: true,
        endpoints: [{ id: 'front-a', side: 'front' as const }],
      },
      {
        id: 9,
        kind: 'switch-port' as const,
        type: 'rj45' as const,
        slotNumber: 5,
        label: '',
        role: 'access' as const,
        speed: '1G',
      },
    ]
    const values = inventoryItemToFormValues({
      id: 1,
      type: 'switch',
      name: 'Editable switch',
      ports: originalPorts,
    })
    values.portGroups[0] = {
      ...values.portGroups[0],
      count: 3,
      type: 'sfp-plus',
      speed: '10G',
      role: 'uplink',
    }

    const ports = reconcilePorts('switch', values.portGroups, values.originalPorts)

    expect(ports).toEqual([
      {
        id: 'uplink-a',
        kind: 'switch-port',
        type: 'sfp-plus',
        slotNumber: 1,
        label: 'Core uplink',
        notes: 'Do not remove',
        ipAddress: '10.0.0.2',
        role: 'uplink',
        speed: '10G',
        poe: true,
        endpoints: [{ id: 'front-a', side: 'front' }],
      },
      {
        id: 9,
        kind: 'switch-port',
        type: 'sfp-plus',
        slotNumber: 2,
        label: '',
        role: 'uplink',
        speed: '10G',
      },
      {
        id: 10,
        kind: 'switch-port',
        type: 'sfp-plus',
        slotNumber: 3,
        label: '',
        role: 'uplink',
        speed: '10G',
      },
    ])
    expect(inventoryFormValuesToInput(values).ports).toEqual(ports)
  })

  it('does not silently remove an existing port with protected metadata', () => {
    const values = inventoryItemToFormValues({
      id: 2,
      type: 'network',
      name: 'Dual port NIC',
      ports: [
        { id: 20, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G' },
        {
          id: 21,
          kind: 'server-port',
          type: 'rj45',
          slotNumber: 2,
          speed: '1G',
          notes: 'Connected in the project',
        },
      ],
    })
    values.portGroups[0] = { ...values.portGroups[0], count: 1 }

    expect(() => inventoryFormValuesToInput(values)).toThrow(/protected port 21/i)
  })

  it('keeps legacy string-valued capacityTb in TB after round-trip', () => {
    const item: InventoryItem = {
      id: 3,
      type: 'storage',
      name: 'Legacy storage',
      specs: { capacityTb: '4', interface: 'NVMe' },
    }

    const values = inventoryItemToFormValues(item)

    expect(values.storageUnit).toBe('TB')
    expect(values.capacity).toBe('4')
    expect(inventoryFormValuesToInput(values).specs).toMatchObject({ capacityTb: 4 })
    expect(inventoryFormValuesToInput(values).specs).not.toHaveProperty('capacityGb')
  })

  it('supports the existing 128-port switch ceiling without clamping', () => {
    const values = createInventoryFormValues('switch')
    values.name = 'Large switch'
    values.portGroups[0] = {
      ...values.portGroups[0],
      count: MAX_PORT_GROUP_COUNT,
    }

    expect(validateInventoryFormValues(values).portGroups).toBeUndefined()
    expect(inventoryFormValuesToInput(values).ports).toHaveLength(128)

    values.portGroups[0] = {
      ...values.portGroups[0],
      count: MAX_PORT_GROUP_COUNT + 1,
    }

    expect(validateInventoryFormValues(values).portGroups).toMatch(/0 to 128/)
  })

  it('keeps detailed port edits synchronized with grouped form values', () => {
    const ports = [
      {
        id: 'nic-1',
        kind: 'server-port' as const,
        type: 'rj45' as const,
        slotNumber: 1,
        speed: '2.5G',
        label: 'Management',
        notes: 'Static address',
        ipAddress: '192.168.1.20',
      },
    ]

    const patch = inventoryPortsToFormPatch(ports)

    expect(patch.portGroups).toEqual([
      expect.objectContaining({
        count: 1,
        type: 'rj45',
        speed: '2.5G',
        originalPortIds: ['nic-1'],
      }),
    ])
    expect(patch.originalPorts).toEqual(ports)
    expect(patch.originalPorts[0]).not.toBe(ports[0])
  })
})
