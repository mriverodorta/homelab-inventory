import type { InventoryItemInput } from '@/lib/db'
import {
  getSwitchPortSpeedForType,
  isSupportedSwitchPortSpeed,
  isSwitchNetworkPortType,
} from '@/lib/switch-ports'
import type {
  CardHeight,
  ExpansionInterfaceFamily,
  InventoryCompatibility,
} from '@/types/compatibility'
import type {
  EquipmentUsageRole,
  HardwareClass,
  InventoryItem,
  InventoryPort,
  InventoryPortRole,
  InventoryPortType,
  InventoryProperties,
  InventorySpecs,
  InventoryType,
  SmartPowerStripOutletName,
} from '@/types/inventory'
import { canonicalPowerPorts } from '../../../shared/power-ports.mjs'
import { formatPortTypeLabel } from './options'

export type PortGroup = {
  id: number
  count: number
  type: InventoryPortType
  speed: string
  role: InventoryPortRole
  originalPortIds?: Array<string | number>
}

export type StorageSlotGroupDraft = {
  draftKey: string
  id?: number
  key: string
  label: string
  count: string
  interfaces: string[]
  formFactors: string[]
  pcieGeneration: string
  location: string
  hotSwap?: boolean
  backplane: string
  controllerSlotIds: string
  directConnect?: boolean
}

export type ExpansionSlotGroupDraft = {
  draftKey: string
  id?: number
  key: string
  label: string
  count: string
  interfaceFamily: string
  pcieGeneration: string
  mechanicalLanes: string
  electricalLanes: string
  acceptedHeights: string[]
  maxSlotWidth: string
  maxPowerWatts: string
  proprietaryRiser?: boolean
  riserCapability: string
  requiredCpuSockets: string
  riserGroup: string
}

export type OptionalModuleSlotGroupDraft = {
  draftKey: string
  id?: number
  key: string
  label: string
  count: string
  acceptedModuleKinds: string[]
}

export type MotherboardPowerConnectorDraft = {
  draftKey: string
  id?: number
  key: string
  label: string
  kind: '' | 'main-power' | 'cpu-power'
  connector: string
  count: string
  required: boolean
}

export type PowerSupplyConnectorDraft = {
  draftKey: string
  connector: string
  count: string
}

export type InventoryFormValues = {
  type: InventoryType
  hardwareClass: HardwareClass
  usageRole: EquipmentUsageRole
  name: string
  aliases: string[]
  manufacturer: string
  secondaryManufacturer: string
  model: string
  family: string
  number: string
  serialNumber: string
  notes: string
  formFactor: string
  chipset: string
  boardRevision: string
  launchDate: string
  discontinued: '' | 'yes' | 'no'
  motherboardBluetooth: string
  networkSlot: string
  wireless: string
  driveBays: string
  m2Slots: string
  powerConfiguration: '' | 'internal-psu' | 'external-adapter'
  cores: string
  threads: string
  baseClockGhz: string
  boostClockGhz: string
  capacityGb: string
  generation: string
  speedMt: string
  secondarySpeedMt: string
  moduleCount: string
  ramFormFactor: string
  ramModuleType: string
  ramEcc: '' | 'yes' | 'no'
  ramRank: string
  ramVoltageVolts: string
  capacity: string
  storageUnit: 'GB' | 'TB'
  interface: string
  storageFormFactor: string
  storagePartitionTable: string
  vramGb: string
  gpuFormFactor: string
  slotWidth: string
  pcie: string
  networkFormFactor: string
  management: string
  switchingCapacityGbps: string
  fanless: boolean
  rackUnits: string
  mount: string
  operatingSystem: string
  role: string
  coolerType: '' | 'air' | 'aio' | 'custom-loop' | 'passive'
  caseFormFactors: string[]
  psuFormFactor: string
  ratedWatts: string
  efficiencyRating: string
  wifiGeneration: string
  bluetooth: '' | 'yes' | 'no'
  displaySizeInches: string
  resolution: string
  refreshRateHz: string
  upsWatts: string
  upsVoltAmps: string
  batteryOutletCount: string
  surgeOutletCount: string
  outletCount: string
  surgeProtected: '' | 'yes' | 'no'
  smartEnabled: boolean
  smartDisplayName: string
  smartManagementIp: string
  smartMacAddress: string
  smartOutletNames: SmartPowerStripOutletName[]
  adapterOutputWatts: string
  dcConnector: string
  cpuSocketCount: string
  portGroups: PortGroup[]
  originalPorts: InventoryPort[]
  preservedSpecs: InventorySpecs
  hostCpuSockets: string[]
  hostCpuGenerations: string[]
  hostCpuMaxTdpWatts: string
  hostCpuSocketCount: string
  hostCpuPopulationModes: string[]
  hostTopologyCompleteness: '' | 'complete' | 'partial' | 'conflicting'
  hostMemoryGenerations: string[]
  hostMemorySlots: string
  hostMemoryMaxCapacityGb: string
  hostMemoryMaxModuleCapacityGb: string
  hostMemoryMaxSpeedMt: string
  hostMemoryEccSupport: '' | 'supported' | 'unsupported' | 'conditional' | 'unknown'
  hostMemorySlotsPerCpu: string
  hostMemoryFormFactors: string[]
  hostMemoryModuleTypes: string[]
  storageSlotGroups: StorageSlotGroupDraft[]
  expansionSlotGroups: ExpansionSlotGroupDraft[]
  optionalModuleSlotGroups: OptionalModuleSlotGroupDraft[]
  motherboardPowerConnectors: MotherboardPowerConnectorDraft[]
  powerSupplyConnectors: PowerSupplyConnectorDraft[]
  hostMaxExpansionPowerWatts: string
  hostPowerConfiguration: string
  hostPowerConnector: string
  hostPowerSupportedWattagesWatts: string
  hostPowerAdapterRequired: '' | 'yes' | 'no'
  hostPowerAdapterType: string
  hostPowerRedundancy: string
  hostPowerMaxGraphicsPowerWatts: string
  hostPowerPsuBayCount: string
  hostPowerPsuType: string
  hostPowerMixedPsuAllowed: '' | 'yes' | 'no'
  hostPowerRedundancyModes: string[]
  hostAdvancedTopologyJson: string
  cpuSocket: string
  cpuGeneration: string
  cpuTdpWatts: string
  expansionInterfaceFamily: string
  expansionPcieGeneration: string
  expansionConnectorLanes: string
  expansionMinimumElectricalLanes: string
  expansionHeight: string
  expansionSlotWidth: string
  expansionPowerWatts: string
  preservedCompatibility: InventoryCompatibility
  subtype?: string
  properties?: InventoryProperties
}

export type InventoryFormErrors = Partial<Record<keyof InventoryFormValues, string>>

export type InventoryGroupValidationTarget = {
  index: number
  field: 'count' | 'speed'
}

export const MAX_PORT_GROUP_COUNT = 128

const KNOWN_SPEC_KEYS: Partial<Record<InventoryType, string[]>> = {
  server: ['formFactor', 'networkSlot', 'wireless'],
  nas: ['driveBays', 'm2Slots', 'powerConfiguration'],
  cpu: ['cores', 'threads', 'baseClockGhz', 'boostClockGhz'],
  ram: ['capacityGb', 'generation', 'speedMt', 'formFactor', 'moduleType', 'ecc', 'rank', 'voltageVolts'],
  storage: ['capacityGb', 'capacityTb', 'interface', 'formFactor', 'serialNumber', 'partitionTable'],
  gpu: ['vramGb', 'formFactor', 'slotWidth', 'pcie'],
  network: ['ports', 'speedMbps', 'interface', 'formFactor'],
  switch: ['management', 'switchingCapacityGbps', 'fanless'],
  patchPanel: ['rackUnits', 'mount'],
  pcBuild: ['operatingSystem', 'role'],
  motherboard: [
    'chipset',
    'formFactor',
    'boardRevision',
    'launchDate',
    'discontinued',
    'wifiGeneration',
    'bluetooth',
  ],
  cpuCooler: ['coolerType'],
  case: ['formFactors'],
  powerSupply: ['formFactor', 'wattageWatts', 'efficiency', 'connectors'],
  soundCard: ['interface'],
  wireless: ['interface', 'wifiGeneration', 'bluetooth'],
  powerAdapter: ['wattageWatts', 'connector'],
  monitor: ['sizeInches', 'resolution', 'refreshRateHz'],
  ups: ['wattageWatts', 'capacityVa', 'batteryBackupOutlets', 'surgeProtectedOutlets', 'outlets'],
  powerStrip: ['outlets', 'surgeProtected', 'surgeProtectedOutlets'],
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function cleanString(value: string): string | undefined {
  const clean = value.trim()
  return clean === '' || clean === 'none' ? undefined : clean
}

function numberValue(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : []
}

function commaSeparatedStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return stringArray(value)
  return typeof value === 'string'
    ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
    : []
}

