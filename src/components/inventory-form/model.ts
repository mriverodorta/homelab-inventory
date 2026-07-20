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
  InventoryItem,
  InventoryPort,
  InventoryPortRole,
  InventoryPortType,
  InventoryProperties,
  InventorySpecs,
  InventoryType,
} from '@/types/inventory'
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
  id: string
  label: string
  count: string
  interfaces: string[]
  formFactors: string[]
  pcieGeneration: string
}

export type ExpansionSlotGroupDraft = {
  id: string
  label: string
  count: string
  interfaceFamily: string
  pcieGeneration: string
  mechanicalLanes: string
  electricalLanes: string
  acceptedHeights: string[]
  maxSlotWidth: string
  maxPowerWatts: string
}

export type InventoryFormValues = {
  type: InventoryType
  name: string
  manufacturer: string
  secondaryManufacturer: string
  model: string
  family: string
  number: string
  notes: string
  formFactor: string
  networkSlot: string
  wireless: string
  driveBays: string
  m2Slots: string
  cores: string
  threads: string
  baseClockGhz: string
  boostClockGhz: string
  capacityGb: string
  generation: string
  speedMt: string
  secondarySpeedMt: string
  moduleCount: string
  capacity: string
  storageUnit: 'GB' | 'TB'
  interface: string
  storageFormFactor: string
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
  portGroups: PortGroup[]
  originalPorts: InventoryPort[]
  preservedSpecs: InventorySpecs
  hostCpuSockets: string[]
  hostCpuGenerations: string[]
  hostCpuMaxTdpWatts: string
  hostMemoryGenerations: string[]
  hostMemorySlots: string
  hostMemoryMaxCapacityGb: string
  hostMemoryMaxModuleCapacityGb: string
  hostMemoryMaxSpeedMt: string
  storageSlotGroups: StorageSlotGroupDraft[]
  expansionSlotGroups: ExpansionSlotGroupDraft[]
  hostMaxExpansionPowerWatts: string
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

export const MAX_PORT_GROUP_COUNT = 128

const KNOWN_SPEC_KEYS: Partial<Record<InventoryType, string[]>> = {
  server: ['formFactor', 'networkSlot', 'wireless'],
  nas: ['driveBays', 'm2Slots'],
  cpu: ['cores', 'threads', 'baseClockGhz', 'boostClockGhz'],
  ram: ['capacityGb', 'generation', 'speedMt', 'secondarySpeedMt', 'moduleCount'],
  storage: ['capacityGb', 'capacityTb', 'interface', 'formFactor'],
  gpu: ['vramGb', 'formFactor', 'slotWidth', 'pcie'],
  network: ['ports', 'speedMbps', 'interface', 'formFactor'],
  switch: ['management', 'switchingCapacityGbps', 'fanless'],
  patchPanel: ['rackUnits', 'mount'],
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

function cloneCompatibility(value: InventoryCompatibility | undefined): InventoryCompatibility {
  return value ? structuredClone(value) : {}
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
  return ['server', 'nas', 'gpu', 'network', 'switch', 'patchPanel'].includes(type)
}

export function inventoryPortsToPortGroups(ports: InventoryPort[] | undefined): PortGroup[] {
  if (!ports?.length) return []
  const groups: PortGroup[] = []

  for (const port of ports.slice().sort((a, b) => a.slotNumber - b.slotNumber)) {
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
    name: '',
    manufacturer: '',
    secondaryManufacturer: '',
    model: '',
    family: '',
    number: '',
    notes: '',
    formFactor: type === 'server' ? 'Mini' : '',
    networkSlot: '',
    wireless: '',
    driveBays: '',
    m2Slots: '',
    cores: '',
    threads: '',
    baseClockGhz: '',
    boostClockGhz: '',
    capacityGb: '',
    generation: '',
    speedMt: '',
    secondarySpeedMt: '',
    moduleCount: '',
    capacity: '',
    storageUnit: 'TB',
    interface: '',
    storageFormFactor: '',
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
    portGroups: defaultPortGroups(type),
    originalPorts: [],
    preservedSpecs: {},
    hostCpuSockets: [],
    hostCpuGenerations: [],
    hostCpuMaxTdpWatts: '',
    hostMemoryGenerations: [],
    hostMemorySlots: '',
    hostMemoryMaxCapacityGb: '',
    hostMemoryMaxModuleCapacityGb: '',
    hostMemoryMaxSpeedMt: '',
    storageSlotGroups: [],
    expansionSlotGroups: [],
    hostMaxExpansionPowerWatts: '',
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
    name: item.name,
    manufacturer: item.manufacturer ?? '',
    secondaryManufacturer: item.secondaryManufacturer ?? '',
    model: item.model ?? '',
    family: item.family ?? '',
    number: item.number ?? '',
    notes: item.notes ?? '',
    formFactor: stringValue(specs.formFactor),
    networkSlot: stringValue(specs.networkSlot),
    wireless: stringValue(specs.wireless),
    driveBays: stringValue(specs.driveBays),
    m2Slots: stringValue(specs.m2Slots),
    cores: stringValue(specs.cores),
    threads: stringValue(specs.threads),
    baseClockGhz: stringValue(specs.baseClockGhz),
    boostClockGhz: stringValue(specs.boostClockGhz),
    capacityGb: stringValue(specs.capacityGb),
    generation: stringValue(specs.generation),
    speedMt: stringValue(specs.speedMt),
    secondarySpeedMt: stringValue(specs.secondarySpeedMt),
    moduleCount: stringValue(specs.moduleCount),
    capacity: stringValue(hasCapacityTb ? specs.capacityTb : specs.capacityGb),
    storageUnit: hasCapacityTb ? 'TB' : 'GB',
    interface: stringValue(specs.interface),
    storageFormFactor: item.type === 'storage' ? stringValue(specs.formFactor) : '',
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
    portGroups: inventoryPortsToPortGroups(item.ports),
    originalPorts: item.ports?.map(clonePort) ?? [],
    preservedSpecs,
    hostCpuSockets: stringArray(item.compatibility?.host?.cpu?.sockets),
    hostCpuGenerations: stringArray(item.compatibility?.host?.cpu?.generations),
    hostCpuMaxTdpWatts: stringValue(item.compatibility?.host?.cpu?.maxTdpWatts),
    hostMemoryGenerations: stringArray(item.compatibility?.host?.memory?.generations),
    hostMemorySlots: stringValue(item.compatibility?.host?.memory?.slots),
    hostMemoryMaxCapacityGb: stringValue(item.compatibility?.host?.memory?.maxCapacityGb),
    hostMemoryMaxModuleCapacityGb: stringValue(item.compatibility?.host?.memory?.maxModuleCapacityGb),
    hostMemoryMaxSpeedMt: stringValue(item.compatibility?.host?.memory?.maxSpeedMt),
    storageSlotGroups: item.compatibility?.host?.storageSlots?.map((group) => ({
      id: group.id,
      label: group.label,
      count: stringValue(group.count),
      interfaces: stringArray(group.interfaces),
      formFactors: stringArray(group.formFactors),
      pcieGeneration: stringValue(group.pcieGeneration),
    })) ?? [],
    expansionSlotGroups: item.compatibility?.host?.expansionSlots?.map((group) => ({
      id: group.id,
      label: group.label,
      count: stringValue(group.count),
      interfaceFamily: stringValue(group.interfaceFamily),
      pcieGeneration: stringValue(group.pcieGeneration),
      mechanicalLanes: stringValue(group.mechanicalLanes),
      electricalLanes: stringValue(group.electricalLanes),
      acceptedHeights: stringArray(group.acceptedHeights),
      maxSlotWidth: stringValue(group.maxSlotWidth),
      maxPowerWatts: stringValue(group.maxPowerWatts),
    })) ?? [],
    hostMaxExpansionPowerWatts: stringValue(item.compatibility?.host?.maxExpansionPowerWatts),
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
  let slotNumber = 1
  const ports: InventoryPort[] = []
  const originalsById = new Map(
    originalPorts.map((port) => [portIdKey(port.id), clonePort(port)]),
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
        kind: type === 'switch' ? 'switch-port' : type === 'patchPanel' ? 'keystone' : 'server-port',
        type: group.type,
        slotNumber,
        label: originalPort?.label ?? '',
      }
      if (group.speed) port.speed = group.speed
      else delete port.speed
      if (type === 'switch' || type === 'network') port.role = group.role
      else delete port.role
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

  const protectedRemovedPort = originalPorts.find(
    (port) => !retainedIds.has(portIdKey(port.id)) && hasProtectedPortMetadata(port),
  )
  if (protectedRemovedPort) {
    throw new Error(`Cannot remove protected port ${String(protectedRemovedPort.id)} without resolving its saved metadata.`)
  }

  return ports.length ? ports : undefined
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
  } else if (type === 'cpu') {
    setSpec(specs, 'cores', numberValue(values.cores))
    setSpec(specs, 'threads', numberValue(values.threads))
    setSpec(specs, 'baseClockGhz', numberValue(values.baseClockGhz))
    setSpec(specs, 'boostClockGhz', numberValue(values.boostClockGhz))
  } else if (type === 'ram') {
    setSpec(specs, 'capacityGb', numberValue(values.capacityGb))
    setSpec(specs, 'generation', cleanString(values.generation))
    setSpec(specs, 'speedMt', numberValue(values.speedMt))
    setSpec(specs, 'secondarySpeedMt', numberValue(values.secondarySpeedMt))
    setSpec(specs, 'moduleCount', numberValue(values.moduleCount))
  } else if (type === 'storage') {
    delete specs.capacityGb
    delete specs.capacityTb
    setSpec(specs, values.storageUnit === 'TB' ? 'capacityTb' : 'capacityGb', numberValue(values.capacity))
    setSpec(specs, 'interface', cleanString(values.interface))
    setSpec(specs, 'formFactor', cleanString(values.storageFormFactor))
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
  }

  const compatibility = buildCompatibility(values)
  const ports = inventoryTypeHasPorts(type)
    ? reconcilePorts(type, values.portGroups, values.originalPorts)
    : undefined
  return {
    type,
    name: values.name.trim(),
    ...(cleanString(values.manufacturer) ? { manufacturer: values.manufacturer.trim() } : {}),
    ...(cleanString(values.secondaryManufacturer) ? { secondaryManufacturer: values.secondaryManufacturer.trim() } : {}),
    ...(cleanString(values.model) ? { model: values.model.trim() } : {}),
    ...(cleanString(values.family) ? { family: values.family.trim() } : {}),
    ...(cleanString(values.number) ? { number: values.number.trim() } : {}),
    ...(values.subtype ? { subtype: values.subtype } : {}),
    ...(Object.keys(specs).length ? { specs } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(values.properties ? { properties: { ...values.properties } } : {}),
    ...(ports ? { ports } : {}),
    ...(cleanString(values.notes) ? { notes: values.notes.trim() } : {}),
  }
}

function buildCompatibility(values: InventoryFormValues): InventoryCompatibility | undefined {
  const compatibility = cloneCompatibility(values.preservedCompatibility)
  const root = asMutableRecord(compatibility)

  if (values.type === 'server' || values.type === 'nas') {
    const host = compatibility.host ? structuredClone(compatibility.host) : {}
    const hostRecord = asMutableRecord(host)
    const cpu = host.cpu ? { ...host.cpu } : {}
    const cpuRecord = asMutableRecord(cpu)
    setOptional(cpuRecord, 'sockets', values.hostCpuSockets.map((value) => value.trim()).filter(Boolean))
    setOptional(cpuRecord, 'generations', values.hostCpuGenerations)
    setOptional(cpuRecord, 'maxTdpWatts', numberValue(values.hostCpuMaxTdpWatts))
    if (Object.keys(cpuRecord).length) host.cpu = cpu
    else delete host.cpu

    const memory = host.memory ? { ...host.memory } : {}
    const memoryRecord = asMutableRecord(memory)
    setOptional(memoryRecord, 'generations', values.hostMemoryGenerations)
    setOptional(memoryRecord, 'slots', numberValue(values.hostMemorySlots))
    setOptional(memoryRecord, 'maxCapacityGb', numberValue(values.hostMemoryMaxCapacityGb))
    setOptional(memoryRecord, 'maxModuleCapacityGb', numberValue(values.hostMemoryMaxModuleCapacityGb))
    setOptional(memoryRecord, 'maxSpeedMt', numberValue(values.hostMemoryMaxSpeedMt))
    if (Object.keys(memoryRecord).length) host.memory = memory
    else delete host.memory

    const originalStorageGroups = new Map(
      (compatibility.host?.storageSlots ?? []).map((group) => [group.id, group]),
    )
    const storageSlots = values.storageSlotGroups.filter((draft) => (
      draft.label.trim() !== ''
      || draft.count.trim() !== ''
      || draft.interfaces.length > 0
      || draft.formFactors.length > 0
      || draft.pcieGeneration.trim() !== ''
    )).map((draft) => {
      const group = structuredClone(originalStorageGroups.get(draft.id) ?? {}) as Record<string, unknown>
      group.id = draft.id
      group.label = draft.label.trim()
      setOptional(group, 'count', numberValue(draft.count))
      setOptional(group, 'interfaces', draft.interfaces)
      setOptional(group, 'formFactors', draft.formFactors)
      setOptional(group, 'pcieGeneration', numberValue(draft.pcieGeneration))
      return group
    })
    setOptional(hostRecord, 'storageSlots', storageSlots)

    const originalExpansionGroups = new Map(
      (compatibility.host?.expansionSlots ?? []).map((group) => [group.id, group]),
    )
    const expansionSlots = values.expansionSlotGroups.filter((draft) => (
      draft.label.trim() !== ''
      || draft.count.trim() !== ''
      || draft.interfaceFamily.trim() !== ''
      || draft.pcieGeneration.trim() !== ''
      || draft.mechanicalLanes.trim() !== ''
      || draft.electricalLanes.trim() !== ''
      || draft.acceptedHeights.length > 0
      || draft.maxSlotWidth.trim() !== ''
      || draft.maxPowerWatts.trim() !== ''
    )).map((draft) => {
      const group = structuredClone(originalExpansionGroups.get(draft.id) ?? {}) as Record<string, unknown>
      group.id = draft.id
      group.label = draft.label.trim()
      setOptional(group, 'count', numberValue(draft.count))
      setOptional(group, 'interfaceFamily', cleanString(draft.interfaceFamily))
      setOptional(group, 'pcieGeneration', numberValue(draft.pcieGeneration))
      setOptional(group, 'mechanicalLanes', numberValue(draft.mechanicalLanes))
      setOptional(group, 'electricalLanes', numberValue(draft.electricalLanes))
      setOptional(group, 'acceptedHeights', draft.acceptedHeights)
      setOptional(group, 'maxSlotWidth', numberValue(draft.maxSlotWidth))
      setOptional(group, 'maxPowerWatts', numberValue(draft.maxPowerWatts))
      return group
    })
    setOptional(hostRecord, 'expansionSlots', expansionSlots)
    setOptional(hostRecord, 'maxExpansionPowerWatts', numberValue(values.hostMaxExpansionPowerWatts))
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

export function validateInventoryFormValues(values: InventoryFormValues): InventoryFormErrors {
  const errors: InventoryFormErrors = {}
  if (!values.name.trim()) errors.name = 'Name is required.'

  const positiveFields: Array<keyof InventoryFormValues> = ['cores', 'threads', 'capacityGb', 'moduleCount', 'hostMemorySlots']
  const nonNegativeFields: Array<keyof InventoryFormValues> = [
    'baseClockGhz', 'boostClockGhz', 'driveBays', 'm2Slots', 'speedMt', 'secondarySpeedMt',
    'capacity', 'vramGb', 'switchingCapacityGbps', 'rackUnits',
    'hostCpuMaxTdpWatts', 'hostMemoryMaxCapacityGb', 'hostMemoryMaxModuleCapacityGb',
    'hostMemoryMaxSpeedMt', 'hostMaxExpansionPowerWatts', 'cpuTdpWatts',
    'expansionPowerWatts',
  ]
  for (const key of positiveFields) validateNumber(errors, values, key, 1)
  for (const key of nonNegativeFields) validateNumber(errors, values, key)

  const invalidStorageGroup = values.storageSlotGroups.find((group) => (
    group.count.trim() !== ''
      && (!Number.isInteger(Number(group.count)) || Number(group.count) < 1)
  ))
  if (invalidStorageGroup) errors.storageSlotGroups = 'Storage slot counts must be whole numbers of at least 1.'

  const invalidExpansionGroup = values.expansionSlotGroups.find((group) => (
    group.count.trim() !== ''
      && (!Number.isInteger(Number(group.count)) || Number(group.count) < 1)
  ))
  if (invalidExpansionGroup) errors.expansionSlotGroups = 'Expansion slot counts must be whole numbers of at least 1.'

  const invalidCount = values.portGroups.find(
    (group) => !Number.isInteger(Number(group.count))
      || Number(group.count) < 0
      || Number(group.count) > MAX_PORT_GROUP_COUNT,
  )
  if (invalidCount) {
    errors.portGroups = `Port counts must be whole numbers from 0 to ${MAX_PORT_GROUP_COUNT}.`
  }

  if (values.type === 'switch') {
    const invalidSpeed = values.portGroups.find(
      (group) => isSwitchNetworkPortType(group.type) && !isSupportedSwitchPortSpeed(group.speed),
    )
    if (invalidSpeed) {
      errors.portGroups = `Select a supported speed for the ${formatPortTypeLabel(invalidSpeed.type)} switch port group.`
    }
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