function cloneCompatibility(value: InventoryCompatibility | undefined): InventoryCompatibility {
  return value ? structuredClone(value) : {}
}

const ADVANCED_HOST_TOPOLOGY_KEYS = [
  'controllerSlots',
  'bootDeviceSlots',
  'coolingProfiles',
  'management',
  'constraintGroups',
  'fixedPorts',
] as const

function advancedHostTopologyJson(host: InventoryCompatibility['host']): string {
  if (!host) return ''
  const topology = Object.fromEntries(
    ADVANCED_HOST_TOPOLOGY_KEYS
      .filter((key) => host[key] !== undefined)
      .map((key) => [key, structuredClone(host[key])]),
  )
  return Object.keys(topology).length ? JSON.stringify(topology, null, 2) : ''
}

function parseAdvancedHostTopology(value: string): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined
  const parsed = JSON.parse(value) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Advanced topology must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function asMutableRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

function setOptional(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    delete target[key]
  } else {
    target[key] = value
  }
}

function removeEmptyObject(target: Record<string, unknown>, key: string): void {
  const value = target[key]
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    delete target[key]
  }
}

function speedMbps(speed: string): number | undefined {
  const values: Record<string, number> = {
    '1G': 1000,
    '2.5G': 2500,
    '5G': 5000,
    '10G': 10000,
  }
  return values[speed]
}

function clonePort(port: InventoryPort): InventoryPort {
  return {
    ...port,
    ...(port.endpoints ? { endpoints: port.endpoints.map((endpoint) => ({ ...endpoint })) } : {}),
  }
}

function portIdKey(id: string | number): string {
  return `${typeof id}:${String(id)}`
}

function hasProtectedPortMetadata(port: InventoryPort): boolean {
  return Boolean(
    port.label?.trim()
    || port.notes?.trim()
    || port.ipAddress?.trim()
    || port.poe !== undefined
    || port.endpoints?.length,
  )
}

function nextAvailablePortId(ports: InventoryPort[]): () => number {
  const used = new Set(ports.map((port) => String(port.id)))
  let next = ports.reduce((highest, port) => {
    const numericId = Number(port.id)
    return Number.isSafeInteger(numericId) && numericId >= 0 ? Math.max(highest, numericId) : highest
  }, 0) + 1

  return () => {
    while (used.has(String(next))) next += 1
    const id = next
    used.add(String(id))
    next += 1
    return id
  }
}

export function defaultPortGroups(type: InventoryType): PortGroup[] {
  if (type === 'server') {
    return [
      { id: 1, count: 1, type: 'rj45', speed: '1G', role: 'access' },
      { id: 2, count: 2, type: 'displayport', speed: '', role: 'access' },
    ]
  }
  if (type === 'nas' || type === 'network') {
    return [{ id: 1, count: 1, type: 'rj45', speed: '1G', role: 'access' }]
  }
  if (type === 'gpu') {
    return [{ id: 1, count: 1, type: 'displayport', speed: '', role: 'access' }]
  }
  if (type === 'switch') {
    return [{ id: 1, count: 8, type: 'rj45', speed: '1G', role: 'access' }]
  }
  if (type === 'patchPanel') {
    return [{ id: 1, count: 24, type: 'rj45', speed: '', role: 'access' }]
  }
  return []
}

export function inventoryTypeHasPorts(type: InventoryType): boolean {
  return ['server', 'nas', 'motherboard', 'gpu', 'network', 'switch', 'patchPanel'].includes(type)
}

export function inventoryPortsToPortGroups(ports: InventoryPort[] | undefined): PortGroup[] {
  if (!ports?.length) return []
  const groups: PortGroup[] = []

  for (const port of ports
    .filter((candidate) => candidate.kind !== 'power-port'
      && candidate.type !== 'ac-input'
      && candidate.type !== 'ac-outlet')
    .slice()
    .sort((a, b) => a.slotNumber - b.slotNumber)) {
    const previous = groups.at(-1)
    const role = port.role ?? 'access'
    const speed = port.speed ?? ''

    if (previous && previous.type === port.type && previous.speed === speed && previous.role === role) {
      previous.count += 1
      previous.originalPortIds?.push(port.id)
    } else {
      groups.push({
        id: groups.length + 1,
        count: 1,
        type: port.type,
        speed,
        role,
        originalPortIds: [port.id],
      })
    }
  }

  return groups
}

export function createInventoryFormValues(type: InventoryType): InventoryFormValues {
  return {
    type,
    hardwareClass: 'desktop',
    usageRole: 'server',
    name: '',
    aliases: [],
    manufacturer: '',
    secondaryManufacturer: '',
    model: '',
    family: '',
    number: '',
    serialNumber: '',
    notes: '',
    formFactor: type === 'server' ? 'Mini' : '',
    chipset: '',
    boardRevision: '',
    launchDate: '',
    discontinued: '',
    motherboardBluetooth: '',
    networkSlot: '',
    wireless: '',
    driveBays: '',
    m2Slots: '',
    powerConfiguration: '',
    cores: '',
    threads: '',
    baseClockGhz: '',
    boostClockGhz: '',
    capacityGb: '',
    generation: '',
    speedMt: '',
    secondarySpeedMt: '',
    moduleCount: '',
    ramFormFactor: '',
    ramModuleType: '',
    ramEcc: '',
    ramRank: '',
    ramVoltageVolts: '',
    capacity: '',
    storageUnit: 'TB',
    interface: '',
    storageFormFactor: '',
    storagePartitionTable: '',
    vramGb: '',
    gpuFormFactor: '',
    slotWidth: '',
    pcie: '',
    networkFormFactor: '',
    management: '',
    switchingCapacityGbps: '',
    fanless: false,
    rackUnits: '',
    mount: '',
    operatingSystem: '',
    role: '',
    coolerType: '',
    caseFormFactors: [],
    psuFormFactor: '',
    ratedWatts: '',
    efficiencyRating: '',
    wifiGeneration: '',
    bluetooth: '',
    displaySizeInches: '',
    resolution: '',
    refreshRateHz: '',
    upsWatts: '',
    upsVoltAmps: '',
    batteryOutletCount: '',
    surgeOutletCount: '',
    outletCount: '',
    surgeProtected: '',
    smartEnabled: false,
    smartDisplayName: '',
    smartManagementIp: '',
    smartMacAddress: '',
    smartOutletNames: [],
    adapterOutputWatts: '',
    dcConnector: '',
    cpuSocketCount: '',
    portGroups: defaultPortGroups(type),
    originalPorts: [],
    preservedSpecs: {},
    hostCpuSockets: [],
    hostCpuGenerations: [],
    hostCpuMaxTdpWatts: '',
    hostCpuSocketCount: '',
    hostCpuPopulationModes: [],
    hostTopologyCompleteness: '',
    hostMemoryGenerations: [],
    hostMemorySlots: '',
    hostMemoryMaxCapacityGb: '',
    hostMemoryMaxModuleCapacityGb: '',
    hostMemoryMaxSpeedMt: '',
    hostMemoryEccSupport: '',
    hostMemorySlotsPerCpu: '',
    hostMemoryFormFactors: [],
    hostMemoryModuleTypes: [],
    storageSlotGroups: [],
    expansionSlotGroups: [],
    optionalModuleSlotGroups: [],
    motherboardPowerConnectors: [],
    powerSupplyConnectors: [],
    hostMaxExpansionPowerWatts: '',
    hostPowerConfiguration: '',
    hostPowerConnector: '',
    hostPowerSupportedWattagesWatts: '',
    hostPowerAdapterRequired: '',
    hostPowerAdapterType: '',
    hostPowerRedundancy: '',
    hostPowerMaxGraphicsPowerWatts: '',
    hostPowerPsuBayCount: '',
    hostPowerPsuType: '',
    hostPowerMixedPsuAllowed: '',
    hostPowerRedundancyModes: [],
    hostAdvancedTopologyJson: '',
    cpuSocket: '',
    cpuGeneration: '',
    cpuTdpWatts: '',
    expansionInterfaceFamily: '',
    expansionPcieGeneration: '',
    expansionConnectorLanes: '',
    expansionMinimumElectricalLanes: '',
    expansionHeight: '',
    expansionSlotWidth: '',
    expansionPowerWatts: '',
    preservedCompatibility: {},
  }
}

export function inventoryItemToFormValues(item: InventoryItem): InventoryFormValues {
  const values = createInventoryFormValues(item.type)
  const specs = item.specs ?? {}
  const preservedSpecs = { ...specs }
  for (const key of KNOWN_SPEC_KEYS[item.type] ?? []) delete preservedSpecs[key]
  const hasCapacityTb = specs.capacityTb !== undefined
    && specs.capacityTb !== null
    && stringValue(specs.capacityTb).trim() !== ''

  return {
    ...values,
    hardwareClass:
      item.hardwareClass === 'server' || item.hardwareClass === 'workstation'
        ? item.hardwareClass
        : 'desktop',
    usageRole: ['server', 'desktop', 'workstation', 'other'].includes(item.usageRole ?? '')
      ? item.usageRole as EquipmentUsageRole
      : 'server',
    name: item.name,
    aliases: stringArray(item.aliases),
    manufacturer: item.manufacturer ?? '',
    secondaryManufacturer: item.secondaryManufacturer ?? '',
    model: item.model ?? '',
    family: item.family ?? '',
    number: item.number ?? '',
    serialNumber: item.type === 'storage' ? stringValue(specs.serialNumber) : '',
    notes: item.notes ?? '',
    formFactor: stringValue(specs.formFactor),
    chipset: stringValue(specs.chipset),
    boardRevision: stringValue(specs.boardRevision),
    launchDate: stringValue(specs.launchDate),
    discontinued: specs.discontinued === true ? 'yes' : specs.discontinued === false ? 'no' : '',
    motherboardBluetooth: item.type === 'motherboard' ? stringValue(specs.bluetooth) : '',
    networkSlot: stringValue(specs.networkSlot),
    wireless: stringValue(specs.wireless),
    driveBays: stringValue(specs.driveBays),
    m2Slots: stringValue(specs.m2Slots),
    powerConfiguration: specs.powerConfiguration === 'internal-psu'
      || specs.powerConfiguration === 'external-adapter'
      ? specs.powerConfiguration
      : '',
    cores: stringValue(specs.cores),
    threads: stringValue(specs.threads),
    baseClockGhz: stringValue(specs.baseClockGhz),
    boostClockGhz: stringValue(specs.boostClockGhz),
    capacityGb: stringValue(specs.capacityGb),
    generation: stringValue(specs.generation),
    speedMt: stringValue(specs.speedMt),
    secondarySpeedMt: stringValue(specs.secondarySpeedMt),
    moduleCount: stringValue(specs.moduleCount),
    ramFormFactor: item.type === 'ram' ? stringValue(specs.formFactor) : '',
    ramModuleType: item.type === 'ram' ? stringValue(specs.moduleType) : '',
    ramEcc: item.type === 'ram' && typeof specs.ecc === 'boolean' ? (specs.ecc ? 'yes' : 'no') : '',
    ramRank: item.type === 'ram' ? stringValue(specs.rank) : '',
    ramVoltageVolts: item.type === 'ram' ? stringValue(specs.voltageVolts) : '',
    capacity: stringValue(hasCapacityTb ? specs.capacityTb : specs.capacityGb),
    storageUnit: hasCapacityTb ? 'TB' : 'GB',
    interface: stringValue(specs.interface),
    storageFormFactor: item.type === 'storage' ? stringValue(specs.formFactor) : '',
    storagePartitionTable: item.type === 'storage' ? stringValue(specs.partitionTable) : '',
    vramGb: stringValue(specs.vramGb),
    gpuFormFactor: item.type === 'gpu' ? stringValue(specs.formFactor) : '',
    slotWidth: stringValue(specs.slotWidth),
    pcie: stringValue(specs.pcie),
    networkFormFactor: item.type === 'network' ? stringValue(specs.formFactor) : '',
    management: stringValue(specs.management),
    switchingCapacityGbps: stringValue(specs.switchingCapacityGbps),
    fanless: specs.fanless === true,
    rackUnits: stringValue(specs.rackUnits),
    mount: stringValue(specs.mount),
    operatingSystem: stringValue(specs.operatingSystem),
    role: stringValue(specs.role),
    coolerType: stringValue(specs.coolerType) as InventoryFormValues['coolerType'],
    caseFormFactors: commaSeparatedStringArray(specs.formFactors),
    psuFormFactor: item.type === 'powerSupply' ? stringValue(specs.formFactor) : '',
    ratedWatts: stringValue(specs.wattageWatts),
    efficiencyRating: stringValue(specs.efficiency),
    wifiGeneration: stringValue(specs.wifiGeneration),
    bluetooth: specs.bluetooth === true ? 'yes' : specs.bluetooth === false ? 'no' : '',
    displaySizeInches: stringValue(specs.sizeInches),
    resolution: stringValue(specs.resolution),
    refreshRateHz: stringValue(specs.refreshRateHz),
    upsWatts: item.type === 'ups' ? stringValue(specs.wattageWatts) : '',
    upsVoltAmps: stringValue(specs.capacityVa),
    batteryOutletCount: stringValue(specs.batteryBackupOutlets),
    surgeOutletCount: stringValue(specs.surgeProtectedOutlets),
    outletCount: stringValue(specs.outlets),
    surgeProtected: specs.surgeProtected === true ? 'yes' : specs.surgeProtected === false ? 'no' : '',
    smartEnabled: item.type === 'powerStrip' && item.smart?.enabled === true,
    smartDisplayName: item.type === 'powerStrip' ? item.smart?.displayName ?? '' : '',
    smartManagementIp: item.type === 'powerStrip' ? item.smart?.managementIp ?? '' : '',
    smartMacAddress: item.type === 'powerStrip' ? item.smart?.macAddress ?? '' : '',
    smartOutletNames: item.type === 'powerStrip'
      ? item.smart?.outlets.map((outlet) => ({ ...outlet })) ?? []
      : [],
    adapterOutputWatts: item.type === 'powerAdapter' ? stringValue(specs.wattageWatts) : '',
    dcConnector: stringValue(specs.connector),
    cpuSocketCount: stringValue(specs.cpuSocketCount),
    portGroups: inventoryPortsToPortGroups(item.ports),
    originalPorts: item.ports?.map(clonePort) ?? [],
    preservedSpecs,
    hostCpuSockets: stringArray(item.compatibility?.host?.cpu?.sockets),
    hostCpuGenerations: stringArray(item.compatibility?.host?.cpu?.generations),
    hostCpuMaxTdpWatts: stringValue(item.compatibility?.host?.cpu?.maxTdpWatts),
    hostCpuSocketCount: stringValue(item.compatibility?.host?.cpu?.socketCount),
    hostCpuPopulationModes: (item.compatibility?.host?.cpu?.populationModes ?? []).map(String),
    hostTopologyCompleteness: item.compatibility?.host?.topologyCompleteness ?? '',
    hostMemoryGenerations: stringArray(item.compatibility?.host?.memory?.generations),
    hostMemorySlots: stringValue(item.compatibility?.host?.memory?.slots),
    hostMemoryMaxCapacityGb: stringValue(item.compatibility?.host?.memory?.maxCapacityGb),
    hostMemoryMaxModuleCapacityGb: stringValue(item.compatibility?.host?.memory?.maxModuleCapacityGb),
    hostMemoryMaxSpeedMt: stringValue(item.compatibility?.host?.memory?.maxSpeedMt),
    hostMemoryEccSupport: item.compatibility?.host?.memory?.eccSupport ?? '',
    hostMemorySlotsPerCpu: stringValue(item.compatibility?.host?.memory?.slotsPerCpu),
    hostMemoryFormFactors: stringArray(item.compatibility?.host?.memory?.formFactors),
    hostMemoryModuleTypes: stringArray(item.compatibility?.host?.memory?.moduleTypes),
    storageSlotGroups: item.compatibility?.host?.storageSlots?.map((group) => ({
      draftKey: `storage:${group.id}`,
      id: group.id,
      key: group.key,
      label: group.label,
      count: stringValue(group.count),
      interfaces: stringArray(group.interfaces),
      formFactors: stringArray(group.formFactors),
      pcieGeneration: stringValue(group.pcieGeneration),
      location: stringValue(group.location),
      hotSwap: group.hotSwap,
      backplane: stringValue(group.backplane),
      controllerSlotIds: (group.controllerSlotIds ?? []).join(', '),
      directConnect: group.directConnect,
    })) ?? [],
    expansionSlotGroups: item.compatibility?.host?.expansionSlots?.map((group) => ({
      draftKey: `expansion:${group.id}`,
      id: group.id,
      key: group.key,
      label: group.label,
      count: stringValue(group.count),
      interfaceFamily: stringValue(group.interfaceFamily),
      pcieGeneration: stringValue(group.pcieGeneration),
      mechanicalLanes: stringValue(group.mechanicalLanes),
      electricalLanes: stringValue(group.electricalLanes),
      acceptedHeights: stringArray(group.acceptedHeights),
      maxSlotWidth: stringValue(group.maxSlotWidth),
      maxPowerWatts: stringValue(group.maxPowerWatts),
      proprietaryRiser: group.proprietaryRiser,
      riserCapability: stringValue(group.riserCapability),
      requiredCpuSockets: stringValue(group.requiredCpuSockets),
      riserGroup: stringValue(group.riserGroup),
    })) ?? [],
    optionalModuleSlotGroups: item.compatibility?.host?.optionalModuleSlots?.map((group) => ({
      draftKey: `optional-module:${group.id}`,
      id: group.id,
      key: group.key,
      label: group.label,
      count: stringValue(group.count),
      acceptedModuleKinds: stringArray(group.acceptedModuleKinds),
    })) ?? [],
    motherboardPowerConnectors: item.compatibility?.host?.powerConnectors?.map((group) => ({
      draftKey: `motherboard-power:${group.id}`,
      id: group.id,
      key: group.key,
      label: group.label,
      kind: group.kind,
      connector: group.connector,
      count: stringValue(group.count),
      required: group.required,
    })) ?? [],
    powerSupplyConnectors: item.type === 'powerSupply' && Array.isArray(specs.connectors)
      ? specs.connectors.flatMap((connector, index) => {
          if (!connector || typeof connector !== 'object' || Array.isArray(connector)) return []
          const record = connector as Record<string, unknown>
          return [{
            draftKey: `psu-connector:${index + 1}`,
            connector: stringValue(record.connector),
            count: stringValue(record.count),
          }]
        })
      : [],
    hostMaxExpansionPowerWatts: stringValue(item.compatibility?.host?.maxExpansionPowerWatts),
    hostPowerConfiguration: stringValue(item.compatibility?.host?.power?.configuration),
    hostPowerConnector: stringValue(item.compatibility?.host?.power?.connector),
    hostPowerSupportedWattagesWatts: (item.compatibility?.host?.power?.supportedWattagesWatts ?? []).join(', '),
    hostPowerAdapterRequired: item.compatibility?.host?.power?.adapterRequired === true
      ? 'yes'
      : item.compatibility?.host?.power?.adapterRequired === false ? 'no' : '',
    hostPowerAdapterType: stringValue(item.compatibility?.host?.power?.adapterType),
    hostPowerRedundancy: stringValue(item.compatibility?.host?.power?.redundancy),
    hostPowerMaxGraphicsPowerWatts: stringValue(item.compatibility?.host?.power?.maxGraphicsPowerWatts),
    hostPowerPsuBayCount: stringValue(item.compatibility?.host?.power?.psuBayCount),
    hostPowerPsuType: stringValue(item.compatibility?.host?.power?.psuType),
    hostPowerMixedPsuAllowed: item.compatibility?.host?.power?.mixedPsuAllowed === true
      ? 'yes'
      : item.compatibility?.host?.power?.mixedPsuAllowed === false ? 'no' : '',
    hostPowerRedundancyModes: stringArray(item.compatibility?.host?.power?.redundancyModes),
    hostAdvancedTopologyJson: advancedHostTopologyJson(item.compatibility?.host),
    cpuSocket: stringValue(item.compatibility?.requirements?.cpu?.socket),
    cpuGeneration: stringValue(item.compatibility?.requirements?.cpu?.generation),
    cpuTdpWatts: stringValue(item.compatibility?.requirements?.cpu?.tdpWatts),
    expansionInterfaceFamily: stringValue(item.compatibility?.requirements?.expansion?.interfaceFamily),
    expansionPcieGeneration: stringValue(item.compatibility?.requirements?.expansion?.pcieGeneration),
    expansionConnectorLanes: stringValue(item.compatibility?.requirements?.expansion?.connectorLanes),
    expansionMinimumElectricalLanes: stringValue(item.compatibility?.requirements?.expansion?.minimumElectricalLanes),
    expansionHeight: stringValue(item.compatibility?.requirements?.expansion?.height),
    expansionSlotWidth: stringValue(item.compatibility?.requirements?.expansion?.slotWidth),
    expansionPowerWatts: stringValue(item.compatibility?.requirements?.expansion?.powerWatts),
    preservedCompatibility: cloneCompatibility(item.compatibility),
    subtype: item.subtype,
    properties: item.properties ? { ...item.properties } : undefined,
  }
}

export function inventoryPortsToFormPatch(
  ports: InventoryPort[],
): Pick<InventoryFormValues, 'portGroups' | 'originalPorts'> {
  return {
    portGroups: inventoryPortsToPortGroups(ports),
    originalPorts: ports.map(clonePort),
  }
}

export function buildPorts(type: InventoryType, groups: PortGroup[]): InventoryPort[] | undefined {
  return reconcilePorts(type, groups, [])
}

export function reconcilePorts(
  type: InventoryType,
  groups: PortGroup[],
  originalPorts: InventoryPort[],
): InventoryPort[] | undefined {
  const defaultOrigin: InventoryPort['origin'] = type === 'gpu' || type === 'network'
    ? 'module'
    : 'fixed'
  let slotNumber = 1
  const ports: InventoryPort[] = []
  const systemPorts = originalPorts.filter((port) => port.kind === 'power-port'
    || port.type === 'ac-input'
    || port.type === 'ac-outlet')
  const editableOriginalPorts = originalPorts.filter((port) => !systemPorts.includes(port))
  const originalsById = new Map(
    editableOriginalPorts.map((port) => [portIdKey(port.id), clonePort(port)]),
  )
  const retainedIds = new Set<string>()
  const allocateId = nextAvailablePortId(originalPorts)

  for (const group of groups) {
    const count = Math.max(0, Math.min(MAX_PORT_GROUP_COUNT, Math.trunc(Number(group.count) || 0)))
    for (let index = 0; index < count; index += 1) {
      const originalId = group.originalPortIds?.[index]
      const originalPort = originalId === undefined
        ? undefined
        : originalsById.get(portIdKey(originalId))
      const port: InventoryPort = {
        ...(originalPort ? clonePort(originalPort) : {}),
        id: originalPort?.id ?? allocateId(),
        kind: originalPort?.kind
          ?? (type === 'switch' ? 'switch-port' : type === 'patchPanel' ? 'keystone' : 'server-port'),
        type: group.type,
        slotNumber,
        origin: originalPort?.origin ?? defaultOrigin,
      }
      if (!originalPort) port.label = ''
      if (group.speed) port.speed = group.speed
      else delete port.speed
      if (type === 'switch' || type === 'network') port.role = group.role
      else if (!originalPort?.role) delete port.role
      if (type === 'patchPanel' && !port.endpoints?.length) {
        port.endpoints = [
          { id: 1, side: 'front' },
          { id: 2, side: 'back' },
        ]
      }
      if (originalPort) retainedIds.add(portIdKey(originalPort.id))
      ports.push(port)
      slotNumber += 1
    }
  }

  const protectedRemovedPort = editableOriginalPorts.find(
    (port) => !retainedIds.has(portIdKey(port.id)) && hasProtectedPortMetadata(port),
  )
  if (protectedRemovedPort) {
    throw new Error(`Cannot remove protected port ${String(protectedRemovedPort.id)} without resolving its saved metadata.`)
  }

  const reconciled = [...ports, ...systemPorts.map(clonePort)]
  return reconciled.length ? reconciled : undefined
}

function setSpec(specs: InventorySpecs, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined || value === '') delete specs[key]
  else specs[key] = value
}

export function inventoryFormValuesToInput(values: InventoryFormValues): InventoryItemInput {
  const specs: InventorySpecs = { ...values.preservedSpecs }
  const { type } = values

  if (type === 'server') {
    setSpec(specs, 'formFactor', cleanString(values.formFactor) ?? 'Mini')
    setSpec(specs, 'networkSlot', cleanString(values.networkSlot))
    setSpec(specs, 'wireless', cleanString(values.wireless))
  } else if (type === 'nas') {
    setSpec(specs, 'driveBays', numberValue(values.driveBays))
    setSpec(specs, 'm2Slots', numberValue(values.m2Slots))
    setSpec(specs, 'powerConfiguration', cleanString(values.powerConfiguration))
  } else if (type === 'cpu') {
    setSpec(specs, 'cores', numberValue(values.cores))
    setSpec(specs, 'threads', numberValue(values.threads))
    setSpec(specs, 'baseClockGhz', numberValue(values.baseClockGhz))
    setSpec(specs, 'boostClockGhz', numberValue(values.boostClockGhz))
  } else if (type === 'ram') {
    setSpec(specs, 'capacityGb', numberValue(values.capacityGb))
    setSpec(specs, 'generation', cleanString(values.generation))
    setSpec(specs, 'speedMt', numberValue(values.speedMt))
    setSpec(specs, 'formFactor', cleanString(values.ramFormFactor))
    setSpec(specs, 'moduleType', cleanString(values.ramModuleType))
    setSpec(specs, 'ecc', values.ramEcc === '' ? undefined : values.ramEcc === 'yes')
    setSpec(specs, 'rank', cleanString(values.ramRank))
    setSpec(specs, 'voltageVolts', numberValue(values.ramVoltageVolts))
    delete specs.secondarySpeedMt
    delete specs.moduleCount
    delete specs.module
    delete specs.modules
  } else if (type === 'storage') {
    delete specs.capacityGb
    delete specs.capacityTb
    setSpec(specs, values.storageUnit === 'TB' ? 'capacityTb' : 'capacityGb', numberValue(values.capacity))
    setSpec(specs, 'interface', cleanString(values.interface))
    setSpec(specs, 'formFactor', cleanString(values.storageFormFactor))
    setSpec(specs, 'serialNumber', cleanString(values.serialNumber))
    setSpec(specs, 'partitionTable', cleanString(values.storagePartitionTable))
  } else if (type === 'gpu') {
    setSpec(specs, 'vramGb', numberValue(values.vramGb))
    setSpec(specs, 'formFactor', cleanString(values.gpuFormFactor))
    setSpec(specs, 'slotWidth', cleanString(values.slotWidth))
    setSpec(specs, 'pcie', cleanString(values.pcie))
  } else if (type === 'network') {
    const firstSpeed = values.portGroups.map((group) => speedMbps(group.speed)).find(Boolean)
    const totalPorts = values.portGroups.reduce((sum, group) => sum + Math.max(0, Number(group.count) || 0), 0)
    setSpec(specs, 'ports', totalPorts || undefined)
    setSpec(specs, 'speedMbps', firstSpeed)
    setSpec(specs, 'interface', cleanString(values.interface))
    setSpec(specs, 'formFactor', cleanString(values.networkFormFactor))
  } else if (type === 'switch') {
    setSpec(specs, 'management', cleanString(values.management))
    setSpec(specs, 'switchingCapacityGbps', numberValue(values.switchingCapacityGbps))
    setSpec(specs, 'fanless', values.fanless)
  } else if (type === 'patchPanel') {
    setSpec(specs, 'rackUnits', numberValue(values.rackUnits))
    setSpec(specs, 'mount', cleanString(values.mount))
  } else if (type === 'pcBuild') {
    setSpec(specs, 'operatingSystem', cleanString(values.operatingSystem))
    setSpec(specs, 'role', cleanString(values.role))
  } else if (type === 'motherboard') {
    setSpec(specs, 'chipset', cleanString(values.chipset))
    setSpec(specs, 'formFactor', cleanString(values.formFactor))
    setSpec(specs, 'boardRevision', cleanString(values.boardRevision))
    setSpec(specs, 'launchDate', cleanString(values.launchDate))
    setSpec(specs, 'discontinued', values.discontinued === '' ? undefined : values.discontinued === 'yes')
    setSpec(specs, 'wifiGeneration', cleanString(values.wifiGeneration))
    setSpec(specs, 'bluetooth', cleanString(values.motherboardBluetooth))
  } else if (type === 'cpuCooler') {
    setSpec(specs, 'coolerType', cleanString(values.coolerType))
  } else if (type === 'case') {
    setSpec(specs, 'formFactors', values.caseFormFactors.length ? values.caseFormFactors.join(', ') : undefined)
  } else if (type === 'powerSupply') {
    setSpec(specs, 'formFactor', cleanString(values.psuFormFactor))
    setSpec(specs, 'wattageWatts', numberValue(values.ratedWatts))
    setSpec(specs, 'efficiency', cleanString(values.efficiencyRating))
    const connectors = values.powerSupplyConnectors.flatMap((connector) => {
      const name = connector.connector.trim()
      const count = numberValue(connector.count)
      return name && count !== undefined ? [{ connector: name, count }] : []
    })
    if (connectors.length) specs.connectors = connectors
    else delete specs.connectors
  } else if (type === 'soundCard') {
    setSpec(specs, 'interface', cleanString(values.interface))
  } else if (type === 'wireless') {
    setSpec(specs, 'interface', cleanString(values.interface))
    setSpec(specs, 'wifiGeneration', cleanString(values.wifiGeneration))
    setSpec(specs, 'bluetooth', values.bluetooth === '' ? undefined : values.bluetooth === 'yes')
  } else if (type === 'powerAdapter') {
    setSpec(specs, 'wattageWatts', numberValue(values.adapterOutputWatts))
    setSpec(specs, 'connector', cleanString(values.dcConnector))
  } else if (type === 'monitor') {
    setSpec(specs, 'sizeInches', numberValue(values.displaySizeInches))
    setSpec(specs, 'resolution', cleanString(values.resolution))
    setSpec(specs, 'refreshRateHz', numberValue(values.refreshRateHz))
  } else if (type === 'ups') {
    const batteryOutlets = numberValue(values.batteryOutletCount)
    const surgeOutlets = numberValue(values.surgeOutletCount)
    const existingOutletCount = numberValue(values.outletCount)
    setSpec(specs, 'wattageWatts', numberValue(values.upsWatts))
    setSpec(specs, 'capacityVa', numberValue(values.upsVoltAmps))
    setSpec(specs, 'batteryBackupOutlets', batteryOutlets)
    setSpec(specs, 'surgeProtectedOutlets', surgeOutlets)
    setSpec(specs, 'outlets', batteryOutlets !== undefined || surgeOutlets !== undefined
      ? (batteryOutlets ?? 0) + (surgeOutlets ?? 0)
      : existingOutletCount)
  } else if (type === 'powerStrip') {
    const outlets = numberValue(values.outletCount)
    setSpec(specs, 'outlets', outlets)
    setSpec(specs, 'surgeProtected', values.surgeProtected === '' ? undefined : values.surgeProtected === 'yes')
    setSpec(specs, 'surgeProtectedOutlets', values.surgeProtected === 'yes' ? outlets : values.surgeProtected === 'no' ? 0 : undefined)
  }

  const compatibility = buildCompatibility(values)
  const ports = inventoryTypeHasPorts(type)
    ? reconcilePorts(type, values.portGroups, values.originalPorts)
    : undefined
  const smartOutletPortIds = new Set(powerStripOutletPorts(values).map((port) => port.id))
  const smart = type === 'powerStrip' && values.smartEnabled
    ? {
        enabled: true as const,
        ...(cleanString(values.smartDisplayName) ? { displayName: values.smartDisplayName.trim() } : {}),
        ...(cleanString(values.smartManagementIp) ? { managementIp: values.smartManagementIp.trim() } : {}),
        ...(cleanString(values.smartMacAddress) ? { macAddress: values.smartMacAddress.trim() } : {}),
        outlets: values.smartOutletNames
          .filter((outlet) => smartOutletPortIds.has(outlet.portId) && outlet.name.trim())
          .map((outlet) => ({ portId: outlet.portId, name: outlet.name.trim() })),
      }
    : undefined
  return {
    type,
    ...(type === 'server' ? {
      hardwareClass: values.hardwareClass,
      usageRole: values.usageRole,
    } : {}),
    name: values.name.trim(),
    ...(values.aliases.map((alias) => alias.trim()).filter(Boolean).length
      ? { aliases: [...new Set(values.aliases.map((alias) => alias.trim()).filter(Boolean))] }
      : {}),
    ...(cleanString(values.manufacturer) ? { manufacturer: values.manufacturer.trim() } : {}),
    ...(type !== 'ram' && cleanString(values.secondaryManufacturer) ? { secondaryManufacturer: values.secondaryManufacturer.trim() } : {}),
    ...(cleanString(values.model) ? { model: values.model.trim() } : {}),
    ...(cleanString(values.family) ? { family: values.family.trim() } : {}),
    ...(cleanString(values.number) ? { number: values.number.trim() } : {}),
    ...(values.subtype ? { subtype: values.subtype } : {}),
    ...(Object.keys(specs).length ? { specs } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(values.properties ? { properties: { ...values.properties } } : {}),
    ...(ports ? { ports } : {}),
    ...(smart ? { smart } : {}),
    ...(cleanString(values.notes) ? { notes: values.notes.trim() } : {}),
  }
}

export function powerStripOutletPorts(values: Pick<
  InventoryFormValues,
  'outletCount' | 'originalPorts'
>): InventoryPort[] {
  const outlets = Math.max(0, Math.trunc(Number(values.outletCount) || 0))
  return canonicalPowerPorts({
    id: 1,
    name: 'Power strip',
    type: 'powerStrip',
    specs: { outlets },
    ports: values.originalPorts,
  }).filter((port) => port.type === 'ac-outlet')
}

type ResourceGroupDraft =
  | StorageSlotGroupDraft
  | ExpansionSlotGroupDraft
  | OptionalModuleSlotGroupDraft
  | MotherboardPowerConnectorDraft

function assignResourceGroupIds(groups: ResourceGroupDraft[]): number[] {
  const used = new Set(
    groups
      .map((group) => group.id)
      .filter((id): id is number => Number.isSafeInteger(id) && id !== undefined && id > 0),
  )
  let nextId = Math.max(0, ...used) + 1
  return groups.map((group) => {
    if (group.id !== undefined && Number.isSafeInteger(group.id) && group.id > 0) return group.id
    while (used.has(nextId)) nextId += 1
    const id = nextId
    used.add(id)
    nextId += 1
    return id
  })
}

function semanticResourceGroupKey(value: string, fallback: string): string {
  const key = value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return key || fallback
}

function assignResourceGroupKeys(groups: ResourceGroupDraft[], prefix: string): string[] {
  const used = new Set<string>()
  return groups.map((group, index) => {
    const base = semanticResourceGroupKey(group.key || group.label, `${prefix}-${index + 1}`)
    let key = base
    let suffix = 2
    while (used.has(key)) {
      key = `${base}-${suffix}`
      suffix += 1
    }
    used.add(key)
    return key
  })
}

function buildCompatibility(values: InventoryFormValues): InventoryCompatibility | undefined {
  const compatibility = cloneCompatibility(values.preservedCompatibility)
  const root = asMutableRecord(compatibility)

  if (values.type === 'server' || values.type === 'nas' || values.type === 'motherboard') {
    const host = compatibility.host ? structuredClone(compatibility.host) : {}
    const hostRecord = asMutableRecord(host)
    setOptional(hostRecord, 'topologyCompleteness', cleanString(values.hostTopologyCompleteness))
    const cpu = host.cpu ? { ...host.cpu } : {}
    const cpuRecord = asMutableRecord(cpu)
    setOptional(cpuRecord, 'sockets', values.hostCpuSockets.map((value) => value.trim()).filter(Boolean))
    setOptional(cpuRecord, 'generations', values.hostCpuGenerations)
    setOptional(cpuRecord, 'maxTdpWatts', numberValue(values.hostCpuMaxTdpWatts))
    setOptional(cpuRecord, 'socketCount', numberValue(values.hostCpuSocketCount))
    setOptional(
      cpuRecord,
      'populationModes',
      values.hostCpuPopulationModes
        .map((value) => numberValue(value))
        .filter((value): value is number => value !== undefined),
    )
    if (Object.keys(cpuRecord).length) host.cpu = cpu
    else delete host.cpu

    const memory = host.memory ? { ...host.memory } : {}
    const memoryRecord = asMutableRecord(memory)
    setOptional(memoryRecord, 'generations', values.hostMemoryGenerations)
    setOptional(memoryRecord, 'slots', numberValue(values.hostMemorySlots))
    setOptional(memoryRecord, 'maxCapacityGb', numberValue(values.hostMemoryMaxCapacityGb))
    setOptional(memoryRecord, 'maxModuleCapacityGb', numberValue(values.hostMemoryMaxModuleCapacityGb))
    setOptional(memoryRecord, 'maxSpeedMt', numberValue(values.hostMemoryMaxSpeedMt))
    setOptional(memoryRecord, 'eccSupport', cleanString(values.hostMemoryEccSupport))
    setOptional(memoryRecord, 'slotsPerCpu', numberValue(values.hostMemorySlotsPerCpu))
    setOptional(memoryRecord, 'formFactors', values.hostMemoryFormFactors)
    setOptional(memoryRecord, 'moduleTypes', values.hostMemoryModuleTypes)
    if (Object.keys(memoryRecord).length) host.memory = memory
    else delete host.memory

    const originalStorageGroups = new Map(
      (compatibility.host?.storageSlots ?? []).map((group) => [group.id, group]),
    )
    const storageDrafts = values.storageSlotGroups.filter((draft) => (
      draft.label.trim() !== ''
      || draft.count.trim() !== ''
      || draft.interfaces.length > 0
      || draft.formFactors.length > 0
      || draft.pcieGeneration.trim() !== ''
      || draft.location.trim() !== ''
      || draft.hotSwap
      || draft.backplane.trim() !== ''
      || draft.controllerSlotIds.trim() !== ''
      || draft.directConnect
    ))
    const storageIds = assignResourceGroupIds(storageDrafts)
    const storageKeys = assignResourceGroupKeys(storageDrafts, 'storage')
    const storageSlots = storageDrafts.map((draft, index) => {
      const originalGroup = draft.id === undefined ? undefined : originalStorageGroups.get(draft.id)
      const group = structuredClone(originalGroup ?? {}) as Record<string, unknown>
      group.id = storageIds[index]
      group.key = storageKeys[index]
      group.label = draft.label.trim()
      setOptional(group, 'count', numberValue(draft.count))
      setOptional(group, 'interfaces', draft.interfaces)
      setOptional(group, 'formFactors', draft.formFactors)
      setOptional(group, 'pcieGeneration', numberValue(draft.pcieGeneration))
      setOptional(group, 'location', cleanString(draft.location))
      setOptional(group, 'hotSwap', draft.hotSwap)
      setOptional(group, 'backplane', cleanString(draft.backplane))
      setOptional(
        group,
        'controllerSlotIds',
        draft.controllerSlotIds.split(',')
          .map((value) => numberValue(value))
          .filter((value): value is number => value !== undefined),
      )
      setOptional(group, 'directConnect', draft.directConnect)
      return group
    })
    setOptional(hostRecord, 'storageSlots', storageSlots)

    const originalExpansionGroups = new Map(
      (compatibility.host?.expansionSlots ?? []).map((group) => [group.id, group]),
    )
    const expansionDrafts = values.expansionSlotGroups.filter((draft) => (
      draft.label.trim() !== ''
      || draft.count.trim() !== ''
      || draft.interfaceFamily.trim() !== ''
      || draft.pcieGeneration.trim() !== ''
      || draft.mechanicalLanes.trim() !== ''
      || draft.electricalLanes.trim() !== ''
      || draft.acceptedHeights.length > 0
      || draft.maxSlotWidth.trim() !== ''
      || draft.maxPowerWatts.trim() !== ''
      || draft.proprietaryRiser !== undefined
      || draft.riserCapability.trim() !== ''
      || draft.requiredCpuSockets.trim() !== ''
      || draft.riserGroup.trim() !== ''
    ))
    const expansionIds = assignResourceGroupIds(expansionDrafts)
    const expansionKeys = assignResourceGroupKeys(expansionDrafts, 'expansion')
    const expansionSlots = expansionDrafts.map((draft, index) => {
      const originalGroup = draft.id === undefined ? undefined : originalExpansionGroups.get(draft.id)
      const group = structuredClone(originalGroup ?? {}) as Record<string, unknown>
      group.id = expansionIds[index]
      group.key = expansionKeys[index]
      group.label = draft.label.trim()
      setOptional(group, 'count', numberValue(draft.count))
      setOptional(group, 'interfaceFamily', cleanString(draft.interfaceFamily))
      setOptional(group, 'pcieGeneration', numberValue(draft.pcieGeneration))
      setOptional(group, 'mechanicalLanes', numberValue(draft.mechanicalLanes))
      setOptional(group, 'electricalLanes', numberValue(draft.electricalLanes))
      setOptional(group, 'acceptedHeights', draft.acceptedHeights)
      setOptional(group, 'maxSlotWidth', numberValue(draft.maxSlotWidth))
      setOptional(group, 'maxPowerWatts', numberValue(draft.maxPowerWatts))
      setOptional(group, 'proprietaryRiser', draft.proprietaryRiser)
      setOptional(group, 'riserCapability', cleanString(draft.riserCapability))
      setOptional(group, 'requiredCpuSockets', numberValue(draft.requiredCpuSockets))
      setOptional(group, 'riserGroup', cleanString(draft.riserGroup))
      return group
    })
    setOptional(hostRecord, 'expansionSlots', expansionSlots)

    const originalOptionalModuleGroups = new Map(
      (compatibility.host?.optionalModuleSlots ?? []).map((group) => [group.id, group]),
    )
    const optionalModuleDrafts = values.optionalModuleSlotGroups.filter((draft) => (
      draft.label.trim() !== ''
      || draft.count.trim() !== ''
      || draft.acceptedModuleKinds.length > 0
    ))
    const optionalModuleIds = assignResourceGroupIds(optionalModuleDrafts)
    const optionalModuleKeys = assignResourceGroupKeys(optionalModuleDrafts, 'optional-module')
    const optionalModuleSlots = optionalModuleDrafts.map((draft, index) => {
      const originalGroup = draft.id === undefined ? undefined : originalOptionalModuleGroups.get(draft.id)
      const group = structuredClone(originalGroup ?? {}) as Record<string, unknown>
      group.id = optionalModuleIds[index]
      group.key = optionalModuleKeys[index]
      group.label = draft.label.trim()
      setOptional(group, 'count', numberValue(draft.count))
      setOptional(group, 'acceptedModuleKinds', draft.acceptedModuleKinds)
      return group
    })
    setOptional(hostRecord, 'optionalModuleSlots', optionalModuleSlots)

    const originalPowerConnectorGroups = new Map(
      (compatibility.host?.powerConnectors ?? []).map((group) => [group.id, group]),
    )
    const powerConnectorDrafts = values.motherboardPowerConnectors.filter((draft) => (
      draft.label.trim() !== ''
      || draft.kind !== ''
      || draft.connector.trim() !== ''
      || draft.count.trim() !== ''
    ))
    const powerConnectorIds = assignResourceGroupIds(powerConnectorDrafts)
    const powerConnectorKeys = assignResourceGroupKeys(powerConnectorDrafts, 'power-connector')
    const powerConnectors = powerConnectorDrafts.map((draft, index) => {
      const originalGroup = draft.id === undefined
        ? undefined
        : originalPowerConnectorGroups.get(draft.id)
      const group = structuredClone(originalGroup ?? {}) as Record<string, unknown>
      group.id = powerConnectorIds[index]
      group.key = powerConnectorKeys[index]
      group.label = draft.label.trim()
      setOptional(group, 'kind', cleanString(draft.kind))
      setOptional(group, 'connector', cleanString(draft.connector))
      setOptional(group, 'count', numberValue(draft.count))
      group.required = draft.required
      return group
    })
    setOptional(hostRecord, 'powerConnectors', powerConnectors)

    const power = host.power ? { ...host.power } : {}
    const powerRecord = asMutableRecord(power)
    setOptional(powerRecord, 'configuration', cleanString(values.hostPowerConfiguration))
    setOptional(powerRecord, 'connector', cleanString(values.hostPowerConnector))
    setOptional(
      powerRecord,
      'supportedWattagesWatts',
      values.hostPowerSupportedWattagesWatts
        .split(',')
        .map((entry) => numberValue(entry))
        .filter((entry): entry is number => entry !== undefined),
    )
    setOptional(
      powerRecord,
      'adapterRequired',
      values.hostPowerAdapterRequired === '' ? undefined : values.hostPowerAdapterRequired === 'yes',
    )
    setOptional(powerRecord, 'adapterType', cleanString(values.hostPowerAdapterType))
    setOptional(
      powerRecord,
      'redundancy',
      values.hostPowerRedundancy.trim() === '' ? undefined : values.hostPowerRedundancy.trim(),
    )
    setOptional(powerRecord, 'maxGraphicsPowerWatts', numberValue(values.hostPowerMaxGraphicsPowerWatts))
    setOptional(powerRecord, 'psuBayCount', numberValue(values.hostPowerPsuBayCount))
    setOptional(powerRecord, 'psuType', cleanString(values.hostPowerPsuType))
    setOptional(
      powerRecord,
      'mixedPsuAllowed',
      values.hostPowerMixedPsuAllowed === '' ? undefined : values.hostPowerMixedPsuAllowed === 'yes',
    )
    setOptional(powerRecord, 'redundancyModes', values.hostPowerRedundancyModes)
    if (Object.keys(powerRecord).length) host.power = power
    else delete host.power
    setOptional(hostRecord, 'maxExpansionPowerWatts', numberValue(values.hostMaxExpansionPowerWatts))
    for (const key of ADVANCED_HOST_TOPOLOGY_KEYS) delete hostRecord[key]
    const advancedTopology = parseAdvancedHostTopology(values.hostAdvancedTopologyJson)
    if (advancedTopology) {
      for (const key of ADVANCED_HOST_TOPOLOGY_KEYS) {
        if (advancedTopology[key] !== undefined) hostRecord[key] = structuredClone(advancedTopology[key])
      }
    }
    if (Object.keys(hostRecord).length) compatibility.host = host
    else delete compatibility.host
  }

  if (values.type === 'cpu') {
    const requirements = compatibility.requirements ? structuredClone(compatibility.requirements) : {}
    const requirementsRecord = asMutableRecord(requirements)
    const cpu = requirements.cpu ? { ...requirements.cpu } : {}
    const cpuRecord = asMutableRecord(cpu)
    setOptional(cpuRecord, 'socket', cleanString(values.cpuSocket))
    setOptional(cpuRecord, 'generation', cleanString(values.cpuGeneration))
    setOptional(cpuRecord, 'tdpWatts', numberValue(values.cpuTdpWatts))
    if (Object.keys(cpuRecord).length) requirements.cpu = cpu
    else delete requirements.cpu
    removeEmptyObject(requirementsRecord, 'cpu')
    if (Object.keys(requirementsRecord).length) compatibility.requirements = requirements
    else delete compatibility.requirements
  } else if (values.type === 'ram') {
    const requirements = compatibility.requirements ? structuredClone(compatibility.requirements) : {}
    const requirementsRecord = asMutableRecord(requirements)
    const memory = requirements.memory ? { ...requirements.memory } : {}
    const memoryRecord = asMutableRecord(memory)
    setOptional(memoryRecord, 'capacityGb', numberValue(values.capacityGb))
    setOptional(memoryRecord, 'generation', cleanString(values.generation))
    setOptional(memoryRecord, 'speedMt', numberValue(values.speedMt))
    setOptional(memoryRecord, 'formFactor', cleanString(values.ramFormFactor))
    setOptional(memoryRecord, 'moduleType', cleanString(values.ramModuleType))
    setOptional(memoryRecord, 'ecc', values.ramEcc === '' ? undefined : values.ramEcc === 'yes')
    if (Object.keys(memoryRecord).length) requirements.memory = memory
    else delete requirements.memory
    removeEmptyObject(requirementsRecord, 'memory')
    if (Object.keys(requirementsRecord).length) compatibility.requirements = requirements
    else delete compatibility.requirements
  } else if (values.type === 'gpu' || values.type === 'network') {
    const requirements = compatibility.requirements ? structuredClone(compatibility.requirements) : {}
    const requirementsRecord = asMutableRecord(requirements)
    const expansion = requirements.expansion ? { ...requirements.expansion } : {}
    const expansionRecord = asMutableRecord(expansion)
    setOptional(expansionRecord, 'interfaceFamily', cleanString(values.expansionInterfaceFamily) as ExpansionInterfaceFamily | undefined)
    setOptional(expansionRecord, 'pcieGeneration', numberValue(values.expansionPcieGeneration))
    setOptional(expansionRecord, 'connectorLanes', numberValue(values.expansionConnectorLanes))
    setOptional(expansionRecord, 'minimumElectricalLanes', numberValue(values.expansionMinimumElectricalLanes))
    setOptional(expansionRecord, 'height', cleanString(values.expansionHeight) as CardHeight | undefined)
    setOptional(expansionRecord, 'slotWidth', numberValue(values.expansionSlotWidth))
    setOptional(expansionRecord, 'powerWatts', numberValue(values.expansionPowerWatts))
    if (Object.keys(expansionRecord).length) requirements.expansion = expansion
    else delete requirements.expansion
    if (Object.keys(requirementsRecord).length) compatibility.requirements = requirements
    else delete compatibility.requirements
  }

  return Object.keys(root).length ? compatibility : undefined
}

function validateNumber(errors: InventoryFormErrors, values: InventoryFormValues, key: keyof InventoryFormValues, minimum = 0): void {
  const value = values[key]
  if (typeof value !== 'string' || value.trim() === '') return
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum) {
    errors[key] = `Enter a number${minimum > 0 ? ` of at least ${minimum}` : ' of 0 or more'}.`
  }
}

export function getStorageSlotGroupValidationTarget(
  groups: StorageSlotGroupDraft[],
): InventoryGroupValidationTarget | null {
  const index = groups.findIndex((group) => (
    group.count.trim() !== ''
      && (!Number.isInteger(Number(group.count)) || Number(group.count) < 1)
  ))
  return index >= 0 ? { index, field: 'count' } : null
}

export function getExpansionSlotGroupValidationTarget(
  groups: ExpansionSlotGroupDraft[],
): InventoryGroupValidationTarget | null {
  const index = groups.findIndex((group) => (
    group.count.trim() !== ''
      && (!Number.isInteger(Number(group.count)) || Number(group.count) < 1)
  ))
  return index >= 0 ? { index, field: 'count' } : null
}

export function getOptionalModuleSlotGroupValidationTarget(
  groups: OptionalModuleSlotGroupDraft[],
): InventoryGroupValidationTarget | null {
  const index = groups.findIndex((group) => (
    group.count.trim() !== ''
      && (!Number.isInteger(Number(group.count)) || Number(group.count) < 1)
  ))
  return index >= 0 ? { index, field: 'count' } : null
}

export function getMotherboardPowerConnectorValidationTarget(
  groups: MotherboardPowerConnectorDraft[],
): InventoryGroupValidationTarget | null {
  const index = groups.findIndex((group) => (
    group.count.trim() !== ''
      && (!Number.isInteger(Number(group.count)) || Number(group.count) < 1)
  ))
  return index >= 0 ? { index, field: 'count' } : null
}

export function getPortGroupValidationTarget(
  type: InventoryType,
  groups: PortGroup[],
): InventoryGroupValidationTarget | null {
  const invalidCountIndex = groups.findIndex(
    (group) => !Number.isInteger(Number(group.count))
      || Number(group.count) < 0
      || Number(group.count) > MAX_PORT_GROUP_COUNT,
  )
  if (invalidCountIndex >= 0) return { index: invalidCountIndex, field: 'count' }

  if (type === 'switch') {
    const invalidSpeedIndex = groups.findIndex(
      (group) => isSwitchNetworkPortType(group.type) && !isSupportedSwitchPortSpeed(group.speed),
    )
    if (invalidSpeedIndex >= 0) return { index: invalidSpeedIndex, field: 'speed' }
  }

  return null
}

export function validateInventoryFormValues(values: InventoryFormValues): InventoryFormErrors {
  const errors: InventoryFormErrors = {}
  if (!values.name.trim()) errors.name = 'Name is required.'
  if (values.type === 'nas' && values.powerConfiguration === '') {
    errors.powerConfiguration = 'Select a power configuration.'
  }

  const positiveFields: Array<keyof InventoryFormValues> = [
    'cores', 'threads', 'capacityGb', 'hostMemorySlots', 'cpuSocketCount',
    'hostCpuSocketCount', 'hostMemorySlotsPerCpu', 'hostPowerPsuBayCount',
  ]
  const nonNegativeFields: Array<keyof InventoryFormValues> = [
    'baseClockGhz', 'boostClockGhz', 'driveBays', 'm2Slots', 'speedMt', 'ramVoltageVolts',
    'capacity', 'vramGb', 'switchingCapacityGbps', 'rackUnits',
    'hostCpuMaxTdpWatts', 'hostMemoryMaxCapacityGb', 'hostMemoryMaxModuleCapacityGb',
    'hostMemoryMaxSpeedMt', 'hostMaxExpansionPowerWatts', 'cpuTdpWatts',
    'hostPowerMaxGraphicsPowerWatts',
    'expansionPowerWatts',
    'ratedWatts', 'displaySizeInches', 'refreshRateHz', 'upsWatts',
    'upsVoltAmps', 'batteryOutletCount', 'surgeOutletCount', 'outletCount',
    'adapterOutputWatts',
  ]
  for (const key of positiveFields) validateNumber(errors, values, key, 1)
  for (const key of nonNegativeFields) validateNumber(errors, values, key)

  if (
    values.type === 'ram'
    && (values.ramModuleType === 'RDIMM' || values.ramModuleType === 'LRDIMM')
    && values.ramEcc === 'no'
  ) {
    errors.ramEcc = `${values.ramModuleType} modules must use ECC.`
  }

  if (values.hostCpuPopulationModes.some((value) => (
    !Number.isSafeInteger(Number(value)) || Number(value) < 1
  ))) {
    errors.hostCpuPopulationModes = 'CPU population modes must be positive whole numbers.'
  }
  const socketCount = numberValue(values.hostCpuSocketCount)
  if (socketCount !== undefined && values.hostCpuPopulationModes.some((value) => Number(value) > socketCount)) {
    errors.hostCpuPopulationModes = 'CPU population modes cannot exceed the socket count.'
  }
  if (values.storageSlotGroups.some((group) => group.controllerSlotIds
    .split(',')
    .filter((value) => value.trim() !== '')
    .some((value) => !Number.isSafeInteger(Number(value)) || Number(value) < 1))) {
    errors.storageSlotGroups = 'Controller slot references must be positive numeric IDs.'
  }
  if (values.hostAdvancedTopologyJson.trim()) {
    try {
      parseAdvancedHostTopology(values.hostAdvancedTopologyJson)
    } catch {
      errors.hostAdvancedTopologyJson = 'Enter a valid JSON object for advanced topology.'
    }
  }

  if (getStorageSlotGroupValidationTarget(values.storageSlotGroups)) {
    errors.storageSlotGroups = 'Storage slot counts must be whole numbers of at least 1.'
  }

  if (getExpansionSlotGroupValidationTarget(values.expansionSlotGroups)) {
    errors.expansionSlotGroups = 'Expansion slot counts must be whole numbers of at least 1.'
  }

  if (getOptionalModuleSlotGroupValidationTarget(values.optionalModuleSlotGroups)) {
    errors.optionalModuleSlotGroups = 'Optional module slot counts must be whole numbers of at least 1.'
  }

  if (getMotherboardPowerConnectorValidationTarget(values.motherboardPowerConnectors)) {
    errors.motherboardPowerConnectors = 'Power connector counts must be whole numbers of at least 1.'
  }

  if (values.powerSupplyConnectors.some((connector) => (
    connector.count.trim() !== ''
      && (!Number.isInteger(Number(connector.count)) || Number(connector.count) < 1)
  ))) {
    errors.powerSupplyConnectors = 'PSU connector counts must be whole numbers of at least 1.'
  }

  const invalidPortGroup = getPortGroupValidationTarget(values.type, values.portGroups)
  if (invalidPortGroup?.field === 'count') {
    errors.portGroups = `Port counts must be whole numbers from 0 to ${MAX_PORT_GROUP_COUNT}.`
  } else if (invalidPortGroup?.field === 'speed') {
    errors.portGroups = `Select a supported speed for the ${formatPortTypeLabel(values.portGroups[invalidPortGroup.index].type)} switch port group.`
  }

  return errors
}

export function updatePortGroupForType(
  type: InventoryType,
  group: PortGroup,
  update: Partial<PortGroup>,
): PortGroup {
  const next = { ...group, ...update }
  if (type === 'switch' && Object.prototype.hasOwnProperty.call(update, 'type')) {
    next.speed = getSwitchPortSpeedForType(next.type, next.speed) ?? ''
  }
  return next
}
